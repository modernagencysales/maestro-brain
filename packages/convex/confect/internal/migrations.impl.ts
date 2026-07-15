import type { Ref } from "@confect/core";
import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import type { MigrationReceiptRow } from "../tables/migrationReceipts";
import type { MigrationRunRow } from "../tables/migrationRuns";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import {
  probeExpand,
  probeFail,
  releaseParentKey,
  runKeyForMigration,
} from "./migrations";
import migrations, {
  MigrationAlreadyRunning,
  MigrationBatchReceipt,
  MigrationCursorInvalid,
  makeInitialRun,
  validateExecuteRequest,
} from "./migrations.spec";
const leaseTtlMs = 60_000;
type Args = ReturnType<typeof validateExecuteRequest>;
type Run = MigrationRunRow & { readonly _id?: GenericId<"migrationRuns"> };
const cursorError = (migrationName: string, reason: string) =>
  new MigrationCursorInvalid({ migrationName, reason });
const runningError = (migrationName: string, leaseOwner: string) =>
  new MigrationAlreadyRunning({ migrationName, leaseOwner });
const parseArgs = (input: unknown) =>
  Effect.try({
    try: () => validateExecuteRequest(input),
    catch: (error) => error as MigrationCursorInvalid,
  });
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
    return {
      runKey: run.runKey,
      migrationName: run.migrationName,
      status: "complete" as const,
      cursor: run.cursor,
      leaseOwner: null,
      leaseStartedAt: run.leaseStartedAt ?? 0,
      leaseExpiresAt: run.leaseExpiresAt ?? 0,
      nextCursor: run.cursor,
      componentCursor: last?.priorCursor ?? null,
      batchSequence: run.lastCommittedBatchSequence,
      fenceGeneration: run.fenceGeneration,
      scanned: last?.scanned ?? 0,
      changed: last?.changed ?? null,
      skipped: last?.skipped ?? null,
      failed: last?.failed ?? 0,
      countProvenance: last?.countProvenance ?? "unavailable",
      childReceiptHash: last ? childReceiptHash(last) : "sha256:missing-child",
      parentReceiptHash: parent?.receiptHash,
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

const unavailable = (input: unknown) =>
  parseArgs(input).pipe(
    Effect.flatMap((args) =>
      Effect.fail(
        cursorError(args.migrationName, "migration implementation pending"),
      ),
    ),
  );
const maybeCrashAfterComponent = FunctionImpl.make(
  databaseSchema,
  migrations,
  "maybeCrashAfterComponent",
  () => Effect.succeed({ crashed: false }),
);
const settleBatch = FunctionImpl.make(
  databaseSchema,
  migrations,
  "settleBatch",
  unavailable,
);
const runRegisteredMigration = FunctionImpl.make(
  databaseSchema,
  migrations,
  "runRegisteredMigration",
  unavailable,
);
export default GroupImpl.make(databaseSchema, migrations).pipe(
  Layer.provide(probeExpandImpl),
  Layer.provide(probeFailImpl),
  Layer.provide(runRegisteredMigration),
  Layer.provide(acquireLease),
  Layer.provide(maybeCrashAfterComponent),
  Layer.provide(settleBatch),
  GroupImpl.finalize,
);
