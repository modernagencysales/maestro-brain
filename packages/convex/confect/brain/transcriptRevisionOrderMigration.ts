import { DataModel, type DatabaseSchema } from "@confect/server";
import type { GenericDatabaseWriter } from "convex/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import databaseSchema from "../_generated/schema";
import { MutationCtx } from "../_generated/services";
import { sha256Hex } from "../shared/sha256";
import {
  deriveFrozenLegacyTranscriptRevisionOrder,
  sameTranscriptRevisionOrder,
  TRANSCRIPT_ADAPTER_ORDER_VERSION,
  transcriptRevisionOrderDigestInput,
  transcriptRevisionOrderMatchesFrozenContract,
  type TranscriptAdapterOrderVersion,
  type TranscriptRevisionOrderConflictKind,
} from "../sources/transcriptRevisionOrder";
import {
  TranscriptRevisionOrderBackfillConflict,
  TranscriptRevisionOrderBackfillNotFound,
} from "./rolloutOperations.spec";

type MigrationConfectDataModel = DataModel.FromTables<
  DatabaseSchema.Tables<typeof databaseSchema>
>;
type MigrationDataModel = DataModel.ToConvex<MigrationConfectDataModel>;
type MigrationDoc = DataModel.DocumentWithName<
  MigrationConfectDataModel,
  "transcriptRevisionOrderMigrations"
>;
type MigrationInsert = Omit<MigrationDoc, "_creationTime" | "_id">;
type MigrationPatch = Partial<MigrationInsert>;
type MigrationItemDoc = DataModel.DocumentWithName<
  MigrationConfectDataModel,
  "transcriptRevisionOrderMigrationItems"
>;
type MigrationItemInsert = Omit<MigrationItemDoc, "_creationTime" | "_id">;
type SourceUnitDoc = DataModel.DocumentWithName<
  MigrationConfectDataModel,
  "sourceUnits"
>;
type SourceUnitRevisionDoc = DataModel.DocumentWithName<
  MigrationConfectDataModel,
  "sourceUnitRevisions"
>;
type RevisionOrder = NonNullable<SourceUnitRevisionDoc["revisionOrder"]>;
type ActiveMigration = MigrationDoc & {
  readonly activeRunKey: string;
  readonly activeStage: NonNullable<MigrationDoc["activeStage"]>;
  readonly activeAdapterOrderVersion: TranscriptAdapterOrderVersion;
  readonly scanHighWater: number;
  readonly pinnedSourcePopulationGeneration: number;
  readonly predecessorDigest: string;
};

const MAX_REVISION_HISTORY = 100;

const rawDatabase = (ctx: Effect.Effect.Success<typeof MutationCtx>) =>
  ctx.db as unknown as GenericDatabaseWriter<MigrationDataModel>;

const digest = (value: unknown): string =>
  `sha256:${sha256Hex(JSON.stringify(value))}`;

const migrationKey = (organizationKey: string): string =>
  `tromstate_${sha256Hex(
    JSON.stringify({ kind: "transcript_revision_order", organizationKey }),
  )}`;

const runKey = (input: {
  readonly migrationKey: string;
  readonly adapterOrderVersion: TranscriptAdapterOrderVersion;
  readonly runGeneration: number;
  readonly sourcePopulationGeneration: number;
}): string => `trom_${sha256Hex(JSON.stringify(input))}`;

const initialPopulationDigest = (): string =>
  digest({ kind: "transcript_revision_order_population", rows: [] });

const advancePopulationDigest = (
  predecessorDigest: string,
  itemDigest: string,
): string => digest({ predecessorDigest, itemDigest });

const activeMigration = (row: MigrationDoc): ActiveMigration | null =>
  row.activeRunKey !== null &&
  row.activeStage !== null &&
  row.activeAdapterOrderVersion !== null &&
  row.scanHighWater !== null &&
  row.pinnedSourcePopulationGeneration !== null &&
  row.predecessorDigest !== null
    ? (row as ActiveMigration)
    : null;

