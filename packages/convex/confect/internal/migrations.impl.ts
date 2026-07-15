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
  parentReceipt,
  parentReceiptHash,
  probeExpand,
  probeFail,
  releaseParentKey,
  runKeyForMigration,
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
      definition.dryRunSafety === "probeSafeNonSensitive"
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
  Effect.gen(function* () {
    return yield* (yield* DatabaseReader)
      .table("migrationRuns")
      .index("by_status")
      .collect()
      .pipe(
        Effect.map((rows) =>
          rows.filter((row) => row.migrationName === migrationName),
        ),
        Effect.orDie,
      );
  });
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
  Effect.gen(function* () {
    return yield* (yield* DatabaseReader)
      .table("migrationReceipts")
      .index("by_run_sequence", (query) => query.eq("runKey", runKey))
      .collect()
      .pipe(Effect.orDie);
  });
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
