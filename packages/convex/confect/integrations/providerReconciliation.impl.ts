import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { sha256Hex } from "../shared/sha256";
import {
  beginProviderPagePlan,
  closeReconciliationTraversalPlan,
  commitProviderPageChunkPlan,
  completeReconciliationRunPlan,
  finalizeProviderPagePlan,
  isSuccessfulObligationState,
  openReconciliationRunPlan,
  planReconciliationRemovals,
  ProviderReconciliationInvariant,
  type ProviderReconciliationInvariantReason,
  reconciliationScopeTupleDigest,
  transitionIngestionObligationPlan,
  type ConnectorCursorState,
  type IngestionObligationState,
  type ProviderObservation,
  type ProviderPageChunkReceipt,
  type ProviderPageEnvelope,
  type ReconciliationRunState,
  type ReconciliationScopeAuthority,
  type RemovalCandidate,
} from "./providerReconciliation";
import providerReconciliation, {
  ProviderReconciliationConflict,
  ProviderReconciliationNotFound,
} from "./providerReconciliation.spec";

const MAX_CHUNKS = 64;
const NONTERMINAL_OBLIGATION_STATES = [
  "captured",
  "normalization_pending",
  "quarantined",
  "target_resolution_pending",
  "capacity_blocked",
  "publication_pending",
  "retry_wait",
  "removal_pending",
  "drain_pending",
  "failed",
] as const satisfies readonly IngestionObligationState[];

type RawIndexBuilder = {
  readonly eq: (field: string, value: unknown) => RawIndexBuilder;
  readonly lte: (field: string, value: unknown) => RawIndexBuilder;
};
type RawQuery = {
  readonly index: (
    name: string,
    range: (builder: RawIndexBuilder) => RawIndexBuilder,
  ) => RawQuery;
  readonly order: (order: "asc" | "desc") => RawQuery;
  readonly take: (count: number) => Effect.Effect<readonly unknown[], unknown>;
};
type RawReader = { readonly table: (name: string) => RawQuery };
type RawWriterTable = {
  readonly insert: (
    row: Record<string, unknown>,
  ) => Effect.Effect<unknown, unknown>;
  readonly patch: (
    id: GenericId<string>,
    patch: Record<string, unknown>,
  ) => Effect.Effect<unknown, unknown>;
};
type RawWriter = { readonly table: (name: string) => RawWriterTable };
type StoredDocument = Record<string, unknown> & {
  readonly _id: GenericId<string>;
  readonly _creationTime: number;
};
type StoredRun = ReconciliationRunState & StoredDocument;
type StoredCursor = ConnectorCursorState & StoredDocument;
type StoredEnvelope = ProviderPageEnvelope & StoredDocument;
type StoredChunk = ProviderPageChunkReceipt & StoredDocument;
type StoredIntent = ReconciliationScopeAuthority &
  StoredDocument & {
    readonly requiredScopeIntentKey: string;
    readonly intentGeneration: number;
    readonly controllingConfigurationDigest: string;
    readonly state: "required" | "decommissioned";
  };
type StoredObligation = ReconciliationScopeAuthority &
  StoredDocument & {
    readonly ingestionObligationKey: string;
    readonly requiredScopeIntentKey: string;
    readonly reconciliationRunKey: string;
    readonly runGeneration: number;
    readonly cause: "observation" | "removal";
    readonly membershipKey: string;
    readonly originKind: "slack" | "transcript";
    readonly originKey: string;
    readonly originRevisionKey: string;
    readonly ledgerSequence: number;
    readonly state: IngestionObligationState;
  };

const rawReader = (reader: unknown): RawReader => reader as RawReader;
const rawWriter = (writer: unknown): RawWriter => writer as RawWriter;
const stableKey = (prefix: string, value: unknown): string =>
  `${prefix}_${sha256Hex(JSON.stringify(value))}`;

const mapInvariant = <A>(
  effect: Effect.Effect<A, ProviderReconciliationInvariant>,
) =>
  effect.pipe(
    Effect.mapError(
      (error) =>
        new ProviderReconciliationConflict({
          reason: error.reason,
          detail: error.detail,
        }),
    ),
  );

const conflict = (
  reason: ProviderReconciliationInvariantReason,
  detail: string,
) => Effect.fail(new ProviderReconciliationConflict({ reason, detail }));

const notFound = (resource: string, key: string) =>
  Effect.fail(new ProviderReconciliationNotFound({ resource, key }));