const progressFrom = (row: ActiveMigration) => ({
  runKey: row.activeRunKey,
  runGeneration: row.activeRunGeneration,
  adapterOrderVersion: row.activeAdapterOrderVersion,
  stage: row.activeStage,
  cursor: row.activeCursor,
  sourcePopulationGeneration: row.sourcePopulationGeneration,
  pinnedSourcePopulationGeneration: row.pinnedSourcePopulationGeneration,
  processed: row.processedUnitCount,
  backfilled: row.backfilledUnitCount,
  excluded: row.excludedUnitCount,
  conflictCount: row.conflictCount,
  blockingConflict: row.terminalConflictKind,
  terminal: row.activeStage === "complete" || row.activeStage === "blocked",
  readyForPromotion:
    row.activeStage === "complete" &&
    row.conflictCount === 0 &&
    row.completion !== null,
  completionDigest: row.completion?.completionDigest ?? null,
});

const loadMigrationByOrganizationEffect = (organizationKey: string) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const rows = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("transcriptRevisionOrderMigrations")
        .withIndex("by_organization", (query) =>
          query.eq("organizationKey", organizationKey),
        )
        .take(2),
    );
    if (rows.length > 1)
      return yield* new TranscriptRevisionOrderBackfillConflict({
        reason: "integrity_conflict",
        detail:
          "More than one transcript revision-order migration state exists for the organization.",
      });
    return rows[0] ?? null;
  });

const loadMigrationByRunEffect = (activeRunKey: string) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const rows = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("transcriptRevisionOrderMigrations")
        .withIndex("by_active_run_key", (query) =>
          query.eq("activeRunKey", activeRunKey),
        )
        .take(2),
    );
    if (rows.length > 1)
      return yield* new TranscriptRevisionOrderBackfillConflict({
        reason: "integrity_conflict",
        detail:
          "More than one transcript revision-order migration state owns the run key.",
      });
    return rows[0] ?? null;
  });

const insertMigrationEffect = (row: MigrationInsert) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const id = yield* Effect.promise(() =>
      rawDatabase(ctx).insert("transcriptRevisionOrderMigrations", row),
    );
    return { ...row, _id: id, _creationTime: row.createdAt } as MigrationDoc;
  });

const patchMigrationEffect = (row: MigrationDoc, patch: MigrationPatch) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    yield* Effect.promise(() => rawDatabase(ctx).patch(row._id, patch));
    return { ...row, ...patch } as MigrationDoc;
  });

const loadSourceUnitPageEffect = (
  migration: ActiveMigration,
  batchSize: number,
) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    return yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("sourceUnits")
        .withIndex("by_unit_key", (query) =>
          query.eq("organizationKey", migration.organizationKey),
        )
        .paginate({ cursor: migration.activeCursor, numItems: batchSize }),
    );
  });

const loadCurrentRevisionEffect = (unit: SourceUnitDoc) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const rows = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("sourceUnitRevisions")
        .withIndex("by_unit_revision_key", (query) =>
          query
            .eq("organizationKey", unit.organizationKey)
            .eq("unitRevisionKey", unit.currentUnitRevisionKey),
        )
        .take(2),
    );
    return rows;
  });

const loadRevisionHistoryEffect = (unit: SourceUnitDoc) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    return yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("sourceUnitRevisions")
        .withIndex("by_unit_created", (query) =>
          query
            .eq("organizationKey", unit.organizationKey)
            .eq("unitKey", unit.unitKey),
        )
        .take(MAX_REVISION_HISTORY + 1),
    );
  });

const loadMigrationItemEffect = (input: {
  readonly runKey: string;
  readonly unitKey: string;
}) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const rows = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("transcriptRevisionOrderMigrationItems")
        .withIndex("by_run_unit", (query) =>
          query.eq("runKey", input.runKey).eq("unitKey", input.unitKey),
        )
        .take(2),
    );
    if (rows.length > 1)
      return yield* new TranscriptRevisionOrderBackfillConflict({
        reason: "integrity_conflict",
        detail: `More than one migration item exists for unit ${input.unitKey}.`,
      });
    return rows[0] ?? null;
  });

