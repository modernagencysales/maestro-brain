import type { Ref } from "@confect/core";
import { FunctionImpl, GroupImpl } from "@confect/server";
import { ConvexError, type GenericId } from "convex/values";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import refs from "../_generated/refs";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
} from "../_generated/services";
import { probeExpand, probeFail } from "./migrations";
import migrations, {
  MigrationAlreadyRunning,
  MigrationBatchFailed,
  MigrationBatchReceipt,
  MigrationCursorInvalid,
  MigrationParentReceipt,
  childReceiptHash,
  canonicalReceiptHash,
  makeInitialRun,
  terminalParentReceipt,
  validateExecuteRequest,
} from "./migrations.spec";

const leaseTtlMs = 60_000;
const rollbackOwner = "platform";

type Args = ReturnType<typeof validateExecuteRequest>;
type Run = Omit<
  ReturnType<typeof makeInitialRun>,
  "status" | "cursor" | "leaseOwner" | "leaseStartedAt" | "leaseExpiresAt"
> & {
  readonly _id?: GenericId<"migrationRuns">;
  readonly status: "planned" | "running" | "complete" | "failed";
  readonly cursor: string | null;
  readonly leaseOwner: string | null;
  readonly leaseStartedAt: number | null;
  readonly leaseExpiresAt: number | null;
};
type ComponentResult = {
  readonly continueCursor: string;
  readonly isDone: boolean;
  readonly processed: number;
};

const runKeyFor = (a: Args): string =>
  [
    "migration",
    a.migrationName,
    a.releaseCommit,
    a.schemaBefore,
    a.schemaAfter,
    a.deploymentId,
    a.buildId,
  ].join(".");

const parseArgs = (input: unknown) =>
  Effect.try({
    try: () => validateExecuteRequest(input),
    catch: (e) => e as MigrationCursorInvalid,
  });

const loadRun = (a: Args) =>
  Effect.gen(function* () {
    const db = yield* DatabaseReader;
    const rows = yield* db
      .table("migrationRuns")
      .index("by_migration_release", (q) =>
        q
          .eq("migrationName", a.migrationName)
          .eq("releaseCommit", a.releaseCommit),
      )
      .collect()
      .pipe(Effect.orDie);
    return (
      rows.find(
        (r) =>
          r.schemaBefore === a.schemaBefore &&
          r.schemaAfter === a.schemaAfter &&
          r.deploymentId === a.deploymentId &&
          r.buildId === a.buildId,
      ) ?? null
    );
  });

const saveRun = (run: Run) =>
  Effect.gen(function* () {
    if (!run._id) return run;
    const db = yield* DatabaseWriter;
    const { _id, ...patch } = run;
    yield* db.table("migrationRuns").patch(_id, patch).pipe(Effect.orDie);
    return run;
  });

const getOrCreateRun = (a: Args, now: number) =>
  Effect.gen(function* () {
    const db = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const existing = yield* loadRun(a);
    if (existing) return existing as Run;
    const sameName = yield* db
      .table("migrationRuns")
      .index("by_migration_release", (q) =>
        q
          .eq("migrationName", a.migrationName)
          .eq("releaseCommit", a.releaseCommit),
      )
      .collect()
      .pipe(Effect.orDie);
    const allRuns = yield* db
      .table("migrationRuns")
      .index("by_status")
      .collect()
      .pipe(Effect.orDie);
    const drifted = allRuns.some(
      (row) =>
        row.migrationName === a.migrationName &&
        (row.releaseCommit !== a.releaseCommit ||
          row.schemaBefore !== a.schemaBefore ||
          row.schemaAfter !== a.schemaAfter ||
          row.deploymentId !== a.deploymentId ||
          row.buildId !== a.buildId),
    );
    if (sameName.length > 0 || drifted) {
      return yield* Effect.fail(
        new MigrationCursorInvalid({
          migrationName: a.migrationName,
          reason: "release/schema/deployment/build drift",
        }),
      );
    }
    const row = { ...makeInitialRun(a, now), runKey: runKeyFor(a) };
    const id = yield* writer
      .table("migrationRuns")
      .insert(row)
      .pipe(Effect.orDie);
    return { ...row, _id: id } satisfies Run;
  });

