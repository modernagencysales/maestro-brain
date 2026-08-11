import type { Ref } from "@confect/core";
import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import refs from "../_generated/refs";
import databaseSchema from "../_generated/schema";
import type { MigrationReceiptRow } from "../tables/migrationReceipts";
import type { MigrationRunRow } from "../tables/migrationRuns";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
} from "../_generated/services";
import {
  batchReceiptJson,
  childReceiptHash,
  completeActionResult,
  componentResultFromDryRun,
  failureCheckpointKey,
  type Lease,
  makeBatchReceipt,
  makeSettlementInput,
  legacyApiKeysInertExpand,
  parentReceipt,
  parentReceiptHash,
  probeExpand,
  probeFail,
  releaseParentKey,
  stableTenantOrganizationKeysExpand,
  stableTenantWorkspaceKeysExpand,
  runKeyForMigration,
  type ComponentBatchResult,
} from "./migrations";
import migrations, {
  MigrationAlreadyRunning,
  MigrationBatchFailed,
  MigrationNotFound,
  MigrationBatchReceipt,
  MigrationCursorInvalid,
  findExecutableMigration,
  MigrationParentReceipt,
  makeInitialRun,
  validateExecuteRequest,
  type ValidatedExecuteMigrationArgs,
} from "./migrations.spec";
const leaseTtlMs = 60_000;
type Args = ValidatedExecuteMigrationArgs;
type Run = MigrationRunRow & { readonly _id?: GenericId<"migrationRuns"> };
const cursorError = (migrationName: string, reason: string) =>
  new MigrationCursorInvalid({ migrationName, reason });
const runningError = (migrationName: string, leaseOwner: string) =>
  new MigrationAlreadyRunning({ migrationName, leaseOwner });
const parseArgs = (input: unknown) => validateExecuteRequest(input);
const assertDryRunSafeDefinition = (args: Args) =>
  findExecutableMigration(args.migrationName).pipe(
    Effect.flatMap((definition) =>
      definition.dryRunSafety === "probeSafeNonSensitive" ||
      definition.dryRunSafety === "patchedNoRawDocumentLogs"
        ? Effect.void
        : Effect.fail(
            cursorError(
              args.migrationName,
              "dry-run safety classification missing",
            ),
          ),
    ),
  );

const definitionEvidencePolicy = (args: Args) =>
  findExecutableMigration(args.migrationName).pipe(
    Effect.flatMap((definition) =>
      definition.rollbackOwner.length > 0 && definition.observationWindowMs > 0
        ? Effect.succeed(definition)
        : Effect.fail(
            cursorError(
              args.migrationName,
              "migration evidence policy missing",
            ),
          ),
    ),
  );
const loadRun = (args: Args) =>
  Effect.gen(function* () {
    const rows = yield* (yield* DatabaseReader)
      .table("migrationRuns")
      .index("by_migration_release", (query) =>
        query
          .eq("migrationName", args.migrationName)
          .eq("releaseCommit", args.releaseCommit),
      )
      .collect()
      .pipe(Effect.orDie);
    return (
      rows.find(
        (row) =>
          row.schemaBefore === args.schemaBefore &&
          row.schemaAfter === args.schemaAfter &&
          row.mode === args.mode &&
          row.deploymentId === args.deploymentId &&
          row.buildId === args.buildId,
      ) ?? null
    );
  });
const rowsForMigrationName = (migrationName: string) =>
  DatabaseReader.pipe(
    Effect.flatMap((reader) =>
      reader
        .table("migrationRuns")
        .index("by_status")
        .collect()
        .pipe(
          Effect.map((rows) =>
            rows.filter((row) => row.migrationName === migrationName),
          ),
          Effect.orDie,
        ),
    ),
  );
const sameStableIdentity = (row: Run, args: Args) =>
  row.releaseCommit === args.releaseCommit &&
  row.schemaBefore === args.schemaBefore &&
  row.schemaAfter === args.schemaAfter &&
  row.deploymentId === args.deploymentId &&
  row.buildId === args.buildId;