type UnitClassification =
  | {
      readonly classification: "backfilled" | "excluded";
      readonly conflictKind: null;
      readonly revisionOrder: RevisionOrder;
    }
  | {
      readonly classification: "conflict";
      readonly conflictKind: TranscriptRevisionOrderConflictKind;
      readonly revisionOrder: null;
    };

const conflict = (
  conflictKind: TranscriptRevisionOrderConflictKind,
): UnitClassification => ({
  classification: "conflict",
  conflictKind,
  revisionOrder: null,
});

const orderForRevision = (input: {
  readonly unit: SourceUnitDoc;
  readonly revision: SourceUnitRevisionDoc;
  readonly historyCount: number;
}): RevisionOrder | null => {
  if (input.revision.revisionOrder !== undefined)
    return transcriptRevisionOrderMatchesFrozenContract({
      providerKey: input.unit.providerKey,
      tombstone: input.revision.tombstone,
      revisionOrder: input.revision.revisionOrder,
    })
      ? input.revision.revisionOrder
      : null;
  return deriveFrozenLegacyTranscriptRevisionOrder({
    providerKey: input.unit.providerKey,
    tombstone: input.revision.tombstone,
    providerMetadataJson: input.revision.providerMetadataJson,
    historyCount: input.historyCount,
  });
};

const classifyUnit = (input: {
  readonly unit: SourceUnitDoc;
  readonly currentRevisionRows: readonly SourceUnitRevisionDoc[];
  readonly history: readonly SourceUnitRevisionDoc[];
}): UnitClassification => {
  if (input.history.length > MAX_REVISION_HISTORY)
    return conflict("revision_history_capacity");
  if (input.currentRevisionRows.length !== 1)
    return conflict("current_revision_missing");
  const currentRevision = input.currentRevisionRows[0];
  if (
    currentRevision === undefined ||
    currentRevision.unitKey !== input.unit.unitKey ||
    !input.history.some(
      ({ unitRevisionKey }) =>
        unitRevisionKey === input.unit.currentUnitRevisionKey,
    )
  )
    return conflict("current_revision_mismatch");

  const historyOrders = input.history.map((revision) => ({
    revision,
    order: orderForRevision({
      unit: input.unit,
      revision,
      historyCount: input.history.length,
    }),
  }));
  for (const { revision, order } of historyOrders)
    if (revision.revisionOrder !== undefined && order === null)
      return conflict("adapter_contract_mismatch");

  const revisionOrder = orderForRevision({
    unit: input.unit,
    revision: currentRevision,
    historyCount: input.history.length,
  });
  const unitOrder = input.unit.currentRevisionOrder;
  if (
    revisionOrder !== null &&
    unitOrder !== undefined &&
    !sameTranscriptRevisionOrder(revisionOrder, unitOrder)
  )
    return conflict("current_revision_mismatch");
  const resolvedOrder = revisionOrder ?? unitOrder ?? null;
  const comparableHistoryOrders = historyOrders.map((entry) =>
    entry.revision.unitRevisionKey === input.unit.currentUnitRevisionKey &&
    entry.order === null
      ? { ...entry, order: resolvedOrder }
      : entry,
  );

  const hasTombstone = input.history.some(({ tombstone }) => tombstone);
  const hasLiveRevision = input.history.some(({ tombstone }) => !tombstone);
  if (
    hasTombstone &&
    hasLiveRevision &&
    comparableHistoryOrders.some(({ order }) => order === null)
  )
    return conflict("ambiguous_tombstone_recreation");

  if (resolvedOrder === null)
    return conflict(
      input.unit.currentRevisionOrderVersion === undefined &&
        currentRevision.revisionOrderVersion === undefined
        ? "missing_provider_version"
        : "missing_order_evidence",
    );
  if (
    !transcriptRevisionOrderMatchesFrozenContract({
      providerKey: input.unit.providerKey,
      tombstone: currentRevision.tombstone,
      revisionOrder: resolvedOrder,
    })
  )
    return conflict("adapter_contract_mismatch");

  for (
    let leftIndex = 0;
    leftIndex < comparableHistoryOrders.length;
    leftIndex += 1
  ) {
    const left = comparableHistoryOrders[leftIndex];
    if (left?.order === null || left === undefined) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < comparableHistoryOrders.length;
      rightIndex += 1
    ) {
      const right = comparableHistoryOrders[rightIndex];
      if (right?.order === null || right === undefined) continue;
      if (
        sameTranscriptRevisionOrder(left.order, right.order) &&
        (left.revision.contentHash !== right.revision.contentHash ||
          left.revision.tombstone !== right.revision.tombstone)
      )
        return conflict("equal_order_content");
    }
  }

  const alreadyFrozen =
    unitOrder !== undefined &&
    currentRevision.revisionOrder !== undefined &&
    sameTranscriptRevisionOrder(unitOrder, resolvedOrder) &&
    sameTranscriptRevisionOrder(currentRevision.revisionOrder, resolvedOrder) &&
    input.unit.currentRevisionOrderVersion ===
      TRANSCRIPT_ADAPTER_ORDER_VERSION &&
    currentRevision.revisionOrderVersion === TRANSCRIPT_ADAPTER_ORDER_VERSION;
  return {
    classification: alreadyFrozen ? "excluded" : "backfilled",
    conflictKind: null,
    revisionOrder: resolvedOrder,
  };
};