const queryRows = <Row extends StoredDocument>(
  tableName: string,
  indexName: string,
  range: (builder: RawIndexBuilder) => RawIndexBuilder,
  limit: number,
  order: "asc" | "desc" = "asc",
) =>
  Effect.gen(function* () {
    const reader = rawReader(yield* DatabaseReader);
    return (yield* reader
      .table(tableName)
      .index(indexName, range)
      .order(order)
      .take(limit)
      .pipe(Effect.orDie)) as readonly Row[];
  });

const uniqueRow = <Row extends StoredDocument>(
  tableName: string,
  indexName: string,
  range: (builder: RawIndexBuilder) => RawIndexBuilder,
) =>
  Effect.gen(function* () {
    const rows = yield* queryRows<Row>(tableName, indexName, range, 2);
    if (rows.length > 1)
      return yield* conflict(
        "page_conflict",
        `Duplicate ${tableName} rows violate the reconciliation identity.`,
      );
    return rows[0] ?? null;
  });

const insertRow = (tableName: string, row: Record<string, unknown>) =>
  Effect.gen(function* () {
    const writer = rawWriter(yield* DatabaseWriter);
    return yield* writer.table(tableName).insert(row).pipe(Effect.orDie);
  });

const patchRow = (
  tableName: string,
  id: GenericId<string>,
  patch: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const writer = rawWriter(yield* DatabaseWriter);
    yield* writer.table(tableName).patch(id, patch).pipe(Effect.orDie);
  });

const runByKey = (reconciliationRunKey: string) =>
  uniqueRow<StoredRun>(
    "connectorReconciliationRuns",
    "by_reconciliation_run_key",
    (query) => query.eq("reconciliationRunKey", reconciliationRunKey),
  );

const requireRun = (reconciliationRunKey: string) =>
  Effect.gen(function* () {
    const run = yield* runByKey(reconciliationRunKey);
    return (
      run ??
      (yield* notFound("connectorReconciliationRun", reconciliationRunKey))
    );
  });

const latestRunForScope = (connectorScopeKey: string) =>
  Effect.gen(function* () {
    const rows = yield* queryRows<StoredRun>(
      "connectorReconciliationRuns",
      "by_scope_run_generation",
      (query) => query.eq("connectorScopeKey", connectorScopeKey),
      1,
      "desc",
    );
    return rows[0] ?? null;
  });

const requireAuthoritativeRun = (reconciliationRunKey: string) =>
  Effect.gen(function* () {
    const run = yield* requireRun(reconciliationRunKey);
    const latest = yield* latestRunForScope(run.connectorScopeKey);
    if (latest?.runGeneration !== run.runGeneration)
      return yield* conflict(
        "run_superseded",
        "A successor reconciliation run owns this connector scope.",
      );
    if (!sameScopeTuple(latest, run))
      return yield* conflict(
        "scope_tuple_changed",
        "The current reconciliation run has a different scope tuple.",
      );
    return run;
  });

const cursorByKey = (cursorKey: string) =>
  uniqueRow<StoredCursor>(
    "connectorIncrementalCursors",
    "by_cursor_key",
    (query) => query.eq("cursorKey", cursorKey),
  );

const envelopeByKey = (pageEnvelopeKey: string) =>
  uniqueRow<StoredEnvelope>(
    "connectorPageEnvelopes",
    "by_page_envelope_key",
    (query) => query.eq("pageEnvelopeKey", pageEnvelopeKey),
  );

const requireEnvelope = (pageEnvelopeKey: string) =>
  Effect.gen(function* () {
    const envelope = yield* envelopeByKey(pageEnvelopeKey);
    return (
      envelope ?? (yield* notFound("connectorPageEnvelope", pageEnvelopeKey))
    );
  });

const requiredIntentByKey = (requiredScopeIntentKey: string) =>
  uniqueRow<StoredIntent>(
    "brainRequiredScopeIntents",
    "by_required_scope_intent_key",
    (query) => query.eq("requiredScopeIntentKey", requiredScopeIntentKey),
  );

const obligationByKey = (ingestionObligationKey: string) =>
  uniqueRow<StoredObligation>(
    "ingestionObligations",
    "by_ingestion_obligation_key",
    (query) => query.eq("ingestionObligationKey", ingestionObligationKey),
  );

const authorityFor = (
  value: ReconciliationScopeAuthority,
): ReconciliationScopeAuthority => ({
  organizationKey: value.organizationKey,
  workspaceId: String(value.workspaceId),
  brainKey: value.brainKey,
  corpusKey: value.corpusKey,
  providerKind: value.providerKind,
  connectorScopeKey: value.connectorScopeKey,
  connectionKey: value.connectionKey,
  connectionGeneration: value.connectionGeneration,
  allowlistGeneration: value.allowlistGeneration,
});

