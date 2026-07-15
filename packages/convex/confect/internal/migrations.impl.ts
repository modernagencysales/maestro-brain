import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
} from "../_generated/services";
import {
  reserveBrainKeys,
  reservePageKeys,
  reserveStableKeys,
  reservedMigrationRefs,
} from "./migrations";
import migrations, {
  type AllowedMigrationName,
  type MigrationBatchRunArgs,
  MigrationAlreadyRunning,
  MigrationBatchFailed,
  MigrationCursorInvalid,
  MigrationNotFound,
  migrationDefinitions,
} from "./migrations.spec";

const DAY_MS = 86_400_000;

type MigrationState = "planned" | "running" | "complete" | "failed";
export type MigrationDefinition = (typeof migrationDefinitions)[number];
export type MigrationReceiptForResume = {
  readonly runId: string;
  readonly receiptKind: "parent" | "child";
  readonly releaseRunId: string;
  readonly leaseState: "none" | "held" | "released";
  readonly migrationName: AllowedMigrationName;
  readonly state: MigrationState;
  readonly componentCursor: string | null;
  readonly releaseCommit: string;
  readonly schemaBefore: string;
  readonly schemaAfter: string;
  readonly deploymentId: string;
  readonly startedAt: number;
};
export type MigrationReceiptInsert = MigrationReceiptForResume & {
  readonly parentRunId: string | null;
  readonly mode: "execute";
  readonly phase: "expand" | "backfill" | "verify" | "contract";
  readonly cursor: string | null;
  readonly batchSize: number;
  readonly scanned: number;
  readonly changed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly complete: boolean;
  readonly parityChecks: ReadonlyArray<string>;
  readonly rollbackOwner: string;
  readonly observationEndsAt: number;
  readonly actorKind: "system" | "operator";
  readonly actorKey: string;
  readonly buildId: string;
  readonly receiptHash: string;
  readonly childReceiptHashes: ReadonlyArray<string>;
  readonly finishedAt: number;
};
export type MigrationReceiptStore<R = never> = {
  readonly latestReceipt: (
    name: string,
  ) => Effect.Effect<MigrationReceiptForResume | null, never, R>;
  readonly childHashes: (
    releaseRunId: string,
  ) => Effect.Effect<ReadonlyArray<string>, never, R>;
  readonly appendReceipt: (
    receipt: MigrationReceiptInsert,
  ) => Effect.Effect<void, never, R>;
};
export type MigrationRuntime<R = never> = {
  readonly receipts: MigrationReceiptStore<R>;
  readonly runComponent: (
    name: AllowedMigrationName,
    options: {
      readonly batchSize: number;
      readonly dryRun: boolean;
      readonly cursor?: string | null;
    },
  ) => Effect.Effect<
    {
      readonly continueCursor: string | null;
      readonly isDone: boolean;
      readonly processed: number;
    },
    MigrationBatchFailed,
    R
  >;
};

const definitionsByName = new Map<string, MigrationDefinition>(
  migrationDefinitions.map((definition) => [definition.name, definition]),
);
const canonical = (value: unknown): string =>
  JSON.stringify(value, Object.keys(value as object).sort());