const getOrCreateRun = (args: Args, now: number) =>
  Effect.gen(function* () {
    const sameName = yield* rowsForMigrationName(args.migrationName);
    const sameIdentity = sameName.filter((row) =>
      sameStableIdentity(row as Run, args),
    );
    if (sameName.length > sameIdentity.length)
      return yield* Effect.fail(
        cursorError(
          args.migrationName,
          "release/schema/deployment/build drift",
        ),
      );
    if (
      args.mode === "execute" &&
      sameIdentity.some(
        (row) => row.mode === "dryRun" && row.status === "failed",
      )
    )
      return yield* Effect.fail(
        cursorError(args.migrationName, "failed dry-run quarantine"),
      );
    const existing = (yield* loadRun(args)) as Run | null;
    if (existing) return existing;
    const row = {
      ...makeInitialRun(args, now),
      runKey: runKeyForMigration(args),
    };
    const id = yield* (yield* DatabaseWriter)
      .table("migrationRuns")
      .insert(row)
      .pipe(Effect.orDie);
    return { ...row, _id: id } satisfies Run;
  });
const patchRun = (run: Run, patch: Partial<Run>) =>
  Effect.gen(function* () {
    if (run._id)
      yield* (yield* DatabaseWriter)
        .table("migrationRuns")
        .patch(run._id, patch)
        .pipe(Effect.orDie);
  });
const receiptRows = (runKey: string) =>
  DatabaseReader.pipe(
    Effect.flatMap((reader) =>
      reader
        .table("migrationReceipts")
        .index("by_run_sequence", (query) => query.eq("runKey", runKey))
        .collect()
        .pipe(Effect.orDie),
    ),
  );
const childReceiptsFor = (runKey: string) =>
  receiptRows(runKey).pipe(
    Effect.map((rows) =>
      rows
        .filter((row) => row.kind === "child")
        .sort((left, right) => left.batchSequence - right.batchSequence)
        .map((row) => MigrationBatchReceipt.make(JSON.parse(row.payloadJson))),
    ),
  );
const insertReceiptOnce = (row: MigrationReceiptRow) =>
  Effect.gen(function* () {
    const existing = (yield* receiptRows(row.runKey)).find(
      (receipt) => receipt.receiptKey === row.receiptKey,
    );
    if (existing) return existing.receiptHash;
    yield* (yield* DatabaseWriter)
      .table("migrationReceipts")
      .insert(row)
      .pipe(Effect.orDie);
    return row.receiptHash;
  });
const completedLeaseResult = (run: Run) =>
  Effect.gen(function* () {
    const children = yield* childReceiptsFor(run.runKey);
    const last = children.at(-1);
    const parent = (yield* receiptRows(run.runKey)).find(
      (row) => row.receiptKey === releaseParentKey(run.runKey),
    );
    if (!last || !parent)
      return yield* failBatch(
        run.migrationName,
        run.lastCommittedBatchSequence,
      );
    return {
      runKey: run.runKey,
      migrationName: run.migrationName,
      status: "complete" as const,
      cursor: run.cursor,
      leaseOwner: null,
      leaseStartedAt: run.leaseStartedAt ?? 0,
      leaseExpiresAt: run.leaseExpiresAt ?? 0,
      nextCursor: run.cursor,
      componentCursor: last.priorCursor,
      batchSequence: run.lastCommittedBatchSequence,
      fenceGeneration: run.fenceGeneration,
      scanned: last.scanned,
      changed: last.changed,
      skipped: last.skipped,
      failed: last.failed,
      countProvenance: last.countProvenance,
      childReceiptHash: childReceiptHash(last),
      parentReceiptHash: parent.receiptHash,
    };
  });
const acquireLease = FunctionImpl.make(
  databaseSchema,
  migrations,
  "acquireLease",
  (input) =>
    Effect.gen(function* () {
      const args = yield* parseArgs(input);
      const now = yield* Clock.currentTimeMillis;
      const run = yield* getOrCreateRun(args, now);
      if (run.status === "complete") return yield* completedLeaseResult(run);
      const activeCrossMode = (yield* rowsForMigrationName(args.migrationName))
        .filter((row) => sameStableIdentity(row as Run, args))
        .find(
          (row) =>
            row.mode !== args.mode &&
            row.leaseOwner !== null &&
            (row.leaseExpiresAt ?? 0) > now,
        );
      const blockingOwner =
        activeCrossMode?.leaseOwner ??
        (run.leaseOwner && (run.leaseExpiresAt ?? 0) > now
          ? run.leaseOwner
          : null);
      if (blockingOwner)
        return yield* Effect.fail(
          runningError(args.migrationName, blockingOwner),
        );
      const fenceGeneration = run.fenceGeneration + 1;
      yield* patchRun(run, {
        status: "running",
        leaseOwner: input.leaseOwner,
        leaseStartedAt: now,
        leaseExpiresAt: now + leaseTtlMs,
        fenceGeneration,
        updatedAt: now,
      });
      return {
        runKey: run.runKey,
        migrationName: run.migrationName,
        cursor: run.cursor,
        leaseOwner: input.leaseOwner,
        leaseStartedAt: now,
        leaseExpiresAt: now + leaseTtlMs,
        fenceGeneration,
        batchSequence: run.lastCommittedBatchSequence,
        status: "running" as const,
      };
    }),
);
const failBatch = (migrationName: string, batchSequence: number) =>
  Effect.fail(
    new MigrationBatchFailed({ migrationName, batchSequence, failed: 1 }),
  );