const sameScopeTuple = (
  left: ReconciliationScopeAuthority,
  right: ReconciliationScopeAuthority,
): boolean =>
  reconciliationScopeTupleDigest(left) ===
    reconciliationScopeTupleDigest(right) &&
  left.organizationKey === right.organizationKey &&
  String(left.workspaceId) === String(right.workspaceId) &&
  left.brainKey === right.brainKey &&
  left.corpusKey === right.corpusKey &&
  left.providerKind === right.providerKind;

const requireCurrentIntent = (
  requiredScopeIntentKey: string,
  authority: ReconciliationScopeAuthority,
) =>
  Effect.gen(function* () {
    const intent = yield* requiredIntentByKey(requiredScopeIntentKey);
    if (
      intent === null ||
      intent.state !== "required" ||
      !sameScopeTuple(intent, authority)
    )
      return yield* conflict(
        "required_intent_stale",
        "The required scope intent is missing, decommissioned, or stale.",
      );
    return intent;
  });

const assertRunRef = (input: {
  readonly run: StoredRun;
  readonly expectedRunGeneration: number;
  readonly expectedConnectionGeneration: number;
  readonly expectedAllowlistGeneration: number;
}) =>
  input.run.runGeneration !== input.expectedRunGeneration
    ? conflict("run_superseded", "The expected run generation is stale.")
    : input.run.connectionGeneration !== input.expectedConnectionGeneration ||
        input.run.allowlistGeneration !== input.expectedAllowlistGeneration
      ? conflict(
          "scope_tuple_changed",
          "The expected connection or allowlist generation is stale.",
        )
      : Effect.void;

export const upsertRequiredScopeIntentEffect = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly corpusKey: "slack" | "transcripts";
  readonly providerKind: "slack" | "transcript";
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
  readonly expectedIntentGeneration: number;
  readonly controllingConfigurationDigest: string;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const requiredScopeIntentKey = stableKey("brsi", {
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      corpusKey: input.corpusKey,
      providerKind: input.providerKind,
      connectorScopeKey: input.connectorScopeKey,
    });
    const existing = yield* requiredIntentByKey(requiredScopeIntentKey);
    const currentGeneration = existing?.intentGeneration ?? 0;
    if (currentGeneration !== input.expectedIntentGeneration)
      return yield* conflict(
        "required_intent_stale",
        "The required scope intent generation changed.",
      );
    const intentGeneration = currentGeneration + 1;
    const row = {
      schemaVersion: 1,
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      corpusKey: input.corpusKey,
      connectorScopeKey: input.connectorScopeKey,
      connectionKey: input.connectionKey,
      connectionGeneration: input.connectionGeneration,
      allowlistGeneration: input.allowlistGeneration,
      requiredScopeIntentKey,
      intentGeneration,
      controllingConfigurationDigest: input.controllingConfigurationDigest,
      state: "required",
      decommissionGeneration: null,
      activatedAt: input.now,
      decommissionedAt: null,
      updatedAt: input.now,
    } as const;
    if (existing === null) yield* insertRow("brainRequiredScopeIntents", row);
    else yield* patchRow("brainRequiredScopeIntents", existing._id, row);
    return {
      requiredScopeIntentKey,
      intentGeneration,
      state: "required" as const,
    };
  });

const upsertRequiredScopeIntent = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "upsertRequiredScopeIntent",
  upsertRequiredScopeIntentEffect,
);

