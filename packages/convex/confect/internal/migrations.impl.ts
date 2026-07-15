import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import migrations, {
  type AllowedMigrationName,
  type MigrationBatchRunArgs,
  MigrationAlreadyRunning,
  MigrationBatchFailed,
  MigrationCursorInvalid,
  MigrationNotFound,
  migrationDefinitions,
} from "./migrations.spec";

const DEFAULT_BATCH_SIZE = 25;
const MILLISECONDS_PER_DAY = 86_400_000;

export type MigrationReceiptState = "planned" | "running" | "complete" | "failed";
export type WorkspaceForMigration = {
  readonly _id: unknown;
  readonly slug: string;
  readonly updatedAt: number;
};
export type MigrationReceiptForResume = {
  readonly migrationName: AllowedMigrationName;
  readonly state: MigrationReceiptState;
  readonly cursor: string | null;
  readonly releaseCommit: string;
  readonly schemaBefore: string;
  readonly schemaAfter: string;
  readonly startedAt: number;
};
export type MigrationStore<R = never> = {
  readonly collectWorkspaces: Effect.Effect<ReadonlyArray<WorkspaceForMigration>, never, R>;
  readonly latestReceipt: (
    migrationName: AllowedMigrationName,
  ) => Effect.Effect<MigrationReceiptForResume | null, never, R>;
  readonly patchWorkspaceSlug: (
    workspace: WorkspaceForMigration,
    slug: string,
  ) => Effect.Effect<void, never, R>;
  readonly appendReceipt: (
    receipt: MigrationReceiptInsert,
  ) => Effect.Effect<void, never, R>;
};

export type MigrationReceiptInsert = {
  readonly runId: string;
  readonly migrationName: AllowedMigrationName;
  readonly mode: "execute";
  readonly state: "complete";
  readonly phase: "expand" | "backfill" | "verify" | "contract";
  readonly cursor: string | null;
  readonly batchSize: number;
  readonly scanned: number;
  readonly changed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly complete: boolean;
  readonly releaseCommit: string;
  readonly schemaBefore: string;
  readonly schemaAfter: string;
  readonly parityChecks: ReadonlyArray<string>;
  readonly rollbackOwner: string;
  readonly observationEndsAt: number;
  readonly actorKind: "system" | "operator";
  readonly actorKey: string;
  readonly deploymentId: string;
  readonly buildId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly childReceiptHashes: ReadonlyArray<string>;
};

type MigrationDefinition = (typeof migrationDefinitions)[number];

const definitionsByName = new Map<AllowedMigrationName, MigrationDefinition>(
  migrationDefinitions.map((definition) => [definition.name, definition]),
);

const hashChildReceipt = (input: {
  migrationName: string;
  mode: string;
  cursor: string | null;
  scanned: number;
  changed: number;
  skipped: number;
  failed: number;
  startedAt: number;
  finishedAt: number;
}): string =>
  [
    input.migrationName,
    input.mode,
    input.cursor ?? "null",
    input.scanned,
    input.changed,
    input.skipped,
    input.failed,
    input.startedAt,
    input.finishedAt,
  ].join(":");

const cursorForIndex = (index: number): string => `workspaces:${index}`;

const indexFromCursor = (
  migrationName: AllowedMigrationName,
  cursor: string | null,
): Effect.Effect<number, MigrationCursorInvalid> => {
  if (cursor === null) return Effect.succeed(0);
  const match = /^workspaces:(\d+)$/.exec(cursor);
  if (match === null) {
    return new MigrationCursorInvalid({ migrationName, cursor });
  }
  return Effect.succeed(Number(match[1]));
};

const validateDefinition = (
  migrationName: AllowedMigrationName,
): Effect.Effect<MigrationDefinition, MigrationNotFound | MigrationBatchFailed> => {
  const definition = definitionsByName.get(migrationName);
  if (definition === undefined) {
    return new MigrationNotFound({ migrationName });
  }
  if (definition.destructive) {
    return new MigrationBatchFailed({
      migrationName,
      reason: "expand/backfill harness refuses destructive definitions",
    });
  }
  return Effect.succeed(definition);
};

const validateLatest = (
  input: MigrationBatchRunArgs,
  latest: MigrationReceiptForResume | null,
): Effect.Effect<
  MigrationReceiptForResume | null,
  MigrationAlreadyRunning | MigrationCursorInvalid
> => {
  if (latest === null) return Effect.succeed<MigrationReceiptForResume | null>(latest);
  if (latest.state === "running") {
    return new MigrationAlreadyRunning({ migrationName: input.migrationName });
  }
  if (
    latest.releaseCommit !== input.releaseCommit ||
    latest.schemaBefore !== input.schemaBefore ||
    latest.schemaAfter !== input.schemaAfter
  ) {
    return new MigrationCursorInvalid({
      migrationName: input.migrationName,
      cursor: latest.cursor ?? "null",
    });
  }
  return Effect.succeed(latest);
};

const shouldChangeWorkspace = (
  migrationName: AllowedMigrationName,
  workspace: WorkspaceForMigration,
): boolean => migrationName === "reserveStableKeys" && !workspace.slug.startsWith("stable-");