const inspectAndRecordUnitEffect = (
  migration: ActiveMigration,
  unit: SourceUnitDoc,
  at: number,
) =>
  Effect.gen(function* () {
    const existing = yield* loadMigrationItemEffect({
      runKey: migration.activeRunKey,
      unitKey: unit.unitKey,
    });
    if (existing !== null) return existing;

    const currentRevisionRows = yield* loadCurrentRevisionEffect(unit);
    const history = yield* loadRevisionHistoryEffect(unit);
    const classification = classifyUnit({
      unit,
      currentRevisionRows,
      history,
    });
    const currentRevision = currentRevisionRows[0];
    const observedContentHash =
      currentRevision?.contentHash ??
      digest({
        kind: "missing_current_revision",
        unitKey: unit.unitKey,
        currentUnitRevisionKey: unit.currentUnitRevisionKey,
      });
    const observedTombstone =
      currentRevision?.tombstone ??
      unit.lifecycle.state === "deleted_tombstone";
    if (
      classification.classification === "backfilled" &&
      currentRevision !== undefined
    ) {
      const ctx = yield* MutationCtx;
      yield* Effect.promise(() =>
        rawDatabase(ctx).patch(currentRevision._id, {
          revisionOrder: classification.revisionOrder,
          revisionOrderVersion: TRANSCRIPT_ADAPTER_ORDER_VERSION,
        }),
      );
      yield* Effect.promise(() =>
        rawDatabase(ctx).patch(unit._id, {
          currentRevisionOrder: classification.revisionOrder,
          currentRevisionOrderVersion: TRANSCRIPT_ADAPTER_ORDER_VERSION,
        }),
      );
    }
    const itemBase = {
      schemaVersion: 1 as const,
      organizationKey: migration.organizationKey,
      runKey: migration.activeRunKey,
      runGeneration: migration.activeRunGeneration,
      adapterOrderVersion: migration.activeAdapterOrderVersion,
      unitKey: unit.unitKey,
      currentUnitRevisionKey: unit.currentUnitRevisionKey,
      observedContentHash,
      observedTombstone,
      observedRevisionOrder:
        classification.classification === "conflict"
          ? null
          : classification.revisionOrder,
      classification: classification.classification,
      conflictKind: classification.conflictKind,
      historyCount: Math.min(history.length, MAX_REVISION_HISTORY + 1),
      createdAt: at,
    };
    const row: MigrationItemInsert = {
      ...itemBase,
      itemDigest: digest({
        ...itemBase,
        observedRevisionOrder:
          itemBase.observedRevisionOrder === null
            ? null
            : transcriptRevisionOrderDigestInput(
                itemBase.observedRevisionOrder,
              ),
      }),
    };
    const ctx = yield* MutationCtx;
    const id = yield* Effect.promise(() =>
      rawDatabase(ctx).insert("transcriptRevisionOrderMigrationItems", row),
    );
    return { ...row, _id: id, _creationTime: at } as MigrationItemDoc;
  });