const sha256 = async (value: unknown) => {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const definitionFor = (
  name: string,
): Effect.Effect<
  MigrationDefinition,
  MigrationNotFound | MigrationBatchFailed
> => {
  const definition = definitionsByName.get(name);
  if (definition === undefined)
    return new MigrationNotFound({ migrationName: name });
  if (definition.destructive) {
    return new MigrationBatchFailed({
      migrationName: name,
      reason: "destructive expand/backfill migration",
    });
  }
  return Effect.succeed(definition);
};

const validateLatest = (
  migrationName: AllowedMigrationName,
  input: MigrationBatchRunArgs,
  latest: MigrationReceiptForResume | null,
): Effect.Effect<
  MigrationReceiptForResume | null,
  MigrationAlreadyRunning | MigrationCursorInvalid
> => {
  if (latest === null) return Effect.succeed(null);
  if (latest.state === "running" && latest.leaseState === "held")
    return new MigrationAlreadyRunning({ migrationName });
  if (
    latest.releaseCommit !== input.releaseCommit ||
    latest.schemaBefore !== input.schemaBefore ||
    latest.schemaAfter !== input.schemaAfter ||
    latest.deploymentId !== input.deploymentId
  )
    return new MigrationCursorInvalid({
      migrationName,
      cursor: latest.componentCursor ?? "null",
    });
  if (latest.state === "failed" && latest.componentCursor === null) {
    return new MigrationCursorInvalid({ migrationName, cursor: "null" });
  }
  return Effect.succeed(latest);
};

const receipt = async (
  input: Omit<MigrationReceiptInsert, "receiptHash">,
): Promise<MigrationReceiptInsert> => ({
  ...input,
  receiptHash: await sha256(input),
});

export const runMigrationBatch = <R>(
  runtime: MigrationRuntime<R>,
  rawInput: MigrationBatchRunArgs & { readonly migrationName: string },
): Effect.Effect<
  {
    readonly migrationName: AllowedMigrationName;
    readonly mode: "dryRun" | "execute";
    readonly cursor: string | null;
    readonly scanned: number;
    readonly changed: number;
    readonly skipped: number;
    readonly failed: number;
    readonly complete: boolean;
    readonly startedAt: number;
    readonly finishedAt: number;
  },
  | MigrationNotFound
  | MigrationAlreadyRunning
  | MigrationCursorInvalid
  | MigrationBatchFailed,
  R
> =>
  Effect.gen(function* () {
    const definition = yield* definitionFor(rawInput.migrationName);
    const input = rawInput;
    const migrationName = definition.name;
    const batchSize = input.batchSize ?? definition.batchCap;
    if (batchSize > definition.batchCap)
      return yield* new MigrationBatchFailed({
        migrationName,
        reason: "batch size exceeds cap",
      });
    const latest: MigrationReceiptForResume | null = yield* runtime.receipts
      .latestReceipt(migrationName)
      .pipe(Effect.flatMap((row) => validateLatest(migrationName, input, row)));
    const startedAt = yield* Clock.currentTimeMillis;
    const parentRunId =
      latest?.releaseRunId ?? `${migrationName}:parent:${startedAt}:0`;
    const common = {
      migrationName,
      mode: "execute" as const,
      phase: definition.phase,
      batchSize,
      releaseCommit: input.releaseCommit,
      schemaBefore: input.schemaBefore,
      schemaAfter: input.schemaAfter,
      parityChecks: input.parityChecks ?? [],
      rollbackOwner: input.rollbackOwner ?? "platform",
      observationEndsAt: input.observationEndsAt ?? startedAt + DAY_MS,
      actorKind: input.actor.kind,
      actorKey: input.actor.key,
      deploymentId: input.deploymentId,
      buildId: input.buildId,
    };
    const cursor: string | null | undefined =
      latest?.state === "failed"
        ? latest.componentCursor
        : (latest?.componentCursor ?? undefined);
    if (input.mode === "execute" && latest === null) {
      yield* Effect.promise(() =>
        receipt({
          ...common,
          runId: `${parentRunId}:planned`,
          parentRunId: null,
          releaseRunId: parentRunId,
          receiptKind: "parent" as const,
          state: "planned" as const,
          leaseState: "released" as const,
          cursor: null,
          componentCursor: null,
          scanned: 0,
          changed: 0,
          skipped: 0,
          failed: 0,
          complete: false,
          childReceiptHashes: [],
          startedAt,
          finishedAt: startedAt,
        }),
      ).pipe(Effect.flatMap(runtime.receipts.appendReceipt));
    }
    const resultExit = yield* Effect.exit(
      runtime.runComponent(migrationName, {
        batchSize,
        dryRun: input.mode === "dryRun",
        cursor,
      }),
    );
    const finishedAt = yield* Clock.currentTimeMillis;
    if (resultExit._tag === "Failure") {
      const child = yield* Effect.promise(() =>
        receipt({
          ...common,
          runId: `${migrationName}:child:${startedAt}:1`,
          parentRunId,
          releaseRunId: parentRunId,
          receiptKind: "child" as const,
          state: "failed" as const,
          leaseState: "released" as const,
          cursor: cursor ?? null,
          componentCursor: cursor ?? null,
          scanned: 0,
          changed: 0,
          skipped: 0,
          failed: 1,
          complete: false,
          childReceiptHashes: [],
          startedAt,
          finishedAt,
        }),
      );
      if (input.mode === "execute") {
        yield* runtime.receipts.appendReceipt(child);
        yield* Effect.promise(() =>
          receipt({
            ...child,
            runId: `${parentRunId}:failed:${finishedAt}`,
            parentRunId: null,
            receiptKind: "parent" as const,
            childReceiptHashes: [child.receiptHash],
          }),
        ).pipe(Effect.flatMap(runtime.receipts.appendReceipt));
      }
      return yield* new MigrationBatchFailed({
        migrationName,
        reason: "component migration batch failed",
      });
    }
    const result = resultExit.value;
    const complete = result.isDone;
    const child = yield* Effect.promise(() =>
      receipt({
        ...common,
        runId: `${migrationName}:child:${startedAt}:1`,
        parentRunId,
        releaseRunId: parentRunId,
        receiptKind: "child" as const,
        state: complete ? "complete" : "running",
        leaseState: "released" as const,
        cursor: result.continueCursor,
        componentCursor: result.continueCursor,
        scanned: result.processed,
        changed: 0,
        skipped: result.processed,
        failed: 0,
        complete,
        childReceiptHashes: [],
        startedAt,
        finishedAt,
      }),
    );
    if (input.mode === "execute") {
      yield* runtime.receipts.appendReceipt(child);
      if (complete) {
        const childHashes = [
          ...(yield* runtime.receipts.childHashes(parentRunId)),
          child.receiptHash,
        ].sort();
        yield* Effect.promise(() =>
          receipt({
            ...child,
            runId: `${parentRunId}:complete:${finishedAt}`,
            parentRunId: null,
            receiptKind: "parent" as const,
            childReceiptHashes: childHashes,
          }),
        ).pipe(Effect.flatMap(runtime.receipts.appendReceipt));
      }
    }
    return {
      migrationName,
      mode: input.mode,
      cursor: result.continueCursor,
      scanned: result.processed,
      changed: 0,
      skipped: result.processed,
      failed: 0,
      complete,
      startedAt,
      finishedAt,
    };
  });

export const runComponentWithMutationRunner = (
  name: AllowedMigrationName,
  options: {
    readonly batchSize: number;
    readonly dryRun: boolean;
    readonly cursor?: string | null;
  },
): Effect.Effect<
  {
    readonly continueCursor: string | null;
    readonly isDone: boolean;
    readonly processed: number;
  },
  MigrationBatchFailed,
  MutationRunner
> =>
  Effect.gen(function* () {
    const runMutation = yield* MutationRunner;
    const result = yield* runMutation(reservedMigrationRefs[name], {
      ...options,
      oneBatchOnly: true,
    }).pipe(
      Effect.mapError(
        (error) =>
          new MigrationBatchFailed({
            migrationName: name,
            reason: String(error),
          }),
      ),
    );
    return {
      continueCursor: result.continueCursor ?? null,
      isDone: result.isDone,
      processed: result.processed,
    };
  });

const liveReceipts: MigrationReceiptStore<DatabaseReader | DatabaseWriter> = {
  latestReceipt: (migrationName) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const receipts = (yield* reader
        .table("migrationReceipts")
        .index("by_migration_started", (q) =>
          q.eq("migrationName", migrationName),
        )
        .collect()
        .pipe(Effect.orDie)) as ReadonlyArray<MigrationReceiptForResume>;
      return (
        [...receipts].sort(
          (a, b) =>
            b.startedAt - a.startedAt || (a.receiptKind === "child" ? 1 : -1),
        )[0] ?? null
      );
    }),
  childHashes: (releaseRunId) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const rows = yield* reader
        .table("migrationReceipts")
        .index("by_parent", (q) => q.eq("parentRunId", releaseRunId))
        .collect()
        .pipe(Effect.orDie);
      return rows.map((row) => row.receiptHash);
    }),
  appendReceipt: (row) =>
    Effect.gen(function* () {
      const writer = yield* DatabaseWriter;
      yield* writer.table("migrationReceipts").insert(row).pipe(Effect.orDie);
    }),
};
const liveRuntime: MigrationRuntime<
  DatabaseReader | DatabaseWriter | MutationRunner