const counts = (processed: number, failed = 0) => ({
  scanned: processed,
  changed: 0,
  skipped: Math.max(processed - failed, 0),
  failed,
});

const releaseParentKey = (runKey: string) => `receipt.${runKey}.parent`;
const attemptParentKey = (runKey: string, fenceGeneration: number) =>
  `receipt.${runKey}.${fenceGeneration}.parent`;

const persistChild = (r: MigrationBatchReceipt, parentKey: string) =>
  Effect.gen(function* () {
    const db = yield* DatabaseWriter;
    const hash = childReceiptHash(r);
    yield* db
      .table("migrationReceipts")
      .insert({
        receiptKey: `receipt.${r.runKey}.${r.batchSequence}.child`,
        runKey: r.runKey,
        parentReceiptKey: parentKey,
        kind: "child" as const,
        migrationName: r.migrationName,
        mode: r.mode,
        batchSequence: r.batchSequence,
        fenceGeneration: r.fenceGeneration,
        receiptHash: hash,
        payloadJson: JSON.stringify(r),
        createdAt: r.finishedAt,
      })
      .pipe(Effect.orDie);
    return hash;
  });

const childrenFor = (runKey: string, batchSequence?: number) =>
  Effect.gen(function* () {
    const db = yield* DatabaseReader;
    const rows = yield* db
      .table("migrationReceipts")
      .index("by_run_sequence", (q) => q.eq("runKey", runKey))
      .collect()
      .pipe(Effect.orDie);
    return rows
      .filter(
        (r) =>
          r.kind === "child" &&
          (batchSequence === undefined || r.batchSequence === batchSequence),
      )
      .sort((a, b) => a.batchSequence - b.batchSequence)
      .map((r) => MigrationBatchReceipt.make(JSON.parse(r.payloadJson)));
  });

const persistParentOnce = (p: MigrationParentReceipt) =>
  Effect.gen(function* () {
    const db = yield* DatabaseWriter;
    const key = p.parityChecks.includes("failed-batch-recorded")
      ? attemptParentKey(p.runKey, p.fenceGeneration)
      : releaseParentKey(p.runKey);
    const reader = yield* DatabaseReader;
    const existing = yield* reader
      .table("migrationReceipts")
      .index("by_parent", (q) => q.eq("parentReceiptKey", null))
      .collect()
      .pipe(Effect.orDie);
    const hash = canonicalReceiptHash(p);
    const existingParent = existing.find((r) => r.receiptKey === key);
    if (existingParent) return existingParent.receiptHash;
    yield* db
      .table("migrationReceipts")
      .insert({
        receiptKey: key,
        runKey: p.runKey,
        parentReceiptKey: null,
        kind: p.parityChecks.includes("failed-batch-recorded")
          ? ("failure_checkpoint" as const)
          : ("release_parent" as const),
        migrationName: p.migrationName,
        mode: "execute" as const,
        batchSequence: 0,
        fenceGeneration: p.fenceGeneration,
        receiptHash: hash,
        payloadJson: JSON.stringify(p),
        createdAt: p.observationEndsAt,
      })
      .pipe(Effect.orDie);
    return hash;
  });

const parent = (
  a: Args,
  run: Run,
  children: readonly MigrationBatchReceipt[],
  now: number,
  parity: string[],
) =>
  terminalParentReceipt({
    runKey: run.runKey,
    migrationName: a.migrationName,
    releaseCommit: a.releaseCommit,
    schemaBefore: a.schemaBefore,
    schemaAfter: a.schemaAfter,
    parityChecks: parity,
    rollbackOwner,
    observationEndsAt: now,
    actor: a.actor,
    deploymentId: a.deploymentId,
    buildId: a.buildId,
    fenceGeneration: run.fenceGeneration,
    cursor: run.cursor,
    batchSequence: run.lastCommittedBatchSequence,
    batchSize: a.batchSize,
    childReceipts: children,
  });