export const openReconciliationRunEffect = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly corpusKey: "slack" | "transcripts";
  readonly providerKind: "slack" | "transcript";
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
  readonly expectedPreviousRunGeneration: number;
  readonly initialCursor: string | null;
  readonly providerHighWater: string | null;
  readonly ledgerHighWater: number;
  readonly leaseId: string;
  readonly leaseGeneration: number;
  readonly leaseExpiresAt: number;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const authority = authorityFor(input);
    const planned = yield* mapInvariant(
      openReconciliationRunPlan({
        authority,
        previousRunGeneration: input.expectedPreviousRunGeneration,
        expectedPreviousRunGeneration: input.expectedPreviousRunGeneration,
        providerHighWater: input.providerHighWater,
        ledgerHighWater: input.ledgerHighWater,
        leaseId: input.leaseId,
        leaseGeneration: input.leaseGeneration,
        leaseExpiresAt: input.leaseExpiresAt,
        now: input.now,
      }),
    );
    const existing = yield* runByKey(planned.reconciliationRunKey);
    const cursorKey = stableKey("ccur", {
      connectorScopeKey: authority.connectorScopeKey,
      connectionGeneration: authority.connectionGeneration,
      allowlistGeneration: authority.allowlistGeneration,
    });
    if (existing !== null)
      return {
        reconciliationRunKey: existing.reconciliationRunKey,
        runGeneration: existing.runGeneration,
        cursorKey,
        status: existing.status,
      };
    const latest = yield* latestRunForScope(input.connectorScopeKey);
    const previousRunGeneration = latest?.runGeneration ?? 0;
    const run = yield* mapInvariant(
      openReconciliationRunPlan({
        authority,
        previousRunGeneration,
        expectedPreviousRunGeneration: input.expectedPreviousRunGeneration,
        providerHighWater: input.providerHighWater,
        ledgerHighWater: input.ledgerHighWater,
        leaseId: input.leaseId,
        leaseGeneration: input.leaseGeneration,
        leaseExpiresAt: input.leaseExpiresAt,
        now: input.now,
      }),
    );
    if (
      latest !== null &&
      latest.status !== "complete" &&
      latest.status !== "superseded"
    )
      yield* patchRow("connectorReconciliationRuns", latest._id, {
        status: "superseded",
        updatedAt: input.now,
      });
    yield* insertRow("connectorReconciliationRuns", {
      schemaVersion: 1,
      ...run,
    });
    const existingCursor = yield* cursorByKey(cursorKey);
    if (existingCursor === null)
      yield* insertRow("connectorIncrementalCursors", {
        schemaVersion: 1,
        ...authority,
        workspaceId: input.workspaceId,
        cursorKey,
        providerCursor: input.initialCursor,
        cursorGeneration: 1,
        activeEnvelopeKey: null,
        lastProviderHighWater: null,
        ledgerHighWater: 0,
        createdAt: input.now,
        updatedAt: input.now,
      });
    else if (
      !sameScopeTuple(existingCursor, authority) ||
      existingCursor.providerCursor !== input.initialCursor
    )
      return yield* conflict(
        "cursor_conflict",
        "The existing tuple cursor does not match the requested initial cursor.",
      );
    return {
      reconciliationRunKey: run.reconciliationRunKey,
      runGeneration: run.runGeneration,
      cursorKey,
      status: run.status,
    };
  });

const openReconciliationRun = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "openReconciliationRun",
  openReconciliationRunEffect,
);

const beginReconciliationPage = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "beginReconciliationPage",
  (input) =>
    Effect.gen(function* () {
      const run = yield* requireRun(input.reconciliationRunKey);
      yield* assertRunRef({ run, ...input });
      const latest = yield* latestRunForScope(run.connectorScopeKey);
      const cursor = yield* cursorByKey(input.cursorKey);
      if (cursor === null)
        return yield* notFound("connectorIncrementalCursor", input.cursorKey);
      if (cursor.activeEnvelopeKey !== null) {
        const active = yield* envelopeByKey(cursor.activeEnvelopeKey);
        if (
          active !== null &&
          active.reconciliationRunKey === run.reconciliationRunKey &&
          active.expectedCursor === input.expectedCursor &&
          active.expectedCursorGeneration === input.expectedCursorGeneration &&
          active.nextCursor === input.nextCursor &&
          active.providerHighWater === input.providerHighWater &&
          active.ledgerHighWater === input.ledgerHighWater &&
          JSON.stringify(active.chunks) === JSON.stringify(input.chunks)
        )
          return {
            pageEnvelopeKey: active.pageEnvelopeKey,
            pageDigest: active.pageDigest,
            totalChunkCount: active.chunks.length,
          };
        return yield* conflict(
          "cursor_conflict",
          "Another immutable page envelope owns the cursor.",
        );
      }
      const plan = yield* mapInvariant(
        beginProviderPagePlan({
          run,
          currentAuthority: authorityFor(run),
          latestRunGeneration: latest?.runGeneration ?? 0,
          cursor,
          expectedCursor: input.expectedCursor,
          expectedCursorGeneration: input.expectedCursorGeneration,
          nextCursor: input.nextCursor,
          providerHighWater: input.providerHighWater,
          ledgerHighWater: input.ledgerHighWater,
          chunks: input.chunks,
          now: input.now,
        }),
      );
      const existing = yield* envelopeByKey(plan.envelope.pageEnvelopeKey);
      if (existing === null)
        yield* insertRow("connectorPageEnvelopes", {
          schemaVersion: 1,
          ...plan.envelope,
          workspaceId: run.workspaceId,
        });
      else if (existing.pageDigest !== plan.envelope.pageDigest)
        return yield* conflict(
          "page_conflict",
          "The deterministic page key resolves to a different page digest.",
        );
      yield* patchRow("connectorIncrementalCursors", cursor._id, {
        activeEnvelopeKey: plan.envelope.pageEnvelopeKey,
        updatedAt: input.now,
      });
      return {
        pageEnvelopeKey: plan.envelope.pageEnvelopeKey,
        pageDigest: plan.envelope.pageDigest,
        totalChunkCount: plan.envelope.chunks.length,
      };
    }),
);