> = {
  receipts: liveReceipts,
  runComponent: runComponentWithMutationRunner,
};

const reserveStableKeysImpl = FunctionImpl.make(
  databaseSchema,
  migrations,
  "reserveStableKeys",
  reserveStableKeys,
);
const reserveBrainKeysImpl = FunctionImpl.make(
  databaseSchema,
  migrations,
  "reserveBrainKeys",
  reserveBrainKeys,
);
const reservePageKeysImpl = FunctionImpl.make(
  databaseSchema,
  migrations,
  "reservePageKeys",
  reservePageKeys,
);
const runBatchInternal = FunctionImpl.make(
  databaseSchema,
  migrations,
  "runBatchInternal",
  (input) => runMigrationBatch(liveRuntime, input),
);
const listReceiptsInternal = FunctionImpl.make(
  databaseSchema,
  migrations,
  "listReceiptsInternal",
  ({ migrationName }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const rows = (yield* (
        migrationName === undefined
          ? reader.table("migrationReceipts").collect()
          : reader
              .table("migrationReceipts")
              .index("by_migration_started", (q) =>
                q.eq("migrationName", migrationName),
              )
              .collect()
      ).pipe(Effect.orDie)) as ReadonlyArray<MigrationReceiptInsert>;
      return {
        receipts: [...rows].sort(
          (a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId),
        ),
      };
    }),
);

export default GroupImpl.make(databaseSchema, migrations).pipe(
  Layer.provide(reserveStableKeysImpl),
  Layer.provide(reserveBrainKeysImpl),
  Layer.provide(reservePageKeysImpl),
  Layer.provide(runBatchInternal),
  Layer.provide(listReceiptsInternal),
  GroupImpl.finalize,
);