const acquireLease = FunctionImpl.make(
  databaseSchema,
  migrations,
  "acquireLease",
  (input) =>
    Effect.gen(function* () {
      const a = yield* parseArgs(input);
      const now = yield* Clock.currentTimeMillis;
      const run = yield* getOrCreateRun(a, now);
      if (run.status === "complete") {
        const children = yield* childrenFor(run.runKey);
        const db = yield* DatabaseReader;
        const parentRows = yield* db
          .table("migrationReceipts")
          .index("by_parent", (q) => q.eq("parentReceiptKey", null))
          .collect()
          .pipe(Effect.orDie);
        const parentRow = parentRows.find(
          (row) =>
            row.runKey === run.runKey &&
            row.fenceGeneration === run.fenceGeneration,
        );
        const lastChild = children.at(-1);
        return {
          runKey: run.runKey,
          migrationName: run.migrationName,
          cursor: run.cursor,
          leaseOwner: null,
          leaseStartedAt: run.updatedAt,
          leaseExpiresAt: run.updatedAt,
          fenceGeneration: run.fenceGeneration,
          batchSequence: run.lastCommittedBatchSequence,
          status: "complete" as const,
          nextCursor: run.cursor,
          componentCursor: lastChild?.cursor ?? null,
          scanned: lastChild?.scanned ?? 0,
          changed: lastChild?.changed ?? 0,
          skipped: lastChild?.skipped ?? 0,
          failed: lastChild?.failed ?? 0,
          childReceiptHash: lastChild
            ? childReceiptHash(lastChild)
            : canonicalReceiptHash({ complete: true, runKey: run.runKey }),
          parentReceiptHash:
            parentRow?.receiptHash ??
            canonicalReceiptHash({ missingParent: run.runKey }),
        };
      }
      if (run.leaseOwner && (run.leaseExpiresAt ?? 0) > now)
        return yield* Effect.fail(
          new MigrationAlreadyRunning({
            migrationName: a.migrationName,
            leaseOwner: run.leaseOwner,
          }),
        );
      const next: Run = {
        ...run,
        status: "running",
        leaseOwner: input.leaseOwner,
        leaseStartedAt: now,
        leaseExpiresAt: now + leaseTtlMs,
        fenceGeneration: run.fenceGeneration + 1,
        updatedAt: now,
      };
      yield* saveRun(next);
      return {
        runKey: next.runKey,
        migrationName: next.migrationName,
        cursor: next.cursor,
        leaseOwner: input.leaseOwner,
        leaseStartedAt: next.leaseStartedAt ?? now,
        leaseExpiresAt: next.leaseExpiresAt ?? now + leaseTtlMs,
        fenceGeneration: next.fenceGeneration,
        batchSequence: next.lastCommittedBatchSequence,
        status: "running" as const,
      };
    }),
);