const blockMigrationEffect = (
  migration: ActiveMigration,
  conflictKind: TranscriptRevisionOrderConflictKind,
  additionalConflicts: number,
  at: number,
) =>
  Effect.gen(function* () {
    const blocked = yield* patchMigrationEffect(migration, {
      activeStage: "blocked",
      activeCursor: null,
      conflictCount: migration.conflictCount + additionalConflicts,
      terminalConflictKind: migration.terminalConflictKind ?? conflictKind,
      updatedAt: at,
    });
    return progressFrom(activeMigration(blocked) ?? migration);
  });

const closeMigrationEffect = (migration: ActiveMigration, at: number) =>
  Effect.gen(function* () {
    if (migration.completion !== null)
      return yield* new TranscriptRevisionOrderBackfillConflict({
        reason: "completion_immutable",
        detail:
          "The transcript revision-order migration already has an immutable completion receipt.",
      });
    if (migration.conflictCount !== 0)
      return yield* blockMigrationEffect(
        migration,
        migration.terminalConflictKind ?? "concurrent_revision_change",
        0,
        at,
      );
    if (
      migration.sourcePopulationGeneration !==
      migration.pinnedSourcePopulationGeneration
    )
      return yield* blockMigrationEffect(
        migration,
        "concurrent_revision_change",
        1,
        at,
      );
    const completionBase = {
      runKey: migration.activeRunKey,
      runGeneration: migration.activeRunGeneration,
      adapterOrderVersion: migration.activeAdapterOrderVersion,
      scanHighWater: migration.scanHighWater,
      sourcePopulationGeneration: migration.pinnedSourcePopulationGeneration,
      populationDigest: migration.predecessorDigest,
      processedUnitCount: migration.processedUnitCount,
      backfilledUnitCount: migration.backfilledUnitCount,
      excludedUnitCount: migration.excludedUnitCount,
      conflictCount: 0 as const,
      completedAt: at,
    };
    const completion = {
      ...completionBase,
      completionDigest: digest(completionBase),
    };
    const completed = yield* patchMigrationEffect(migration, {
      activeStage: "complete",
      activeCursor: null,
      terminalConflictKind: null,
      completion,
      updatedAt: at,
    });
    return progressFrom(activeMigration(completed) ?? migration);
  });

const processScanPageEffect = (migration: ActiveMigration, batchSize: number) =>
  Effect.gen(function* () {
    const pageResult = yield* loadSourceUnitPageEffect(migration, batchSize);
    const at = yield* Clock.currentTimeMillis;
    let predecessorDigest = migration.predecessorDigest;
    let processed = 0;
    let backfilled = 0;
    let excluded = 0;
    let conflicts = 0;
    let firstConflict = migration.terminalConflictKind;
    for (const unit of pageResult.page) {
      if (unit._creationTime > migration.scanHighWater) continue;
      const item = yield* inspectAndRecordUnitEffect(migration, unit, at);
      processed += 1;
      predecessorDigest = advancePopulationDigest(
        predecessorDigest,
        item.itemDigest,
      );
      if (item.classification === "backfilled") backfilled += 1;
      else if (item.classification === "excluded") excluded += 1;
      else {
        conflicts += 1;
        firstConflict ??= item.conflictKind ?? "missing_order_evidence";
      }
    }
    const updated = yield* patchMigrationEffect(migration, {
      activeCursor: pageResult.isDone ? null : pageResult.continueCursor,
      predecessorDigest,
      processedUnitCount: migration.processedUnitCount + processed,
      backfilledUnitCount: migration.backfilledUnitCount + backfilled,
      excludedUnitCount: migration.excludedUnitCount + excluded,
      conflictCount: migration.conflictCount + conflicts,
      terminalConflictKind: firstConflict,
      updatedAt: at,
    });
    const active = activeMigration(updated);
    if (active === null)
      return yield* Effect.dieMessage(
        "Transcript revision-order migration lost its active run state.",
      );
    if (!pageResult.isDone) return progressFrom(active);
    if (
      active.sourcePopulationGeneration !==
      active.pinnedSourcePopulationGeneration
    )
      return yield* blockMigrationEffect(
        active,
        "concurrent_revision_change",
        1,
        at,
      );
    if (active.conflictCount > 0)
      return yield* blockMigrationEffect(
        active,
        active.terminalConflictKind ?? "missing_order_evidence",
        0,
        at,
      );
    const validating = yield* patchMigrationEffect(active, {
      activeStage: "validating",
      activeCursor: null,
      updatedAt: at,
    });
    return progressFrom(activeMigration(validating) ?? active);
  });