const verifyOrigin = (observation: ProviderObservation) =>
  Effect.gen(function* () {
    if (observation.originKind === "slack") {
      const revision = yield* uniqueRow<StoredDocument>(
        "sourceRevisions",
        "by_source_revision_key",
        (query) =>
          query
            .eq("organizationKey", observation.organizationKey)
            .eq("sourceRevisionKey", observation.originRevisionKey),
      );
      if (
        revision === null ||
        revision.sourceKey !== observation.originKey ||
        revision.connectionKey !== observation.connectionKey ||
        revision.connectionGeneration !== observation.connectionGeneration ||
        revision.contentHash !== observation.observationDigest ||
        revision._creationTime !== observation.ledgerSequence
      )
        return yield* conflict(
          "page_conflict",
          "The Slack observation does not resolve to its immutable ledger row.",
        );
      return;
    }
    const revision = yield* uniqueRow<StoredDocument>(
      "sourceUnitRevisions",
      "by_unit_revision_key",
      (query) =>
        query
          .eq("organizationKey", observation.organizationKey)
          .eq("unitRevisionKey", observation.originRevisionKey),
    );
    const unit = yield* uniqueRow<StoredDocument>(
      "sourceUnits",
      "by_unit_key",
      (query) =>
        query
          .eq("organizationKey", observation.organizationKey)
          .eq("unitKey", observation.originKey),
    );
    if (
      revision === null ||
      unit === null ||
      revision.unitKey !== observation.originKey ||
      revision.contentHash !== observation.observationDigest ||
      revision._creationTime !== observation.ledgerSequence ||
      unit.connectionKey !== observation.connectionKey ||
      unit.connectionGeneration !== observation.connectionGeneration
    )
      return yield* conflict(
        "page_conflict",
        "The transcript observation does not resolve to its immutable ledger row.",
      );
  });

const commitReconciliationPageChunk = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "commitReconciliationPageChunk",
  (input) =>
    Effect.gen(function* () {
      const envelope = yield* requireEnvelope(input.pageEnvelopeKey);
      const run = yield* requireAuthoritativeRun(envelope.reconciliationRunKey);
      if (
        run.status !== "scan" ||
        run.runGeneration !== envelope.runGeneration ||
        !sameScopeTuple(run, envelope)
      )
        return yield* conflict(
          "phase_conflict",
          "Only the authoritative scanning run may commit page chunks.",
        );
      const existingRows = yield* queryRows<StoredChunk>(
        "connectorPageChunks",
        "by_page_envelope_chunk",
        (query) =>
          query
            .eq("pageEnvelopeKey", input.pageEnvelopeKey)
            .eq("chunkIndex", input.chunkIndex),
        2,
      );
      if (existingRows.length > 1)
        return yield* conflict(
          "chunk_conflict",
          "Duplicate chunk receipts violate the page identity.",
        );
      const existing = existingRows[0] ?? null;
      const planned = yield* mapInvariant(
        commitProviderPageChunkPlan({
          envelope,
          chunkIndex: input.chunkIndex,
          chunkDigest: input.chunkDigest,
          observations: input.observations,
          existingReceipt: existing,
          now: input.now,
        }),
      );
      if (existing !== null)
        return {
          pageChunkKey: existing.pageChunkKey,
          observationCount: existing.observationCount,
          seenCount: existing.seenCount,
          obligationCount: existing.obligationCount,
          duplicate: true,
        };
      yield* requireCurrentIntent(
        input.requiredScopeIntentKey,
        authorityFor(envelope),
      );
      for (const observation of input.observations)
        yield* verifyOrigin(observation);
      for (const marker of planned.seenMarkers) {
        const stored = yield* queryRows<StoredDocument>(
          "connectorReconciliationSeen",
          "by_run_membership",
          (query) =>
            query
              .eq("reconciliationRunKey", marker.reconciliationRunKey)
              .eq("membershipKey", marker.membershipKey),
          1,
        );
        if (stored.length > 0)
          return yield* conflict(
            "chunk_conflict",
            "The same run membership appeared in multiple page chunks.",
          );
        yield* insertRow("connectorReconciliationSeen", {
          schemaVersion: 1,
          ...marker,
          workspaceId: envelope.workspaceId,
        });
      }
      for (const obligation of planned.obligations) {
        if (
          (yield* obligationByKey(obligation.ingestionObligationKey)) !== null
        )
          return yield* conflict(
            "chunk_conflict",
            "The observation obligation already belongs to another page chunk.",
          );
        yield* insertRow("ingestionObligations", {
          schemaVersion: 1,
          ...obligation,
          workspaceId: envelope.workspaceId,
          requiredScopeIntentKey: input.requiredScopeIntentKey,
          targetResolutionIntentKey: null,
          publicationJobKeys: [],
          errorTag: null,
          terminalAt: null,
        });
      }
      yield* insertRow("connectorPageChunks", {
        schemaVersion: 1,
        organizationKey: envelope.organizationKey,
        connectorScopeKey: envelope.connectorScopeKey,
        ...planned.receipt,
      });
      yield* patchRow("connectorReconciliationRuns", run._id, {
        observedCount: run.observedCount + planned.receipt.observationCount,
        obligationCount: run.obligationCount + planned.receipt.obligationCount,
        updatedAt: input.now,
      });
      return {
        pageChunkKey: planned.receipt.pageChunkKey,
        observationCount: planned.receipt.observationCount,
        seenCount: planned.receipt.seenCount,
        obligationCount: planned.receipt.obligationCount,
        duplicate: false,
      };
    }),
);