const settleBatch = FunctionImpl.make(
  databaseSchema,
  migrations,
  "settleBatch",
  (input) =>
    Effect.gen(function* () {
      const a = yield* parseArgs(input);
      const now = yield* Clock.currentTimeMillis;
      const run = yield* loadRun(a);
      if (!run)
        return yield* Effect.fail(
          new MigrationCursorInvalid({
            migrationName: a.migrationName,
            reason: "run not found",
          }),
        );
      if (
        run.leaseOwner !== input.expectedLeaseOwner ||
        run.fenceGeneration !== input.expectedFenceGeneration
      )
        return yield* Effect.fail(
          new MigrationAlreadyRunning({
            migrationName: a.migrationName,
            leaseOwner: run.leaseOwner ?? "released",
          }),
        );
      const status =
        input.failed > 0
          ? ("failed" as const)
          : input.complete
            ? ("complete" as const)
            : ("running" as const);
      const next: Run = {
        ...(run as Run),
        status,
        cursor: input.nextCursor,
        leaseOwner: null,
        leaseStartedAt: null,
        leaseExpiresAt: null,
        lastCommittedBatchSequence: run.lastCommittedBatchSequence + 1,
        updatedAt: now,
      };
      yield* saveRun(next);
      const receipt = MigrationBatchReceipt.make({
        migrationName: a.migrationName,
        mode: input.mode,
        cursor: input.componentCursor,
        priorCursor: input.componentCursor,
        nextCursor: input.nextCursor,
        runKey: next.runKey,
        batchSequence: next.lastCommittedBatchSequence,
        fenceGeneration: next.fenceGeneration,
        actor: a.actor,
        deploymentId: a.deploymentId,
        buildId: a.buildId,
        scanned: input.scanned,
        changed: input.changed,
        skipped: input.skipped,
        failed: input.failed,
        complete: status !== "running",
        startedAt: input.batchStartedAt,
        finishedAt: now,
      });
      const parentKey =
        status === "failed"
          ? attemptParentKey(next.runKey, next.fenceGeneration)
          : releaseParentKey(next.runKey);
      const childHash = yield* persistChild(receipt, parentKey);
      let parentHash: string | undefined;
      if (status !== "running") {
        const children = yield* childrenFor(next.runKey);
        parentHash = yield* persistParentOnce(
          parent(a, next, children, now, [
            status === "failed" ? "failed-batch-recorded" : "count-parity",
          ]),
        );
      }
      return {
        runKey: next.runKey,
        migrationName: a.migrationName,
        status,
        initialCursor: null,
        nextCursor: next.cursor,
        componentCursor: input.componentCursor,
        leaseOwner: next.leaseOwner,
        batchSequence: next.lastCommittedBatchSequence,
        fenceGeneration: next.fenceGeneration,
        scanned: input.scanned,
        changed: input.changed,
        skipped: input.skipped,
        failed: input.failed,
        childReceiptHash: childHash,
        ...(parentHash ? { parentReceiptHash: parentHash } : {}),
      };
    }),
);

const migrationCodecError = (migrationName: string) =>
  new MigrationCursorInvalid({ migrationName, reason: "codec failure" });

const safeMutation = <M extends Ref.AnyMutation>(
  runMutation: <Mutation extends Ref.AnyMutation>(
    mutation: Mutation,
    ...args: Ref.OptionalArgs<Mutation>
  ) => Effect.Effect<Ref.Returns<Mutation>, Ref.Error<Mutation> | unknown>,
  ref: M,
  input: Ref.Args<M>,
  migrationName: string,
) =>
  runMutation(ref, input).pipe(
    Effect.mapError((e) =>
      e instanceof MigrationAlreadyRunning ||
      e instanceof MigrationCursorInvalid ||
      e instanceof MigrationBatchFailed
        ? e
        : migrationCodecError(migrationName),
    ),
  );

const componentResultFromDryRun = (value: unknown): ComponentResult | null => {
  if (!(value instanceof ConvexError)) return null;
  const data = value.data;
  if (!data || typeof data !== "object") return null;
  const tagged = data as { readonly kind?: unknown; readonly result?: unknown };
  if (
    tagged.kind !== "DRY RUN" ||
    !tagged.result ||
    typeof tagged.result !== "object"
  )
    return null;
  const result = tagged.result as {
    readonly continueCursor?: unknown;
    readonly isDone?: unknown;
    readonly processed?: unknown;
  };
  return typeof result.continueCursor === "string" &&
    typeof result.isDone === "boolean" &&
    typeof result.processed === "number"
    ? {
        continueCursor: result.continueCursor,
        isDone: result.isDone,
        processed: result.processed,
      }
    : null;
};