const validationItemMatches = (input: {
  readonly unit: SourceUnitDoc;
  readonly revisionRows: readonly SourceUnitRevisionDoc[];
  readonly historyCount: number;
  readonly item: MigrationItemDoc | null;
}): boolean => {
  const revision = input.revisionRows[0];
  const item = input.item;
  return (
    input.revisionRows.length === 1 &&
    revision !== undefined &&
    item !== null &&
    item.classification !== "conflict" &&
    input.unit.currentUnitRevisionKey === item.currentUnitRevisionKey &&
    revision.unitKey === input.unit.unitKey &&
    revision.contentHash === item.observedContentHash &&
    revision.tombstone === item.observedTombstone &&
    input.historyCount === item.historyCount &&
    item.observedRevisionOrder !== null &&
    input.unit.currentRevisionOrder !== undefined &&
    revision.revisionOrder !== undefined &&
    sameTranscriptRevisionOrder(
      input.unit.currentRevisionOrder,
      item.observedRevisionOrder,
    ) &&
    sameTranscriptRevisionOrder(
      revision.revisionOrder,
      item.observedRevisionOrder,
    ) &&
    input.unit.currentRevisionOrderVersion ===
      TRANSCRIPT_ADAPTER_ORDER_VERSION &&
    revision.revisionOrderVersion === TRANSCRIPT_ADAPTER_ORDER_VERSION
  );
};

const processValidationPageEffect = (
  migration: ActiveMigration,
  batchSize: number,
) =>
  Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    if (
      migration.sourcePopulationGeneration !==
      migration.pinnedSourcePopulationGeneration
    )
      return yield* blockMigrationEffect(
        migration,
        "concurrent_revision_change",
        1,
        at,
      );
    const pageResult = yield* loadSourceUnitPageEffect(migration, batchSize);
    let conflicts = 0;
    for (const unit of pageResult.page) {
      if (unit._creationTime > migration.scanHighWater) continue;
      const [revisionRows, history, item] = yield* Effect.all([
        loadCurrentRevisionEffect(unit),
        loadRevisionHistoryEffect(unit),
        loadMigrationItemEffect({
          runKey: migration.activeRunKey,
          unitKey: unit.unitKey,
        }),
      ]);
      if (
        !validationItemMatches({
          unit,
          revisionRows,
          historyCount: history.length,
          item,
        })
      )
        conflicts += 1;
    }
    if (conflicts > 0)
      return yield* blockMigrationEffect(
        migration,
        "concurrent_revision_change",
        conflicts,
        at,
      );
    const updated = yield* patchMigrationEffect(migration, {
      activeCursor: pageResult.isDone ? null : pageResult.continueCursor,
      updatedAt: at,
    });
    const active = activeMigration(updated);
    if (active === null)
      return yield* Effect.dieMessage(
        "Transcript revision-order migration validation lost its active run state.",
      );
    return pageResult.isDone
      ? yield* closeMigrationEffect(active, at)
      : progressFrom(active);
  });