const finalizeReconciliationPage = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "finalizeReconciliationPage",
  (input) =>
    Effect.gen(function* () {
      const envelope = yield* requireEnvelope(input.pageEnvelopeKey);
      const run = yield* requireAuthoritativeRun(envelope.reconciliationRunKey);
      if (
        run.status !== "scan" ||
        run.runGeneration !== envelope.runGeneration ||
        !sameScopeTuple(run, envelope)
      )
        return yield* conflict(
          "phase_conflict",
          "Only the authoritative scanning run may finalize a page.",
        );
      if (envelope.cursorKey !== input.cursorKey)
        return yield* conflict(
          "cursor_conflict",
          "The requested cursor does not own this page envelope.",
        );
      const cursor = yield* cursorByKey(input.cursorKey);
      if (cursor === null)
        return yield* notFound("connectorIncrementalCursor", input.cursorKey);
      const receipts = yield* queryRows<StoredChunk>(
        "connectorPageChunks",
        "by_page_envelope_chunk",
        (query) => query.eq("pageEnvelopeKey", envelope.pageEnvelopeKey),
        MAX_CHUNKS + 1,
      );
      const advanced = yield* mapInvariant(
        finalizeProviderPagePlan({
          cursor,
          envelope,
          receipts,
          now: input.now,
        }),
      );
      yield* patchRow("connectorIncrementalCursors", cursor._id, {
        providerCursor: advanced.providerCursor,
        cursorGeneration: advanced.cursorGeneration,
        activeEnvelopeKey: null,
        lastProviderHighWater: advanced.lastProviderHighWater,
        ledgerHighWater: advanced.ledgerHighWater,
        updatedAt: input.now,
      });
      yield* patchRow("connectorReconciliationRuns", run._id, {
        scanCursor: advanced.providerCursor,
        updatedAt: input.now,
      });
      return {
        providerCursor: advanced.providerCursor,
        cursorGeneration: advanced.cursorGeneration,
        ledgerHighWater: advanced.ledgerHighWater,
      };
    }),
);

const closeReconciliationTraversal = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "closeReconciliationTraversal",
  (input) =>
    Effect.gen(function* () {
      const run = yield* requireRun(input.reconciliationRunKey);
      yield* assertRunRef({ run, ...input });
      const latest = yield* latestRunForScope(run.connectorScopeKey);
      const cursors = yield* queryRows<StoredCursor>(
        "connectorIncrementalCursors",
        "by_scope_tuple",
        (query) =>
          query
            .eq("connectorScopeKey", run.connectorScopeKey)
            .eq("connectionGeneration", run.connectionGeneration)
            .eq("allowlistGeneration", run.allowlistGeneration),
        2,
      );
      if (cursors.length !== 1)
        return yield* conflict(
          "cursor_conflict",
          "The reconciliation tuple must own exactly one cursor.",
        );
      const cursor = cursors[0];
      if (cursor === undefined)
        return yield* conflict(
          "cursor_conflict",
          "The tuple cursor is missing.",
        );
      const closed = yield* mapInvariant(
        closeReconciliationTraversalPlan({
          run,
          currentAuthority: authorityFor(run),
          latestRunGeneration: latest?.runGeneration ?? 0,
          providerCursor: cursor.providerCursor,
          activeEnvelopeKey: cursor.activeEnvelopeKey,
          now: input.now,
        }),
      );
      yield* patchRow("connectorReconciliationRuns", run._id, {
        status: closed.status,
        scanCursor: null,
        updatedAt: input.now,
      });
      return {
        reconciliationRunKey: run.reconciliationRunKey,
        status: "traversal_closed" as const,
      };
    }),
);