const runRegisteredMigration = FunctionImpl.make(
  databaseSchema,
  migrations,
  "runRegisteredMigration",
  (input) =>
    Effect.gen(function* () {
      const a = yield* parseArgs(input);
      const runMutation = yield* MutationRunner;
      const ref =
        a.migrationName === "probe.fail"
          ? refs.internal.internal.migrations.probeFail
          : refs.internal.internal.migrations.probeExpand;
      if (a.mode === "dryRun") {
        const dry = yield* safeMutation(
          runMutation,
          ref,
          {
            cursor: null,
            dryRun: true,
            oneBatchOnly: true,
            batchSize: a.batchSize,
          },
          a.migrationName,
        ).pipe(Effect.exit);
        const dryDefect =
          dry._tag === "Failure"
            ? Cause.defects(dry.cause).pipe((chunk) =>
                Array.from(chunk).find(
                  (defect) => componentResultFromDryRun(defect) !== null,
                ),
              )
            : undefined;
        const decoded =
          dryDefect === undefined ? null : componentResultFromDryRun(dryDefect);
        if (decoded) {
          const c = counts(decoded.processed);
          return {
            runKey: runKeyFor(a),
            migrationName: a.migrationName,
            status: "dryRunComplete" as const,
            initialCursor: null,
            nextCursor: decoded.isDone ? null : decoded.continueCursor,
            componentCursor: null,
            leaseOwner: null,
            batchSequence: 1,
            fenceGeneration: 0,
            ...c,
            childReceiptHash: canonicalReceiptHash({
              dryRun: true,
              result: decoded,
            }),
          };
        }
      }
      const lease = yield* safeMutation(
        runMutation,
        refs.internal.internal.migrations.acquireLease,
        { ...a, leaseOwner: a.actor },
        a.migrationName,
      );
      if (lease.status === "complete") {
        return {
          runKey: lease.runKey,
          migrationName: a.migrationName,
          status: "complete" as const,
          initialCursor: null,
          nextCursor: lease.nextCursor ?? lease.cursor,
          componentCursor: lease.componentCursor ?? null,
          leaseOwner: null,
          batchSequence: lease.batchSequence,
          fenceGeneration: lease.fenceGeneration,
          scanned: lease.scanned ?? 0,
          changed: lease.changed ?? 0,
          skipped: lease.skipped ?? 0,
          failed: lease.failed ?? 0,
          childReceiptHash:
            lease.childReceiptHash ??
            canonicalReceiptHash({ complete: true, runKey: lease.runKey }),
          parentReceiptHash:
            lease.parentReceiptHash ??
            canonicalReceiptHash({ missingParent: lease.runKey }),
        };
      }
      const component = yield* safeMutation(
        runMutation,
        ref,
        {
          cursor: lease.cursor,
          dryRun: false,
          oneBatchOnly: true,
          batchSize: a.batchSize,
        },
        a.migrationName,
      ).pipe(Effect.exit);
      if (component._tag === "Failure") {
        const settled = yield* safeMutation(
          runMutation,
          refs.internal.internal.migrations.settleBatch,
          {
            ...a,
            mode: a.mode,
            expectedLeaseOwner: lease.leaseOwner ?? a.actor,
            expectedFenceGeneration: lease.fenceGeneration,
            batchStartedAt: lease.leaseStartedAt,
            componentCursor: lease.cursor,
            nextCursor: lease.cursor,
            complete: true,
            ...counts(1, 1),
          },
          a.migrationName,
        );
        return yield* Effect.fail(
          new MigrationBatchFailed({
            migrationName: a.migrationName,
            batchSequence: settled.batchSequence,
            failed: 1,
          }),
        );
      }
      const c = counts(component.value.processed);
      return yield* safeMutation(
        runMutation,
        refs.internal.internal.migrations.settleBatch,
        {
          ...a,
          mode: "execute" as const,
          expectedLeaseOwner: lease.leaseOwner ?? a.actor,
          expectedFenceGeneration: lease.fenceGeneration,
          batchStartedAt: lease.leaseStartedAt,
          componentCursor: lease.cursor,
          nextCursor: component.value.isDone
            ? null
            : component.value.continueCursor,
          complete: component.value.isDone,
          ...c,
        },
        a.migrationName,
      );
    }),
);

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

export default GroupImpl.make(databaseSchema, migrations).pipe(
  Layer.provide(probeExpandImpl),
  Layer.provide(probeFailImpl),
  Layer.provide(runRegisteredMigration),
  Layer.provide(acquireLease),
  Layer.provide(settleBatch),
  GroupImpl.finalize,
);