type MutationBridge = <Mutation extends Ref.AnyMutation>(
  mutation: Mutation,
  ...args: Ref.OptionalArgs<Mutation>
) => Effect.Effect<Ref.Returns<Mutation>, Ref.Error<Mutation> | unknown>;
const safeMutation = <M extends Ref.AnyMutation>(
  runner: MutationBridge,
  ref: M,
  input: Ref.Args<M>,
  migrationName: string,
) =>
  runner(ref, input).pipe(
    Effect.mapError((error) =>
      error instanceof MigrationNotFound ||
      error instanceof MigrationAlreadyRunning ||
      error instanceof MigrationCursorInvalid ||
      error instanceof MigrationBatchFailed
        ? error
        : cursorError(migrationName, "component invocation failed"),
    ),
  );
const settleFailedBatch = (
  runner: MutationBridge,
  args: Args,
  lease: Lease,
  mode: "execute" | "dryRun",
) =>
  safeMutation(
    runner,
    refs.internal.internal.migrations.settleBatch,
    makeSettlementInput({
      args,
      lease,
      mode,
      nextCursor: lease.cursor,
      complete: true,
      processed: 0,
      failed: 1,
    }),
    args.migrationName,
  ).pipe(
    Effect.flatMap(({ batchSequence }) =>
      failBatch(args.migrationName, batchSequence),
    ),
  );
const decodeDryRunRollback = <A, E>(exit: Exit.Exit<A, E>) =>
  exit._tag === "Failure"
    ? (Array.from(Cause.defects(exit.cause))
        .map(componentResultFromDryRun)
        .find(Boolean) ?? null)
    : null;