const removalObligationKey = (
  run: ReconciliationRunState,
  candidate: RemovalCandidate,
): string =>
  stableKey("iobl", {
    connectorScopeKey: run.connectorScopeKey,
    connectionGeneration: run.connectionGeneration,
    allowlistGeneration: run.allowlistGeneration,
    cause: "removal",
    originRevisionKey: candidate.originRevisionKey,
    runGeneration: run.runGeneration,
  });

const applyReconciliationRemovalBatch = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "applyReconciliationRemovalBatch",
  (input) =>
    Effect.gen(function* () {
      const run = yield* requireRun(input.reconciliationRunKey);
      yield* assertRunRef({ run, ...input });
      if (run.removalCursor !== input.expectedRemovalCursor)
        return yield* conflict(
          "removal_incomplete",
          "The removal cursor changed before this batch applied.",
        );
      const latest = yield* latestRunForScope(run.connectorScopeKey);
      yield* requireCurrentIntent(
        input.requiredScopeIntentKey,
        authorityFor(run),
      );
      const seenMembershipKeys = new Set<string>();
      for (const candidate of input.candidates) {
        const seen = yield* queryRows<StoredDocument>(
          "connectorReconciliationSeen",
          "by_run_membership",
          (query) =>
            query
              .eq("reconciliationRunKey", run.reconciliationRunKey)
              .eq("membershipKey", candidate.membershipKey),
          2,
        );
        if (seen.length > 1)
          return yield* conflict(
            "page_conflict",
            "Duplicate seen markers block removal inference.",
          );
        if (seen.length === 1) seenMembershipKeys.add(candidate.membershipKey);
      }
      const removals = yield* mapInvariant(
        planReconciliationRemovals({
          run,
          currentAuthority: authorityFor(run),
          latestRunGeneration: latest?.runGeneration ?? 0,
          seenMembershipKeys,
          candidates: input.candidates,
        }),
      );
      let inserted = 0;
      for (const candidate of removals) {
        yield* verifyOrigin({
          organizationKey: run.organizationKey,
          connectionKey: run.connectionKey,
          connectionGeneration: run.connectionGeneration,
          membershipKey: candidate.membershipKey,
          providerObjectKey: candidate.membershipKey,
          originKind: candidate.originKind,
          originKey: candidate.originKey,
          originRevisionKey: candidate.originRevisionKey,
          ledgerSequence: candidate.ledgerSequence,
          observationDigest:
            candidate.originKind === "slack"
              ? String(
                  (yield* uniqueRow<StoredDocument>(
                    "sourceRevisions",
                    "by_source_revision_key",
                    (query) =>
                      query
                        .eq("organizationKey", run.organizationKey)
                        .eq("sourceRevisionKey", candidate.originRevisionKey),
                  ))?.contentHash ?? "",
                )
              : String(
                  (yield* uniqueRow<StoredDocument>(
                    "sourceUnitRevisions",
                    "by_unit_revision_key",
                    (query) =>
                      query
                        .eq("organizationKey", run.organizationKey)
                        .eq("unitRevisionKey", candidate.originRevisionKey),
                  ))?.contentHash ?? "",
                ),
        });
        const ingestionObligationKey = removalObligationKey(run, candidate);
        if ((yield* obligationByKey(ingestionObligationKey)) !== null) continue;
        yield* insertRow("ingestionObligations", {
          schemaVersion: 1,
          ...authorityFor(run),
          workspaceId: run.workspaceId,
          ingestionObligationKey,
          requiredScopeIntentKey: input.requiredScopeIntentKey,
          reconciliationRunKey: run.reconciliationRunKey,
          runGeneration: run.runGeneration,
          cause: "removal",
          membershipKey: candidate.membershipKey,
          originKind: candidate.originKind,
          originKey: candidate.originKey,
          originRevisionKey: candidate.originRevisionKey,
          ledgerSequence: candidate.ledgerSequence,
          state: "removal_pending",
          targetResolutionIntentKey: null,
          publicationJobKeys: [],
          errorTag: null,
          terminalAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        });
        inserted += 1;
      }
      const status = input.finalBatch
        ? ("drain_derived" as const)
        : ("apply_removals" as const);
      const removalCursor = input.finalBatch ? null : input.nextRemovalCursor;
      yield* patchRow("connectorReconciliationRuns", run._id, {
        status,
        removalCursor,
        removalCandidateCount:
          run.removalCandidateCount + input.candidates.length,
        removalRequiredCount: run.removalRequiredCount + inserted,
        removalBacklogCount: run.removalBacklogCount + inserted,
        updatedAt: input.now,
      });
      return {
        reconciliationRunKey: run.reconciliationRunKey,
        status,
        candidateCount: input.candidates.length,
        removalCount: inserted,
        removalCursor,
      };
    }),
);