export const runMigrationBatch = <R>(
  store: MigrationStore<R>,
  input: MigrationBatchRunArgs,
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
  MigrationNotFound | MigrationAlreadyRunning | MigrationCursorInvalid | MigrationBatchFailed,
  R
> =>
  Effect.gen(function* () {
    const definition = yield* validateDefinition(input.migrationName);
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    if (batchSize > definition.batchCap) {
      return yield* new MigrationBatchFailed({
        migrationName: input.migrationName,
        reason: "batch size exceeds fixed migration cap",
      });
    }

    const latest = yield* store.latestReceipt(input.migrationName).pipe(
      Effect.flatMap((receipt) => validateLatest(input, receipt)),
    );
    const resumeCursor = latest?.state === "failed" ? latest.cursor : null;
    const startIndex = yield* indexFromCursor(input.migrationName, resumeCursor);
    const startedAt = yield* Clock.currentTimeMillis;
    const workspaces = yield* store.collectWorkspaces;
    const batch = workspaces.slice(startIndex, startIndex + batchSize);
    let changed = 0;
    let skipped = 0;

    for (const workspace of batch) {
      if (shouldChangeWorkspace(input.migrationName, workspace)) {
        changed += 1;
        if (input.mode === "execute") {
          yield* store.patchWorkspaceSlug(workspace, `stable-${workspace.slug}`);
        }
      } else {
        skipped += 1;
      }
    }

    const nextIndex = startIndex + batch.length;
    const complete = nextIndex >= workspaces.length;
    const cursor = complete ? resumeCursor : cursorForIndex(nextIndex);
    const finishedAt = yield* Clock.currentTimeMillis;
    const receipt = {
      migrationName: input.migrationName,
      mode: input.mode,
      cursor,
      scanned: batch.length,
      changed,
      skipped,
      failed: 0,
      complete,
      startedAt,
      finishedAt,
    };

    if (input.mode === "execute") {
      yield* store.appendReceipt({
        runId: `${input.migrationName}:${startedAt}`,
        migrationName: input.migrationName,
        mode: input.mode,
        state: "complete",
        phase: definition.phase,
        cursor,
        batchSize,
        scanned: receipt.scanned,
        changed: receipt.changed,
        skipped: receipt.skipped,
        failed: receipt.failed,
        complete: receipt.complete,
        releaseCommit: input.releaseCommit,
        schemaBefore: input.schemaBefore,
        schemaAfter: input.schemaAfter,
        parityChecks: input.parityChecks ?? [],
        rollbackOwner: input.rollbackOwner ?? "platform",
        observationEndsAt: input.observationEndsAt ?? finishedAt + MILLISECONDS_PER_DAY,
        actorKind: input.actor.kind,
        actorKey: input.actor.key,
        deploymentId: input.deploymentId,
        buildId: input.buildId,
        startedAt,
        finishedAt,
        childReceiptHashes: [hashChildReceipt(receipt)],
      });
    }

    return receipt;
  });

export const listMigrationReceipts = <R>(
  store: Pick<MigrationStore<R>, "latestReceipt">,
  migrationName: AllowedMigrationName,
) => store.latestReceipt(migrationName);

type DynamicReadTable = {
  collect: () => Effect.Effect<ReadonlyArray<unknown>, unknown, DatabaseReader>;
  index: (
    name: string,
    range?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
  ) => DynamicReadTable;
};
type DynamicWriteTable = DynamicReadTable & {
  patch: (id: unknown, value: unknown) => Effect.Effect<void, unknown, DatabaseWriter>;
  insert: (value: unknown) => Effect.Effect<void, unknown, DatabaseWriter>;
};
type DynamicReadDatabase = { table: (name: string) => DynamicReadTable };
type DynamicWriteDatabase = { table: (name: string) => DynamicWriteTable };

const readTable = (db: unknown, name: string): DynamicReadTable =>
  (db as DynamicReadDatabase).table(name);
const writeTable = (db: unknown, name: string): DynamicWriteTable =>
  (db as DynamicWriteDatabase).table(name);

const liveStore: MigrationStore<DatabaseReader | DatabaseWriter> = {
  collectWorkspaces: Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* readTable(reader, "workspaces").collect().pipe(Effect.orDie);
    return rows as ReadonlyArray<WorkspaceForMigration>;
  }),
  latestReceipt: (migrationName) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const receipts = (yield* readTable(reader, "migrationReceipts")
        .index("by_migration_started", (q) => q.eq("migrationName", migrationName))
        .collect()
        .pipe(Effect.orDie)) as ReadonlyArray<MigrationReceiptForResume>;
      return [...receipts].sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
    }),
  patchWorkspaceSlug: (workspace, slug) =>
    Effect.gen(function* () {
      const writer = yield* DatabaseWriter;
      yield* writeTable(writer, "workspaces")
        .patch(workspace._id, {
          slug,
          updatedAt: workspace.updatedAt + 1,
        })
        .pipe(Effect.orDie);
    }),
  appendReceipt: (receipt) =>
    Effect.gen(function* () {
      const writer = yield* DatabaseWriter;
      yield* writeTable(writer, "migrationReceipts").insert(receipt).pipe(Effect.orDie);
    }),
};

const runBatchInternal = FunctionImpl.make(
  databaseSchema,
  migrations,
  "runBatchInternal",
  (input) => runMigrationBatch(liveStore, input),
);

const listReceiptsInternal = FunctionImpl.make(
  databaseSchema,
  migrations,
  "listReceiptsInternal",
  ({ migrationName }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const receipts = (yield* (migrationName === undefined
        ? readTable(reader, "migrationReceipts").collect()
        : readTable(reader, "migrationReceipts")
            .index("by_migration_started", (q) => q.eq("migrationName", migrationName))
            .collect()
      ).pipe(Effect.orDie)) as ReadonlyArray<MigrationReceiptInsert>;
      return {
        receipts: [...receipts].sort((a, b) => a.startedAt - b.startedAt),
      };
    }),
);

export default GroupImpl.make(databaseSchema, migrations).pipe(
  Layer.provide(runBatchInternal),
  Layer.provide(listReceiptsInternal),
  GroupImpl.finalize,
);