export const startTranscriptRevisionOrderBackfillEffect = (args: {
  readonly organizationKey: string;
  readonly adapterOrderVersion: TranscriptAdapterOrderVersion;
  readonly batchSize: number;
}) =>
  Effect.gen(function* () {
    const stored = yield* loadMigrationByOrganizationEffect(
      args.organizationKey,
    );
    const active = stored === null ? null : activeMigration(stored);
    if (stored?.completion !== null && stored?.completion !== undefined) {
      if (active === null)
        return yield* new TranscriptRevisionOrderBackfillConflict({
          reason: "integrity_conflict",
          detail:
            "The immutable transcript revision-order receipt has no matching active run state.",
        });
      if (stored.completion.adapterOrderVersion !== args.adapterOrderVersion)
        return yield* new TranscriptRevisionOrderBackfillConflict({
          reason: "completion_immutable",
          detail:
            "The completed transcript revision-order migration uses a different adapter-order version.",
        });
      return progressFrom(active);
    }
    if (active !== null) {
      if (active.activeAdapterOrderVersion !== args.adapterOrderVersion)
        return yield* new TranscriptRevisionOrderBackfillConflict({
          reason: "adapter_version_changed",
          detail:
            "A transcript revision-order migration with a different frozen adapter-order version is active.",
        });
      if (
        active.activeStage !== "blocked" ||
        active.sourcePopulationGeneration ===
          active.pinnedSourcePopulationGeneration
      )
        return progressFrom(active);
    }

    const at = yield* Clock.currentTimeMillis;
    const stateKey = stored?.migrationKey ?? migrationKey(args.organizationKey);
    const sourcePopulationGeneration = stored?.sourcePopulationGeneration ?? 0;
    const activeRunGeneration = (stored?.activeRunGeneration ?? 0) + 1;
    const activeRunKey = runKey({
      migrationKey: stateKey,
      adapterOrderVersion: args.adapterOrderVersion,
      runGeneration: activeRunGeneration,
      sourcePopulationGeneration,
    });
    const next: MigrationInsert = {
      schemaVersion: 1,
      organizationKey: args.organizationKey,
      migrationKey: stateKey,
      sourcePopulationGeneration,
      activeRunKey,
      activeRunGeneration,
      activeStage: "scanning",
      activeCursor: null,
      activeAdapterOrderVersion: args.adapterOrderVersion,
      scanHighWater: at,
      pinnedSourcePopulationGeneration: sourcePopulationGeneration,
      predecessorDigest: initialPopulationDigest(),
      processedUnitCount: 0,
      backfilledUnitCount: 0,
      excludedUnitCount: 0,
      conflictCount: 0,
      terminalConflictKind: null,
      completion: null,
      createdAt: stored?.createdAt ?? at,
      updatedAt: at,
    };
    const started =
      stored === null
        ? yield* insertMigrationEffect(next)
        : yield* patchMigrationEffect(stored, next);
    const startedActive = activeMigration(started);
    if (startedActive === null)
      return yield* Effect.dieMessage(
        "Transcript revision-order migration start did not persist active run state.",
      );
    return progressFrom(startedActive);
  });

export const resumeTranscriptRevisionOrderBackfillEffect = (args: {
  readonly runKey: string;
  readonly expectedRunGeneration: number;
  readonly batchSize: number;
}) =>
  Effect.gen(function* () {
    const stored = yield* loadMigrationByRunEffect(args.runKey);
    const migration = stored === null ? null : activeMigration(stored);
    if (migration === null)
      return yield* new TranscriptRevisionOrderBackfillNotFound({
        runKey: args.runKey,
      });
    if (migration.activeRunGeneration !== args.expectedRunGeneration)
      return yield* new TranscriptRevisionOrderBackfillConflict({
        reason: "generation_changed",
        detail: `Expected run generation ${args.expectedRunGeneration}, found ${migration.activeRunGeneration}.`,
      });
    if (migration.activeStage === "scanning")
      return yield* processScanPageEffect(migration, args.batchSize);
    if (migration.activeStage === "validating")
      return yield* processValidationPageEffect(migration, args.batchSize);
    return progressFrom(migration);
  });