const transitionIngestionObligation = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "transitionIngestionObligation",
  (input) =>
    Effect.gen(function* () {
      const obligation = yield* obligationByKey(input.ingestionObligationKey);
      if (obligation === null)
        return yield* notFound(
          "ingestionObligation",
          input.ingestionObligationKey,
        );
      const nextState = yield* mapInvariant(
        transitionIngestionObligationPlan({
          current: obligation.state,
          expected: input.expectedState,
          next: input.nextState,
        }),
      );
      const terminal = isSuccessfulObligationState(nextState);
      yield* patchRow("ingestionObligations", obligation._id, {
        state: nextState,
        targetResolutionIntentKey: input.targetResolutionIntentKey,
        publicationJobKeys: input.publicationJobKeys,
        errorTag: input.errorTag,
        terminalAt: terminal ? input.now : null,
        updatedAt: input.now,
      });
      if (obligation.cause === "removal") {
        const run = yield* requireRun(obligation.reconciliationRunKey);
        if (
          obligation.state === "removal_pending" &&
          nextState === "drain_pending"
        )
          yield* patchRow("connectorReconciliationRuns", run._id, {
            removalBacklogCount: Math.max(0, run.removalBacklogCount - 1),
            drainBacklogCount: run.drainBacklogCount + 1,
            updatedAt: input.now,
          });
        else if (
          obligation.state === "drain_pending" &&
          nextState === "complete"
        )
          yield* patchRow("connectorReconciliationRuns", run._id, {
            drainBacklogCount: Math.max(0, run.drainBacklogCount - 1),
            drainedCount: run.drainedCount + 1,
            updatedAt: input.now,
          });
      }
      return {
        ingestionObligationKey: obligation.ingestionObligationKey,
        state: nextState,
        terminal,
      };
    }),
);

const completeReconciliationRun = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "completeReconciliationRun",
  (input) =>
    Effect.gen(function* () {
      const run = yield* requireRun(input.reconciliationRunKey);
      yield* assertRunRef({ run, ...input });
      const latest = yield* latestRunForScope(run.connectorScopeKey);
      const blockingRows = yield* Effect.all(
        NONTERMINAL_OBLIGATION_STATES.map((state) =>
          queryRows<StoredObligation>(
            "ingestionObligations",
            "by_run_state_ledger_sequence",
            (query) =>
              query
                .eq("reconciliationRunKey", run.reconciliationRunKey)
                .eq("state", state)
                .lte("ledgerSequence", run.ledgerHighWater),
            1,
          ),
        ),
      );
      const blockingStates = blockingRows.flatMap((rows) =>
        rows.map(({ state }) => state),
      );
      const intents = yield* queryRows<StoredIntent>(
        "brainRequiredScopeIntents",
        "by_scope_intent_generation",
        (query) => query.eq("connectorScopeKey", run.connectorScopeKey),
        1,
        "desc",
      );
      const intent = intents[0] ?? null;
      const completed = yield* mapInvariant(
        completeReconciliationRunPlan({
          run,
          currentAuthority: authorityFor(run),
          latestRunGeneration: latest?.runGeneration ?? 0,
          obligationStates: blockingStates,
          successfulObligationCount:
            run.obligationCount + run.removalRequiredCount,
          requiredIntentCurrent:
            intent !== null &&
            intent.state === "required" &&
            sameScopeTuple(intent, run),
          now: input.now,
        }),
      );
      yield* patchRow("connectorReconciliationRuns", run._id, {
        status: completed.status,
        blockingObligationCount: completed.blockingObligationCount,
        completionReceipt: completed.completionReceipt,
        completedAt: completed.completedAt,
        updatedAt: input.now,
      });
      const receipt = completed.completionReceipt;
      if (receipt === null)
        return yield* conflict(
          "drain_incomplete",
          "A complete run must carry a completion receipt.",
        );
      return {
        reconciliationRunKey: run.reconciliationRunKey,
        status: "complete" as const,
        receiptDigest: receipt.receiptDigest,
        successfulObligationCount: receipt.successfulObligationCount,
      };
    }),
);

export default GroupImpl.make(databaseSchema, providerReconciliation).pipe(
  Layer.provide(upsertRequiredScopeIntent),
  Layer.provide(openReconciliationRun),
  Layer.provide(beginReconciliationPage),
  Layer.provide(commitReconciliationPageChunk),
  Layer.provide(finalizeReconciliationPage),
  Layer.provide(closeReconciliationTraversal),
  Layer.provide(applyReconciliationRemovalBatch),
  Layer.provide(transitionIngestionObligation),
  Layer.provide(completeReconciliationRun),
  GroupImpl.finalize,
);