const probeExpandImpl = FunctionImpl.make(
  databaseSchema,
  migrations,
  "probeExpand",
  probeExpand,
);
const probeFailImpl = FunctionImpl.make(
  databaseSchema,
  migrations,
  "probeFail",
  probeFail,
);
const legacyApiKeysInertExpandImpl = FunctionImpl.make(
  databaseSchema,
  migrations,
  "legacyApiKeysInertExpand",
  legacyApiKeysInertExpand,
);
const stableTenantOrganizationKeysExpandImpl = FunctionImpl.make(
  databaseSchema,
  migrations,
  "stableTenantOrganizationKeysExpand",
  stableTenantOrganizationKeysExpand,
);
const stableTenantWorkspaceKeysExpandImpl = FunctionImpl.make(
  databaseSchema,
  migrations,
  "stableTenantWorkspaceKeysExpand",
  stableTenantWorkspaceKeysExpand,
);
const maybeCrashAfterComponent = FunctionImpl.make(
  databaseSchema,
  migrations,
  "maybeCrashAfterComponent",
  (input) =>
    Effect.gen(function* () {
      const args = yield* parseArgs(input);
      const run = (yield* loadRun(args)) as Run | null;
      if (!run || run.fenceGeneration !== input.fenceGeneration)
        return { crashed: false };
      const targets = yield* (yield* DatabaseReader)
        .table("migrationRuns")
        .index("by_status")
        .collect()
        .pipe(Effect.orDie);
      const probe = targets.find(
        (row) =>
          row.migrationName === "probe-target" &&
          row.actor === "write-count:1" &&
          row.schemaAfter === args.schemaAfter,
      );
      if (!probe) return { crashed: false };
      yield* (yield* DatabaseWriter)
        .table("migrationRuns")
        .patch(probe._id, {
          actor: "write-count:1;post-crash",
        })
        .pipe(Effect.orDie);
      yield* patchRun(run, { leaseExpiresAt: 0 });
      return { crashed: true };
    }),
);
const settleBatch = FunctionImpl.make(
  databaseSchema,
  migrations,
  "settleBatch",
  (input) =>
    Effect.gen(function* () {
      const args = yield* parseArgs(input);
      const now = yield* Clock.currentTimeMillis;
      const run = (yield* loadRun(args)) as Run | null;
      if (!run)
        return yield* Effect.fail(
          cursorError(args.migrationName, "run not found"),
        );
      if (run.cursor !== input.priorCursor)
        return yield* Effect.fail(
          cursorError(args.migrationName, "prior cursor mismatch"),
        );
      if (
        run.leaseOwner !== input.expectedLeaseOwner ||
        run.fenceGeneration !== input.expectedFenceGeneration
      )
        return yield* Effect.fail(
          runningError(args.migrationName, run.leaseOwner ?? "released"),
        );
      if (
        (run.leaseExpiresAt ?? 0) !== input.expectedLeaseExpiresAt ||
        input.expectedLeaseExpiresAt <= now
      )
        return yield* Effect.fail(runningError(args.migrationName, "expired"));
      const status =
        input.failed > 0 ? "failed" : input.complete ? "complete" : "running";
      const sequence = run.lastCommittedBatchSequence + 1;
      yield* patchRun(run, {
        status,
        cursor: input.nextCursor,
        leaseOwner: null,
        leaseStartedAt: null,
        leaseExpiresAt: null,
        lastCommittedBatchSequence: sequence,
        updatedAt: now,
      });
      const parentKey =
        status === "failed"
          ? failureCheckpointKey(run.runKey, run.fenceGeneration)
          : releaseParentKey(run.runKey);
      const child = makeBatchReceipt({
        runKey: run.runKey,
        migrationName: args.migrationName,
        mode: input.mode,
        priorCursor: input.priorCursor,
        nextCursor: input.nextCursor,
        batchSequence: sequence,
        fenceGeneration: run.fenceGeneration,
        actor: args.actor,
        deploymentId: args.deploymentId,
        buildId: args.buildId,
        counts: input,
        complete: status !== "running",
        startedAt: input.batchStartedAt,
        finishedAt: now,
      });
      const childHash = yield* insertReceiptOnce({
        receiptKey: child.receiptKey,
        runKey: child.runKey,
        parentReceiptKey: parentKey,
        kind: "child",
        migrationName: child.migrationName,
        mode: child.mode,
        batchSequence: child.batchSequence,
        fenceGeneration: child.fenceGeneration,
        receiptHash: childReceiptHash(child),
        payloadJson: JSON.stringify(batchReceiptJson(child)),
        createdAt: now,
      });
      let parentHash: string | undefined;
      if (status !== "running") {
        const definition = yield* definitionEvidencePolicy(args);
        const childReceipts = yield* childReceiptsFor(run.runKey);
        const checks =
          status === "failed"
            ? [`failed-batch-sequence:${sequence}`, "failure-checkpoint-only"]
            : [
                input.complete && input.nextCursor === null
                  ? "component-cursor-complete"
                  : "component-cursor-incomplete",
                `ordered-child-hashes:${childReceipts.length}`,
                input.changed === null || input.skipped === null
                  ? "definition-counts-unavailable"
                  : `definition-counts:${input.changed}:${input.skipped}`,
              ];
        const receipt: MigrationParentReceipt = parentReceipt({
          ...args,
          receiptKey: parentKey,
          runKey: run.runKey,
          parityChecks: checks,
          rollbackOwner: definition.rollbackOwner,
          observationEndsAt: now + definition.observationWindowMs,
          fenceGeneration: run.fenceGeneration,
          cursor: input.nextCursor,
          batchSequence: sequence,
          childReceipts,
          complete: status === "complete",
        });
        parentHash = yield* insertReceiptOnce({
          receiptKey: receipt.receiptKey,
          runKey: receipt.runKey,
          parentReceiptKey: null,
          kind: status === "failed" ? "failure_checkpoint" : "release_parent",
          migrationName: receipt.migrationName,
          mode: input.mode,
          batchSequence: 0,
          fenceGeneration: receipt.fenceGeneration,
          receiptHash: parentReceiptHash(receipt),
          payloadJson: JSON.stringify(receipt),
          createdAt: now,
        });
      }
      return {
        runKey: run.runKey,
        migrationName: args.migrationName,
        status,
        initialCursor: null,
        nextCursor: input.nextCursor,
        componentCursor: input.priorCursor,
        leaseOwner: null,
        batchSequence: sequence,
        fenceGeneration: run.fenceGeneration,
        scanned: input.scanned,
        changed: input.changed,
        skipped: input.skipped,
        failed: input.failed,
        countProvenance: input.countProvenance,
        childReceiptHash: childHash,
        ...(parentHash ? { parentReceiptHash: parentHash } : {}),
      };
    }),
);
const migrationRef = (migrationName: string) => {
  if (migrationName === "probe.fail")
    return refs.internal.internal.migrations.probeFail;
  if (migrationName === "legacyApiKeys.inert.expand")
    return refs.internal.internal.migrations.legacyApiKeysInertExpand;
  if (migrationName === "stableTenant.organizationKeys.expand")
    return refs.internal.internal.migrations.stableTenantOrganizationKeysExpand;
  if (migrationName === "stableTenant.workspaceKeys.expand")
    return refs.internal.internal.migrations.stableTenantWorkspaceKeysExpand;
  return refs.internal.internal.migrations.probeExpand;
};
const runRegisteredMigration = FunctionImpl.make(
  databaseSchema,
  migrations,
  "runRegisteredMigration",
  (input) =>
    Effect.gen(function* () {
      const args = yield* parseArgs(input);
      const isDryRun = args.mode === "dryRun";
      if (isDryRun) yield* assertDryRunSafeDefinition(args);
      const runner = yield* MutationRunner;
      const ref = migrationRef(args.migrationName);
      const lease = yield* safeMutation(
        runner,
        refs.internal.internal.migrations.acquireLease,
        { ...args, leaseOwner: args.actor },
        args.migrationName,
      );
      if (lease.status === "complete") {
        if (lease.childReceiptHash === undefined)
          return yield* failBatch(args.migrationName, lease.batchSequence);
        const complete = completeActionResult(args, {
          ...lease,
          childReceiptHash: lease.childReceiptHash,
        });
        return isDryRun
          ? { ...complete, status: "dryRunComplete" as const }
          : complete;
      }
      const definition = yield* findExecutableMigration(args.migrationName);
      const component = yield* safeMutation(
        runner,
        ref,
        {
          cursor: lease.cursor,
          dryRun: isDryRun,
          oneBatchOnly: true,
          batchSize: args.batchSize,
        },
        args.migrationName,
      ).pipe(Effect.exit);
      const componentExit = component as Exit.Exit<
        ComponentBatchResult,
        unknown
      >;
      const batch: ComponentBatchResult | null = isDryRun
        ? decodeDryRunRollback(componentExit)
        : componentExit._tag === "Success"
          ? componentExit.value
          : null;
      if (!batch)
        return yield* settleFailedBatch(runner, args, lease, args.mode);
      if (!isDryRun) {
        const crashProbe = yield* safeMutation(
          runner,
          refs.internal.internal.migrations.maybeCrashAfterComponent,
          { ...args, fenceGeneration: lease.fenceGeneration },
          args.migrationName,
        );
        if (crashProbe.crashed)
          return yield* failBatch(args.migrationName, lease.batchSequence + 1);
      }
      const settled = yield* safeMutation(
        runner,
        refs.internal.internal.migrations.settleBatch,
        makeSettlementInput({
          args,
          lease,
          mode: args.mode,
          nextCursor: batch.isDone ? null : batch.continueCursor,
          complete: batch.isDone,
          processed: batch.processed,
          changed: batch.changed,
          skipped: batch.skipped,
          hasExactExecuteCounters: definition.hasExactExecuteCounters,
        }),
        args.migrationName,
      );
      return isDryRun && batch.isDone
        ? { ...settled, status: "dryRunComplete" as const }
        : settled;
    }),
);
export default GroupImpl.make(databaseSchema, migrations).pipe(
  Layer.provide(probeExpandImpl),
  Layer.provide(probeFailImpl),
  Layer.provide(legacyApiKeysInertExpandImpl),
  Layer.provide(stableTenantOrganizationKeysExpandImpl),
  Layer.provide(stableTenantWorkspaceKeysExpandImpl),
  Layer.provide(runRegisteredMigration),
  Layer.provide(acquireLease),
  Layer.provide(maybeCrashAfterComponent),
  Layer.provide(settleBatch),
  GroupImpl.finalize,
);
