import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationCtx,
  Scheduler,
} from "../_generated/services";
import { ingestSourceUnitEffect } from "../capabilities/ingestSourceUnit.impl";
import {
  slackSourceLifecycleFenceIdentity,
  transcriptUnitLifecycleFenceIdentity,
  transitionEligibilityFenceEffect,
} from "../brain/retrievalEligibility";
import {
  commitPreparedPublicationEffect,
  enqueueAttributedPublicationRepairEffect,
  enqueueRetrievalPublicationJobEffect,
} from "../brain/retrievalPublication.impl";
import { sha256Hex } from "../shared/sha256";
import { sourceLedgerKeysFor } from "../sources/sourceSchemas";
import {
  driveCommittedReceipt,
  driveOutcomeReceipt,
  type DriveIngestionReceipt,
} from "./driveIngestionCoordinator";
import type { DrivePreparedWrite } from "./driveLedgerSchemas";
import {
  DriveLedgerDatabaseReader,
  DriveLedgerDatabaseWriter,
} from "./driveLedgerDatabase";
import {
  commitDriveObservationAtSequence,
  recordDriveSourceOutcomeAtSequence,
} from "./driveLedgerRepository";
import {
  listDriveReconciliationRemovalCandidates,
  loadPersistedDriveReconciliationPage,
  resolveDriveReconciliationObservation,
  resolveDriveReconciliationOutcome,
} from "./driveReconciliationRepository";
import {
  beginProviderPagePlan,
  blockingIngestionObligationStates,
  closeReconciliationTraversalPlan,
  commitProviderPageChunkPlan,
  completeReconciliationRunPlan,
  finalizeProviderPagePlan,
  isSuccessfulObligationState,
  openReconciliationRunPlan,
  planReconciliationRemovals,
  preparedDriveChunkDigest,
  preparedSlackChunkDigest,
  preparedTranscriptChunkDigest,
  ProviderReconciliationInvariant,
  type ProviderReconciliationInvariantReason,
  reconciliationScopeTupleDigest,
  transitionIngestionObligationPlan,
  type ConnectorCursorState,
  type IngestionObligationState,
  type ProviderObservation,
  type ProviderPageChunkReceipt,
  type ProviderPageEnvelope,
  type ReconciliationRunStatus,
  type ReconciliationRunState,
  type ReconciliationScopeAuthority,
  type RemovalCandidate,
} from "./providerReconciliation";
import providerReconciliation, {
  ProviderReconciliationConflict,
  ProviderReconciliationNotFound,
} from "./providerReconciliation.spec";
import {
  buildSlackReconciliationRows,
  slackReconciliationObservation,
  type PreparedSlackReconciliationWrite,
} from "./slackReconciliationAdapter";
import {
  listSlackReconciliationRemovalCandidates,
  listTranscriptReconciliationRemovalCandidates,
  loadPersistedSourceReconciliationPage,
} from "./sourceReconciliationRepository";
import {
  transcriptReconciliationObservation,
  type PreparedTranscriptReconciliationWrite,
} from "./transcriptReconciliationAdapter";
import {
  providerTargetResolutionAuthorityDigest,
  providerTargetResolutionIntentKey,
  providerTargetResolutionPopulationDigest,
  validateProviderTargetResolutionPopulation,
  type ProviderTargetResolutionStatus,
  type ProviderTargetResolutionTarget,
  type ReconciliationPageTargetResolutionAuthority,
} from "../brain/providerTargetResolution";

const MAX_CHUNKS = 64;
const MAX_PREPARED_PAGE_BYTES = 750_000;

type RawIndexBuilder = {
  readonly eq: (field: string, value: unknown) => RawIndexBuilder;
  readonly lte: (field: string, value: unknown) => RawIndexBuilder;
};
type RawQuery = {
  readonly index: (
    name: string,
    range: (builder: RawIndexBuilder) => RawIndexBuilder,
    order?: "asc" | "desc",
  ) => RawQuery;
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
type RawMutationDatabase = {
  readonly query: (name: string) => {
    readonly withIndex: (
      indexName: string,
      range: (builder: {
        readonly eq: (field: string, value: unknown) => unknown;
      }) => unknown,
    ) => {
      readonly take: (count: number) => Promise<readonly unknown[]>;
    };
  };
  readonly patch: (
    id: GenericId<string>,
    patch: Record<string, unknown>,
  ) => Promise<unknown>;
};
type StoredDocument = Record<string, unknown> & {
  readonly _id: GenericId<string>;
  readonly _creationTime: number;
};
type StoredRun = ReconciliationRunState & StoredDocument;
type StoredCursor = ConnectorCursorState & StoredDocument;
type StoredEnvelope = ProviderPageEnvelope & StoredDocument;
type StoredChunk = ProviderPageChunkReceipt &
  StoredDocument & {
    readonly driveReceipts?: readonly DriveIngestionReceipt[] | undefined;
  };
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
    readonly originKind: "slack" | "transcript" | "document";
    readonly originKey: string;
    readonly originRevisionKey: string;
    readonly ledgerSequence: number;
    readonly state: IngestionObligationState;
    readonly targetResolutionIntentId?:
      GenericId<"providerTargetResolutionIntents"> | undefined;
    readonly targetResolutionIntentKey: string | null;
    readonly publicationJobKeys: readonly string[];
    readonly errorTag: string | null;
    readonly terminalAt: number | null;
    readonly updatedAt: number;
  };
type StoredConnectorScope = StoredDocument & {
  readonly organizationKey: string;
  readonly connectorScopeKey: string;
  readonly providerKind: "slack" | "transcript" | "google_drive" | "structured";
  readonly providerContainerKey: string;
  readonly connectionKey: string;
  readonly currentConnectionGeneration: number;
  readonly currentAllowlistGeneration: number;
  readonly scopeGeneration: number;
  readonly state: "active" | "revoked";
  readonly createdAt: number;
};
type StoredAllowlistGeneration = StoredDocument & {
  readonly organizationKey: string;
  readonly connectorScopeKey: string;
  readonly allowlistGenerationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
  readonly configurationDigest: string;
  readonly state: "current" | "superseded" | "revoked";
};
type StoredRepairEffect = StoredDocument & {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly scopeKey: string;
  readonly repairEffectKey: string;
  readonly ingestionObligationKey: string;
  readonly failureVersion: number;
  readonly mode: "retry" | "attributed_repair";
  readonly state: "queued" | "running" | "succeeded" | "failed";
  readonly reason: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};
type StoredPublicationJob = StoredDocument & {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly jobKey: string;
  readonly ingestionObligationKey?: string | undefined;
  readonly providerTargetResolutionIntentId?:
    GenericId<"providerTargetResolutionIntents"> | undefined;
  readonly providerTargetResolutionGeneration?: number | undefined;
  readonly authorityDigest?: string | undefined;
  readonly authorityEnvelope?:
    { readonly repairOfJobKey?: string | undefined } | undefined;
  readonly effectClass?:
    | "direct_publication"
    | "rebuild_batch"
    | "attributed_repair"
    | "migration_replacement"
    | undefined;
  readonly originKind:
    | "page"
    | "page_rebuild"
    | "slack"
    | "transcript"
    | "document"
    | "slack_rebuild"
    | "transcript_rebuild";
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly status:
    | "pending"
    | "retry_wait"
    | "succeeded"
    | "superseded"
    | "revoked"
    | "integrity_failure"
    | "dead_letter";
};
type StoredProviderTargetIntent = StoredDocument &
  ReconciliationPageTargetResolutionAuthority & {
    readonly authorityDigest: string;
    readonly status: ProviderTargetResolutionStatus;
    readonly attemptCount: number;
    readonly nextAttemptAt: number;
    readonly lastErrorTag: string | null;
    readonly targetCount: number;
    readonly targetDigest: string | null;
    readonly targets: readonly ProviderTargetResolutionTarget[];
    readonly completedAt: number | null;
    readonly createdAt: number;
    readonly updatedAt: number;
  };
type StoredSlackRevision = StoredDocument & {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly channelKey: string;
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly normalizedText: string;
  readonly tombstone: boolean;
  readonly ledgerSequence?: number | undefined;
  readonly sourceCreatedAt: number;
  readonly lifecycle: { readonly state: string };
};
type StoredSlackArtifact = StoredDocument & {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly channelKey: string;
  readonly sourceKey: string;
  readonly latestSourceRevisionKey: string;
  readonly lifecycle: { readonly state: string };
};
type StoredSlackPolicy = StoredDocument & {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly channelKey: string;
  readonly policyEpoch: number;
  readonly active: boolean;
  readonly mode: "direct" | "classify" | "capture_only";
  readonly targetBrainKeys: readonly string[];
  readonly historicalBackfillStartAt?: number | undefined;
};
type StoredTranscriptRevision = StoredDocument & {
  readonly organizationKey: string;
  readonly unitKey: string;
  readonly unitRevisionKey: string;
  readonly tombstone: boolean;
  readonly ledgerSequence?: number | undefined;
};
type StoredTranscriptUnit = StoredDocument & {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly unitKey: string;
  readonly currentUnitRevisionKey: string;
  readonly lifecycle: { readonly state: string };
};
type StoredTranscriptRoute = StoredDocument & {
  readonly organizationKey: string;
  readonly unitKey: string;
  readonly unitRevisionKey: string;
  readonly routeGeneration: number;
  readonly outcome: string;
  readonly brainKey: string | null;
  readonly status: string;
};
type StoredDocumentRevision = StoredDocument & {
  readonly organizationKey: string;
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
  readonly documentObjectKey: string;
  readonly documentRevisionKey: string;
  readonly tombstone: boolean;
  readonly ledgerSequence?: number | undefined;
};
type StoredDocumentObject = StoredDocument & {
  readonly organizationKey: string;
  readonly documentObjectKey: string;
  readonly lifecycleState: "live" | "tombstoned";
};
type StoredDocumentMembership = StoredDocument & {
  readonly organizationKey: string;
  readonly membershipEdgeKey: string;
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
  readonly documentObjectKey: string;
  readonly documentRevisionKey: string;
  readonly membershipState: "active" | "tombstoned";
};
type StoredProviderConnection = StoredDocument & {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly status: string;
  readonly providerConfigKey: string;
  readonly nangoConnectionId?: string | null | undefined;
  readonly teamId?: string | null | undefined;
  readonly apiAppId?: string | null | undefined;
  readonly botUserId?: string | null | undefined;
};
type StoredDriveScopeConfiguration = StoredDocument & {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
  readonly configurationGeneration: number;
  readonly driveId: string;
  readonly rootFolderIds: readonly string[];
  readonly sharedDrive: boolean;
  readonly retentionClass: string;
  readonly permissionPolicyDigest: string;
  readonly configurationDigest: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};

const rawReader = (reader: unknown): RawReader => reader as RawReader;
const rawWriter = (writer: unknown): RawWriter => writer as RawWriter;
const rawMutationDatabase = (ctx: Effect.Effect.Success<typeof MutationCtx>) =>
  ctx.db as unknown as RawMutationDatabase;
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
      .index(indexName, range, order)
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

const runWithDriveDatabase = <Result, Error>(
  effect: Effect.Effect<
    Result,
    Error,
    DriveLedgerDatabaseReader | DriveLedgerDatabaseWriter
  >,
) =>
  Effect.gen(function* () {
    const reader =
      (yield* DatabaseReader) as unknown as DriveLedgerDatabaseReader;
    const writer =
      (yield* DatabaseWriter) as unknown as DriveLedgerDatabaseWriter;
    return yield* effect.pipe(
      Effect.provideService(DriveLedgerDatabaseReader, reader),
      Effect.provideService(DriveLedgerDatabaseWriter, writer),
    );
  });

const runWithDriveReader = <Result, Error>(
  effect: Effect.Effect<Result, Error, DriveLedgerDatabaseReader>,
) =>
  Effect.gen(function* () {
    const reader =
      (yield* DatabaseReader) as unknown as DriveLedgerDatabaseReader;
    return yield* effect.pipe(
      Effect.provideService(DriveLedgerDatabaseReader, reader),
    );
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

const connectorScopeByKey = (connectorScopeKey: string) =>
  uniqueRow<StoredConnectorScope>(
    "connectorScopes",
    "by_connector_scope_key",
    (query) => query.eq("connectorScopeKey", connectorScopeKey),
  );

const allowlistGenerationByKey = (
  connectorScopeKey: string,
  allowlistGeneration: number,
) =>
  uniqueRow<StoredAllowlistGeneration>(
    "connectorAllowlistGenerations",
    "by_scope_generation",
    (query) =>
      query
        .eq("connectorScopeKey", connectorScopeKey)
        .eq("allowlistGeneration", allowlistGeneration),
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

const assertLeasedRunRef = (input: {
  readonly run: StoredRun;
  readonly expectedRunGeneration: number;
  readonly expectedConnectionGeneration: number;
  readonly expectedAllowlistGeneration: number;
  readonly expectedLeaseGeneration: number;
  readonly leaseId: string;
}) =>
  Effect.gen(function* () {
    yield* assertRunRef(input);
    if (
      input.run.leaseGeneration !== input.expectedLeaseGeneration ||
      input.run.leaseId !== input.leaseId
    )
      return yield* conflict(
        "lease_lost",
        "The reconciliation worker no longer owns the current lease.",
      );
  });

export const upsertRequiredScopeIntentEffect = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly corpusKey: "slack" | "transcripts" | "documents";
  readonly providerKind: "slack" | "transcript" | "google_drive";
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
  readonly expectedIntentGeneration: number;
  readonly controllingConfigurationDigest: string;
  readonly now: number;
}): Effect.Effect<
  {
    readonly requiredScopeIntentKey: string;
    readonly intentGeneration: number;
    readonly state: "required";
  },
  ProviderReconciliationConflict,
  DatabaseReader | DatabaseWriter
> =>
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
      providerKind: input.providerKind,
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

const activateRequiredScope = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "activateRequiredScope",
  (input) =>
    Effect.gen(function* () {
      const authority = authorityFor(input);
      const existingScope = yield* connectorScopeByKey(input.connectorScopeKey);
      const currentScopeGeneration = existingScope?.scopeGeneration ?? 0;
      if (currentScopeGeneration !== input.expectedScopeGeneration)
        return yield* conflict(
          "scope_tuple_changed",
          "The connector scope generation changed before activation.",
        );
      if (
        (input.activationKind === "activate" && existingScope !== null) ||
        (input.activationKind === "restore" &&
          (existingScope === null || existingScope.state !== "revoked"))
      )
        return yield* conflict(
          "scope_tuple_changed",
          "Connector activation and restore require their exact prior lifecycle state.",
        );
      if (
        existingScope !== null &&
        (existingScope.organizationKey !== input.organizationKey ||
          existingScope.providerKind !== input.providerKind ||
          existingScope.providerContainerKey !== input.providerContainerKey ||
          existingScope.connectionKey !== input.connectionKey)
      )
        return yield* conflict(
          "scope_tuple_changed",
          "The restored connector scope identity differs from its durable controller.",
        );

      const allowlistGenerationKey = stableKey("calg", {
        connectorScopeKey: input.connectorScopeKey,
        connectionGeneration: input.connectionGeneration,
        allowlistGeneration: input.allowlistGeneration,
        controllingConfigurationDigest: input.controllingConfigurationDigest,
      });
      const existingAllowlist = yield* allowlistGenerationByKey(
        input.connectorScopeKey,
        input.allowlistGeneration,
      );
      if (
        existingAllowlist !== null &&
        (existingAllowlist.allowlistGenerationKey !== allowlistGenerationKey ||
          existingAllowlist.connectionKey !== input.connectionKey ||
          existingAllowlist.connectionGeneration !==
            input.connectionGeneration ||
          existingAllowlist.configurationDigest !==
            input.controllingConfigurationDigest)
      )
        return yield* conflict(
          "scope_tuple_changed",
          "The allowlist generation is already bound to another configuration.",
        );
      if (existingAllowlist === null)
        yield* insertRow("connectorAllowlistGenerations", {
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          connectorScopeKey: input.connectorScopeKey,
          allowlistGenerationKey,
          connectionKey: input.connectionKey,
          connectionGeneration: input.connectionGeneration,
          allowlistGeneration: input.allowlistGeneration,
          configurationDigest: input.controllingConfigurationDigest,
          memberCount: 0,
          state: "current",
          createdAt: input.now,
          supersededAt: null,
        });

      const scopeGeneration = currentScopeGeneration + 1;
      const scopeRow = {
        schemaVersion: 1,
        organizationKey: input.organizationKey,
        connectorScopeKey: input.connectorScopeKey,
        providerKind: input.providerKind,
        providerContainerKey: input.providerContainerKey,
        connectionKey: input.connectionKey,
        currentConnectionGeneration: input.connectionGeneration,
        currentAllowlistGeneration: input.allowlistGeneration,
        scopeGeneration,
        state: "active",
        createdAt: existingScope?.createdAt ?? input.now,
        updatedAt: input.now,
      } as const;
      if (existingScope === null) yield* insertRow("connectorScopes", scopeRow);
      else yield* patchRow("connectorScopes", existingScope._id, scopeRow);

      const intent = yield* upsertRequiredScopeIntentEffect({
        ...authority,
        workspaceId: input.workspaceId,
        expectedIntentGeneration: input.expectedIntentGeneration,
        controllingConfigurationDigest: input.controllingConfigurationDigest,
        now: input.now,
      });
      return {
        connectorScopeKey: input.connectorScopeKey,
        scopeGeneration,
        ...intent,
      };
    }),
);

export const openReconciliationRunEffect = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly corpusKey: "slack" | "transcripts" | "documents";
  readonly providerKind: "slack" | "transcript" | "google_drive";
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
}): Effect.Effect<
  {
    readonly reconciliationRunKey: string;
    readonly runGeneration: number;
    readonly cursorKey: string;
    readonly status: ReconciliationRunStatus;
  },
  ProviderReconciliationConflict,
  DatabaseReader | DatabaseWriter
> =>
  Effect.gen(function* () {
    const authority = authorityFor(input);
    const cursorKey = stableKey("ccur", {
      connectorScopeKey: authority.connectorScopeKey,
      connectionGeneration: authority.connectionGeneration,
      allowlistGeneration: authority.allowlistGeneration,
    });
    const existingCursor = yield* cursorByKey(cursorKey);
    const ledgerHighWater =
      input.providerKind === "google_drive"
        ? (existingCursor?.ledgerHighWater ?? 0)
        : Math.max(existingCursor?.ledgerHighWater ?? 0, input.now);
    const planned = yield* mapInvariant(
      openReconciliationRunPlan({
        authority,
        previousRunGeneration: input.expectedPreviousRunGeneration,
        expectedPreviousRunGeneration: input.expectedPreviousRunGeneration,
        providerHighWater: input.providerHighWater,
        ledgerHighWater,
        leaseId: input.leaseId,
        leaseGeneration: input.leaseGeneration,
        leaseExpiresAt: input.leaseExpiresAt,
        now: input.now,
      }),
    );
    const latest = yield* latestRunForScope(input.connectorScopeKey);
    if (latest !== null && latest.runGeneration > planned.runGeneration)
      return yield* conflict(
        "run_superseded",
        "A successor reconciliation run already owns this connector scope.",
      );
    const existing = yield* runByKey(planned.reconciliationRunKey);
    if (
      existing !== null &&
      latest?.reconciliationRunKey === existing.reconciliationRunKey
    )
      return {
        reconciliationRunKey: existing.reconciliationRunKey,
        runGeneration: existing.runGeneration,
        cursorKey,
        status: existing.status,
      };
    if (existing !== null)
      return yield* conflict(
        "run_superseded",
        "The requested reconciliation run has been superseded.",
      );
    const previousRunGeneration = latest?.runGeneration ?? 0;
    const run = yield* mapInvariant(
      openReconciliationRunPlan({
        authority,
        previousRunGeneration,
        expectedPreviousRunGeneration: input.expectedPreviousRunGeneration,
        providerHighWater: input.providerHighWater,
        ledgerHighWater,
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
    if (existingCursor === null)
      yield* insertRow("connectorIncrementalCursors", {
        schemaVersion: 1,
        ...authority,
        workspaceId: input.workspaceId,
        cursorKey,
        providerCursor: input.initialCursor,
        traversalComplete: false,
        cursorGeneration: 1,
        activeEnvelopeKey: null,
        lastProviderHighWater: null,
        ledgerHighWater,
        createdAt: input.now,
        updatedAt: input.now,
      });
    else if (!sameScopeTuple(existingCursor, authority))
      return yield* conflict(
        "cursor_conflict",
        "The existing cursor no longer matches the requested scope tuple.",
      );
    else if (existingCursor.activeEnvelopeKey !== null)
      return yield* conflict(
        "cursor_conflict",
        "A new reconciliation cannot reset an open provider page envelope.",
      );
    else
      yield* patchRow("connectorIncrementalCursors", existingCursor._id, {
        providerCursor: input.initialCursor,
        traversalComplete: false,
        cursorGeneration:
          existingCursor.providerCursor === input.initialCursor
            ? existingCursor.cursorGeneration
            : existingCursor.cursorGeneration + 1,
        activeEnvelopeKey: null,
        lastProviderHighWater: null,
        ledgerHighWater,
        updatedAt: input.now,
      });
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

const getReconciliationStartContext = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "getReconciliationStartContext",
  (input) =>
    Effect.gen(function* () {
      const scope = yield* connectorScopeByKey(input.connectorScopeKey);
      if (
        scope === null ||
        scope.state !== "active" ||
        scope.providerKind === "structured"
      )
        return yield* notFound("activeConnectorScope", input.connectorScopeKey);
      const [intents, connection, latest] = yield* Effect.all([
        queryRows<StoredIntent>(
          "brainRequiredScopeIntents",
          "by_scope_intent_generation",
          (query) => query.eq("connectorScopeKey", input.connectorScopeKey),
          1,
          "desc",
        ),
        uniqueRow<StoredProviderConnection>(
          "providerConnections",
          "by_connection_key",
          (query) => query.eq("connectionKey", scope.connectionKey),
        ),
        latestRunForScope(input.connectorScopeKey),
      ]);
      const intent = intents[0];
      if (
        intent === undefined ||
        intent.state !== "required" ||
        connection === null ||
        connection.status !== "active" ||
        connection.organizationKey !== scope.organizationKey ||
        connection.connectionGeneration !== scope.currentConnectionGeneration ||
        connection.nangoConnectionId === null ||
        connection.nangoConnectionId === undefined ||
        intent.organizationKey !== scope.organizationKey ||
        intent.connectionKey !== scope.connectionKey ||
        intent.connectionGeneration !== scope.currentConnectionGeneration ||
        intent.allowlistGeneration !== scope.currentAllowlistGeneration ||
        intent.providerKind !== scope.providerKind
      )
        return yield* conflict(
          "required_intent_stale",
          "The connector scope is not backed by one current provider authority tuple.",
        );
      return {
        ...authorityFor(intent),
        workspaceId: intent.workspaceId as GenericId<"workspaces">,
        requiredScopeIntentKey: intent.requiredScopeIntentKey,
        expectedPreviousRunGeneration: latest?.runGeneration ?? 0,
        providerContainerKey: scope.providerContainerKey,
        providerConfigKey: connection.providerConfigKey,
        nangoConnectionId: connection.nangoConnectionId,
        currentRun:
          latest === null || !sameScopeTuple(latest, intent)
            ? null
            : {
                reconciliationRunKey: latest.reconciliationRunKey,
                runGeneration: latest.runGeneration,
                status: latest.status,
                providerHighWater: latest.providerHighWater,
                leaseId: latest.leaseId,
                leaseGeneration: latest.leaseGeneration,
              },
      };
    }),
);

const claimReconciliationStep = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "claimReconciliationStep",
  (input) =>
    Effect.gen(function* () {
      const run = yield* requireAuthoritativeRun(input.reconciliationRunKey);
      yield* assertRunRef({ run, ...input });
      if (
        run.status === "complete" ||
        run.status === "superseded" ||
        run.status === "blocked"
      )
        return yield* conflict(
          "phase_conflict",
          `A ${run.status} reconciliation run cannot be claimed.`,
        );
      if (run.leaseGeneration !== input.expectedLeaseGeneration)
        return yield* conflict(
          "phase_conflict",
          "The reconciliation lease generation changed before claim.",
        );
      if (run.leaseExpiresAt > input.now && run.leaseId !== input.leaseId)
        return yield* conflict(
          "phase_conflict",
          "Another reconciliation worker owns the unexpired lease.",
        );
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
      if (cursor === undefined || !sameScopeTuple(cursor, run))
        return yield* conflict(
          "scope_tuple_changed",
          "The reconciliation cursor no longer matches the run scope tuple.",
        );
      const intents = yield* queryRows<StoredIntent>(
        "brainRequiredScopeIntents",
        "by_scope_intent_generation",
        (query) => query.eq("connectorScopeKey", run.connectorScopeKey),
        1,
        "desc",
      );
      const intent = intents[0];
      if (
        intent === undefined ||
        intent.state !== "required" ||
        !sameScopeTuple(intent, run)
      )
        return yield* conflict(
          "required_intent_stale",
          "The current required-scope intent no longer matches the run.",
        );
      const [scope, connection] = yield* Effect.all([
        connectorScopeByKey(run.connectorScopeKey),
        uniqueRow<StoredProviderConnection>(
          "providerConnections",
          "by_connection_key",
          (query) => query.eq("connectionKey", run.connectionKey),
        ),
      ]);
      if (
        scope === null ||
        connection === null ||
        scope.state !== "active" ||
        scope.connectionKey !== run.connectionKey ||
        scope.currentConnectionGeneration !== run.connectionGeneration ||
        scope.currentAllowlistGeneration !== run.allowlistGeneration ||
        connection.organizationKey !== run.organizationKey ||
        connection.connectionGeneration !== run.connectionGeneration ||
        connection.status !== "active" ||
        connection.nangoConnectionId === null ||
        connection.nangoConnectionId === undefined
      )
        return yield* conflict(
          "scope_tuple_changed",
          "The active provider connection no longer matches the run tuple.",
        );
      let routingPolicyEpoch = 1;
      if (run.providerKind === "slack") {
        const policies = yield* queryRows<StoredSlackPolicy>(
          "channelRoutingPolicies",
          "by_channel_active",
          (query) =>
            query.eq("channelKey", run.connectorScopeKey).eq("active", true),
          2,
        );
        const policy = policies[0];
        if (
          policies.length !== 1 ||
          policy === undefined ||
          policy.organizationKey !== run.organizationKey ||
          policy.connectionKey !== run.connectionKey ||
          policy.connectionGeneration !== run.connectionGeneration
        )
          return yield* conflict(
            "required_intent_stale",
            "Slack reconciliation requires one current routing policy.",
          );
        routingPolicyEpoch = policy.policyEpoch;
      }
      const leaseGeneration = run.leaseGeneration + 1;
      const leaseExpiresAt = input.now + input.leaseDurationMs;
      yield* patchRow("connectorReconciliationRuns", run._id, {
        leaseId: input.leaseId,
        leaseGeneration,
        leaseExpiresAt,
        updatedAt: input.now,
      });
      return {
        ...authorityFor(run),
        workspaceId: run.workspaceId as GenericId<"workspaces">,
        requiredScopeIntentKey: intent.requiredScopeIntentKey,
        reconciliationRunKey: run.reconciliationRunKey,
        runGeneration: run.runGeneration,
        status: run.status,
        cursorKey: cursor.cursorKey,
        providerCursor: cursor.providerCursor,
        removalCursor: run.removalCursor,
        traversalComplete: cursor.traversalComplete,
        cursorGeneration: cursor.cursorGeneration,
        providerHighWater: run.providerHighWater,
        ledgerHighWater: cursor.ledgerHighWater,
        leaseId: input.leaseId,
        leaseGeneration,
        leaseExpiresAt,
        providerContainerKey: scope.providerContainerKey,
        providerConfigKey: connection.providerConfigKey,
        nangoConnectionId: connection.nangoConnectionId,
        teamId: connection.teamId ?? null,
        apiAppId: connection.apiAppId ?? null,
        botUserId: connection.botUserId ?? null,
        routingPolicyEpoch,
      };
    }),
);

const driveConfigurationRows = (run: {
  readonly connectorScopeKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
}) =>
  queryRows<StoredDriveScopeConfiguration>(
    "driveScopeConfigurations",
    "by_scope_tuple",
    (query) =>
      query
        .eq("connectorScopeKey", run.connectorScopeKey)
        .eq("connectionGeneration", run.connectionGeneration)
        .eq("allowlistGeneration", run.allowlistGeneration),
    2,
  );

const driveConfigurationResult = (row: StoredDriveScopeConfiguration) => ({
  configurationGeneration: row.configurationGeneration,
  driveId: row.driveId,
  rootFolderIds: row.rootFolderIds,
  sharedDrive: row.sharedDrive,
  retentionClass: row.retentionClass,
  permissionPolicyDigest: row.permissionPolicyDigest,
  configurationDigest: row.configurationDigest,
});

const upsertDriveScopeConfiguration = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "upsertDriveScopeConfiguration",
  (input) =>
    Effect.gen(function* () {
      if (input.providerKind !== "google_drive")
        return yield* conflict(
          "scope_tuple_changed",
          "Drive configuration can only bind to a Google Drive scope.",
        );
      const scope = yield* connectorScopeByKey(input.connectorScopeKey);
      if (
        scope === null ||
        scope.state !== "active" ||
        scope.organizationKey !== input.organizationKey ||
        scope.connectionKey !== input.connectionKey ||
        scope.providerKind !== input.providerKind ||
        scope.currentConnectionGeneration !== input.connectionGeneration ||
        scope.currentAllowlistGeneration !== input.allowlistGeneration
      )
        return yield* conflict(
          "scope_tuple_changed",
          "The Drive connector scope tuple is no longer active.",
        );
      const intents = yield* queryRows<StoredIntent>(
        "brainRequiredScopeIntents",
        "by_scope_intent_generation",
        (query) => query.eq("connectorScopeKey", input.connectorScopeKey),
        1,
        "desc",
      );
      const intent = intents[0];
      if (
        intent === undefined ||
        intent.state !== "required" ||
        !sameScopeTuple(intent, input)
      )
        return yield* conflict(
          "required_intent_stale",
          "Drive configuration must match the current required-scope intent.",
        );
      const roots = [...new Set(input.rootFolderIds.map((root) => root.trim()))]
        .filter((root) => root.length > 0)
        .sort();
      if (
        input.driveId.trim().length === 0 ||
        input.retentionClass.trim().length === 0 ||
        roots.length === 0 ||
        roots.length !== input.rootFolderIds.length
      )
        return yield* conflict(
          "page_conflict",
          "Drive configuration must use non-empty canonical unique roots.",
        );
      const existingRows = yield* driveConfigurationRows(input);
      if (existingRows.length > 1)
        return yield* conflict(
          "page_conflict",
          "The Drive scope tuple has duplicate configuration rows.",
        );
      const existing = existingRows[0] ?? null;
      const currentGeneration = existing?.configurationGeneration ?? 0;
      if (currentGeneration !== input.expectedConfigurationGeneration)
        return yield* conflict(
          "scope_tuple_changed",
          "The Drive configuration generation changed before update.",
        );
      const configurationGeneration = currentGeneration + 1;
      const driveId = input.driveId.trim();
      const retentionClass = input.retentionClass.trim();
      const configurationDigest = `sha256:${sha256Hex(
        JSON.stringify({
          connectorScopeKey: input.connectorScopeKey,
          connectionGeneration: input.connectionGeneration,
          allowlistGeneration: input.allowlistGeneration,
          configurationGeneration,
          driveId,
          rootFolderIds: roots,
          sharedDrive: input.sharedDrive,
          retentionClass,
          permissionPolicyDigest: input.permissionPolicyDigest,
        }),
      )}`;
      const row = {
        schemaVersion: 1,
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        connectorScopeKey: input.connectorScopeKey,
        connectionKey: input.connectionKey,
        connectionGeneration: input.connectionGeneration,
        allowlistGeneration: input.allowlistGeneration,
        configurationGeneration,
        driveId,
        rootFolderIds: roots,
        sharedDrive: input.sharedDrive,
        retentionClass,
        permissionPolicyDigest: input.permissionPolicyDigest,
        configurationDigest,
        createdAt: existing?.createdAt ?? input.now,
        updatedAt: input.now,
      } as const;
      if (existing === null) yield* insertRow("driveScopeConfigurations", row);
      else yield* patchRow("driveScopeConfigurations", existing._id, row);
      return {
        configurationGeneration,
        driveId,
        rootFolderIds: roots,
        sharedDrive: input.sharedDrive,
        retentionClass,
        permissionPolicyDigest: input.permissionPolicyDigest,
        configurationDigest,
      };
    }),
);

const getDriveScopeConfiguration = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "getDriveScopeConfiguration",
  (input) =>
    Effect.gen(function* () {
      const run = yield* requireRun(input.reconciliationRunKey);
      yield* assertRunRef({ run, ...input });
      const rows = yield* driveConfigurationRows(run);
      if (rows.length > 1)
        return yield* conflict(
          "page_conflict",
          "The Drive scope tuple has duplicate configuration rows.",
        );
      const row = rows[0];
      return row === undefined ? null : driveConfigurationResult(row);
    }),
);

const beginReconciliationPage = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "beginReconciliationPage",
  (input) =>
    Effect.gen(function* () {
      const run = yield* requireRun(input.reconciliationRunKey);
      yield* assertLeasedRunRef({ run, ...input });
      const latest = yield* latestRunForScope(run.connectorScopeKey);
      const cursor = yield* cursorByKey(input.cursorKey);
      if (cursor === null)
        return yield* notFound("connectorIncrementalCursor", input.cursorKey);
      const preparedDrivePage = input.preparedDrivePage;
      const preparedSlackPage = input.preparedSlackPage;
      const preparedTranscriptPage = input.preparedTranscriptPage;
      const preparedPages = [
        preparedDrivePage,
        preparedSlackPage,
        preparedTranscriptPage,
      ].filter((page) => page !== undefined);
      const preparedPage =
        preparedDrivePage ?? preparedSlackPage ?? preparedTranscriptPage;
      if (
        preparedPages.length !== 1 ||
        (run.providerKind === "google_drive") !==
          (preparedDrivePage !== undefined) ||
        (run.providerKind === "slack") !== (preparedSlackPage !== undefined) ||
        (run.providerKind === "transcript") !==
          (preparedTranscriptPage !== undefined)
      )
        return yield* conflict(
          "page_conflict",
          "Every provider page requires exactly one matching persisted prepared payload.",
        );
      if (
        preparedPage === undefined ||
        new TextEncoder().encode(JSON.stringify(preparedPage)).byteLength >
          MAX_PREPARED_PAGE_BYTES ||
        preparedPage.connectorScopeKey !== run.connectorScopeKey ||
        preparedPage.cursorBefore !== input.expectedCursor ||
        preparedPage.cursorAfter !== input.nextCursor ||
        preparedPage.terminal !== input.traversalComplete ||
        preparedPage.chunks.length !== input.chunks.length ||
        preparedPage.chunks.some(
          (chunk, index) =>
            chunk.length !== input.chunks[index]?.observationCount ||
            (preparedDrivePage !== undefined
              ? preparedDriveChunkDigest(chunk as readonly DrivePreparedWrite[])
              : preparedSlackPage !== undefined
                ? preparedSlackChunkDigest(
                    chunk as readonly PreparedSlackReconciliationWrite[],
                  )
                : preparedTranscriptChunkDigest(
                    chunk as readonly PreparedTranscriptReconciliationWrite[],
                  )) !== input.chunks[index]?.chunkDigest,
        )
      )
        return yield* conflict(
          "page_conflict",
          "The persisted provider page payload does not match its immutable descriptors.",
        );
      const ledgerHighWater =
        cursor.activeEnvelopeKey !== null ||
        cursor.cursorGeneration === input.expectedCursorGeneration + 1
          ? cursor.ledgerHighWater
          : cursor.ledgerHighWater +
            input.chunks.reduce(
              (count, chunk) => count + chunk.observationCount,
              0,
            );
      if (!Number.isSafeInteger(ledgerHighWater))
        return yield* conflict(
          "capacity_exceeded",
          "The reserved provider ledger sequence range exceeds safe integer capacity.",
        );
      if (cursor.activeEnvelopeKey !== null) {
        const active = yield* envelopeByKey(cursor.activeEnvelopeKey);
        if (
          active !== null &&
          active.reconciliationRunKey === run.reconciliationRunKey &&
          active.expectedCursor === input.expectedCursor &&
          active.expectedCursorGeneration === input.expectedCursorGeneration &&
          active.nextCursor === input.nextCursor &&
          active.traversalComplete === input.traversalComplete &&
          active.providerHighWater === input.providerHighWater &&
          active.ledgerHighWater === ledgerHighWater &&
          JSON.stringify(active.chunks) === JSON.stringify(input.chunks) &&
          JSON.stringify(active.preparedDrivePage) ===
            JSON.stringify(preparedDrivePage) &&
          JSON.stringify(active.preparedSlackPage) ===
            JSON.stringify(preparedSlackPage) &&
          JSON.stringify(active.preparedTranscriptPage) ===
            JSON.stringify(preparedTranscriptPage)
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
      const previousEnvelopes = yield* queryRows<StoredEnvelope>(
        "connectorPageEnvelopes",
        "by_cursor_generation",
        (query) =>
          query
            .eq("cursorKey", input.cursorKey)
            .eq("expectedCursorGeneration", input.expectedCursorGeneration),
        2,
      );
      if (previousEnvelopes.length > 1)
        return yield* conflict(
          "page_conflict",
          "Multiple immutable envelopes claim the same cursor generation.",
        );
      const previous = previousEnvelopes[0];
      if (previous !== undefined) {
        if (
          previous.reconciliationRunKey === run.reconciliationRunKey &&
          previous.expectedCursor === input.expectedCursor &&
          previous.nextCursor === input.nextCursor &&
          previous.traversalComplete === input.traversalComplete &&
          previous.providerHighWater === input.providerHighWater &&
          previous.ledgerHighWater === ledgerHighWater &&
          JSON.stringify(previous.chunks) === JSON.stringify(input.chunks) &&
          JSON.stringify(previous.preparedDrivePage) ===
            JSON.stringify(preparedDrivePage) &&
          JSON.stringify(previous.preparedSlackPage) ===
            JSON.stringify(preparedSlackPage) &&
          JSON.stringify(previous.preparedTranscriptPage) ===
            JSON.stringify(preparedTranscriptPage) &&
          cursor.cursorGeneration === input.expectedCursorGeneration + 1 &&
          cursor.providerCursor === previous.nextCursor &&
          cursor.traversalComplete === previous.traversalComplete
        )
          return {
            pageEnvelopeKey: previous.pageEnvelopeKey,
            pageDigest: previous.pageDigest,
            totalChunkCount: previous.chunks.length,
          };
        return yield* conflict(
          "page_conflict",
          "The cursor generation is already owned by a different page.",
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
          traversalComplete: input.traversalComplete,
          providerHighWater: input.providerHighWater,
          ledgerHighWater,
          chunks: input.chunks,
          ...(preparedDrivePage === undefined ? {} : { preparedDrivePage }),
          ...(preparedSlackPage === undefined ? {} : { preparedSlackPage }),
          ...(preparedTranscriptPage === undefined
            ? {}
            : { preparedTranscriptPage }),
          reserveLedgerRange: true,
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
        ledgerHighWater,
        updatedAt: input.now,
      });
      yield* patchRow("connectorReconciliationRuns", run._id, {
        ledgerHighWater,
        updatedAt: input.now,
      });
      return {
        pageEnvelopeKey: plan.envelope.pageEnvelopeKey,
        pageDigest: plan.envelope.pageDigest,
        totalChunkCount: plan.envelope.chunks.length,
      };
    }),
);

const verifyOrigin = (
  observation: ProviderObservation,
  authority: ReconciliationScopeAuthority,
) =>
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
        revision.channelKey !== authority.connectorScopeKey ||
        revision.contentHash !== observation.observationDigest
      )
        return yield* conflict(
          "page_conflict",
          "The Slack observation does not resolve to its immutable ledger row.",
        );
      return;
    }
    if (observation.originKind === "document") {
      if (observation.originRevisionKey.startsWith("gdout_")) {
        const outcome = yield* uniqueRow<StoredDocument>(
          "documentSourceOutcomes",
          "by_organization_outcome_key",
          (query) =>
            query
              .eq("organizationKey", observation.organizationKey)
              .eq("outcomeKey", observation.originRevisionKey),
        );
        if (
          outcome === null ||
          observation.initialObligationState !== "quarantined" ||
          outcome.providerObjectKey !== observation.providerObjectKey ||
          outcome.providerObjectKey !== observation.originKey ||
          outcome.connectorScopeKey !== authority.connectorScopeKey ||
          outcome.connectionKey !== observation.connectionKey ||
          outcome.connectionGeneration !== observation.connectionGeneration ||
          outcome.allowlistGeneration !== authority.allowlistGeneration ||
          (outcome.ledgerSequence ?? 0) !== observation.ledgerSequence ||
          observation.observationDigest !==
            `sha256:${observation.originRevisionKey.slice("gdout_".length)}`
        )
          return yield* conflict(
            "page_conflict",
            "The Drive coverage outcome does not resolve to its immutable ledger row.",
          );
        return;
      }
      if (observation.originRevisionKey.startsWith("gdobs_")) {
        const storedObservation = yield* uniqueRow<StoredDocument>(
          "documentSourceObservations",
          "by_organization_observation_key",
          (query) =>
            query
              .eq("organizationKey", observation.organizationKey)
              .eq("observationKey", observation.originRevisionKey),
        );
        if (
          storedObservation === null ||
          observation.initialObligationState !== "quarantined" ||
          storedObservation.observationKey !== observation.membershipKey ||
          storedObservation.documentObjectKey !== observation.originKey ||
          storedObservation.providerObjectKey !==
            observation.providerObjectKey ||
          storedObservation.connectorScopeKey !== authority.connectorScopeKey ||
          storedObservation.connectionKey !== observation.connectionKey ||
          storedObservation.connectionGeneration !==
            observation.connectionGeneration ||
          storedObservation.allowlistGeneration !==
            authority.allowlistGeneration ||
          (storedObservation.ledgerSequence ?? 0) !==
            observation.ledgerSequence ||
          observation.observationDigest !==
            `sha256:${observation.originRevisionKey.slice("gdobs_".length)}`
        )
          return yield* conflict(
            "page_conflict",
            "The quarantined Drive observation does not resolve to its immutable ledger row.",
          );
        return;
      }
      const revision = yield* uniqueRow<StoredDocument>(
        "documentSourceRevisions",
        "by_organization_revision_key",
        (query) =>
          query
            .eq("organizationKey", observation.organizationKey)
            .eq("documentRevisionKey", observation.originRevisionKey),
      );
      const membership = yield* uniqueRow<StoredDocument>(
        "documentSourceMembershipEdges",
        "by_organization_membership_edge_key",
        (query) =>
          query
            .eq("organizationKey", observation.organizationKey)
            .eq("membershipEdgeKey", observation.membershipKey),
      );
      const object = yield* uniqueRow<StoredDocument>(
        "documentSourceObjects",
        "by_organization_object_key",
        (query) =>
          query
            .eq("organizationKey", observation.organizationKey)
            .eq("documentObjectKey", observation.originKey),
      );
      if (
        revision === null ||
        membership === null ||
        object === null ||
        revision.documentObjectKey !== observation.originKey ||
        revision.providerObjectKey !== observation.providerObjectKey ||
        revision.connectionKey !== observation.connectionKey ||
        revision.connectionGeneration !== observation.connectionGeneration ||
        revision.connectorScopeKey !== authority.connectorScopeKey ||
        revision.allowlistGeneration !== authority.allowlistGeneration ||
        `sha256:${String(revision.contentHash)}` !==
          observation.observationDigest ||
        (revision.ledgerSequence ?? 0) !== observation.ledgerSequence ||
        membership.documentObjectKey !== observation.originKey ||
        membership.documentRevisionKey !== observation.originRevisionKey ||
        membership.providerObjectKey !== observation.providerObjectKey ||
        membership.connectorScopeKey !== authority.connectorScopeKey ||
        membership.connectionKey !== observation.connectionKey ||
        membership.connectionGeneration !== observation.connectionGeneration ||
        membership.allowlistGeneration !== authority.allowlistGeneration ||
        (membership.ledgerSequence ?? 0) !== observation.ledgerSequence ||
        object.providerObjectKey !== observation.providerObjectKey
      )
        return yield* conflict(
          "page_conflict",
          "The Drive observation does not resolve to its immutable document ledger rows.",
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
      unit.connectionKey !== observation.connectionKey ||
      unit.connectionGeneration !== observation.connectionGeneration
    )
      return yield* conflict(
        "page_conflict",
        "The transcript observation does not resolve to its immutable ledger row.",
      );
  });

const commitPreparedDriveChunk = (
  envelope: StoredEnvelope,
  chunkIndex: number,
) =>
  Effect.gen(function* () {
    const preparedPage = envelope.preparedDrivePage;
    const writes = preparedPage?.chunks[chunkIndex];
    if (preparedPage === undefined || writes === undefined)
      return yield* conflict(
        "chunk_conflict",
        "The Drive chunk has no persisted prepared payload.",
      );
    const totalCount = envelope.chunks.reduce(
      (count, chunk) => count + chunk.observationCount,
      0,
    );
    const priorCount = envelope.chunks
      .slice(0, chunkIndex)
      .reduce((count, chunk) => count + chunk.observationCount, 0);
    const sequenceBase = envelope.ledgerHighWater - totalCount + priorCount;
    const observations: ProviderObservation[] = [];
    const receipts: DriveIngestionReceipt[] = [];
    for (const [index, write] of writes.entries()) {
      const ledgerSequence = sequenceBase + index + 1;
      if (write.kind === "outcome") {
        const result = yield* runWithDriveDatabase(
          recordDriveSourceOutcomeAtSequence(write.args, ledgerSequence),
        ).pipe(
          Effect.mapError(
            () =>
              new ProviderReconciliationConflict({
                reason: "page_conflict",
                detail: "The prepared Drive outcome could not commit.",
              }),
          ),
        );
        observations.push(
          yield* runWithDriveDatabase(
            resolveDriveReconciliationOutcome({
              organizationKey: write.args.organizationKey,
              result,
            }),
          ).pipe(
            Effect.mapError(
              () =>
                new ProviderReconciliationConflict({
                  reason: "page_conflict",
                  detail: "The committed Drive outcome could not be projected.",
                }),
            ),
          ),
        );
        receipts.push(
          driveOutcomeReceipt(write.args.providerObjectKey, result),
        );
        continue;
      }
      const result = yield* runWithDriveDatabase(
        commitDriveObservationAtSequence(write.args, ledgerSequence),
      ).pipe(
        Effect.mapError(
          () =>
            new ProviderReconciliationConflict({
              reason: "page_conflict",
              detail: "The prepared Drive observation could not commit.",
            }),
        ),
      );
      if (
        result.documentRevisionKey !== null &&
        result.passageCount !== write.expectedPassageCount
      )
        return yield* conflict(
          "page_conflict",
          "The committed Drive passage count differs from preparation.",
        );
      const observation = yield* runWithDriveDatabase(
        resolveDriveReconciliationObservation({
          organizationKey: write.args.organizationKey,
          result,
        }),
      ).pipe(
        Effect.mapError(
          () =>
            new ProviderReconciliationConflict({
              reason: "page_conflict",
              detail: "The committed Drive observation could not be projected.",
            }),
        ),
      );
      if (observation === null)
        return yield* conflict(
          "page_conflict",
          "Every committed Drive observation must project to an obligation.",
        );
      observations.push(observation);
      receipts.push(
        driveCommittedReceipt(write.args.revision.providerObjectKey, result),
      );
    }
    return {
      observations,
      receipts,
      canonicalChunkDigest: preparedDriveChunkDigest(writes),
    };
  });

const reservedLedgerSequence = (
  envelope: StoredEnvelope,
  chunkIndex: number,
  writeIndex: number,
): number => {
  const totalCount = envelope.chunks.reduce(
    (count, chunk) => count + chunk.observationCount,
    0,
  );
  const priorCount = envelope.chunks
    .slice(0, chunkIndex)
    .reduce((count, chunk) => count + chunk.observationCount, 0);
  return envelope.ledgerHighWater - totalCount + priorCount + writeIndex + 1;
};

const commitPreparedSlackChunk = (
  envelope: StoredEnvelope,
  chunkIndex: number,
) =>
  Effect.gen(function* () {
    const writes = envelope.preparedSlackPage?.chunks[chunkIndex];
    if (writes === undefined)
      return yield* conflict(
        "chunk_conflict",
        "The Slack chunk has no persisted prepared payload.",
      );
    const observations: ProviderObservation[] = [];
    for (const [writeIndex, write] of writes.entries()) {
      const canonical = write.input;
      if (
        canonical.envelope.organizationKey !== envelope.organizationKey ||
        canonical.envelope.connectionKey !== envelope.connectionKey ||
        canonical.envelope.connectionGeneration !==
          envelope.connectionGeneration ||
        canonical.envelope.channelKey !== envelope.connectorScopeKey ||
        canonical.envelope.transport !== "reconciliation"
      )
        return yield* conflict(
          "scope_tuple_changed",
          "The persisted Slack observation is outside the page authority.",
        );
      const keys = sourceLedgerKeysFor(canonical);
      const [artifact, knownRevision, existingReceipt] = yield* Effect.all([
        uniqueRow<StoredDocument>(
          "sourceArtifacts",
          "by_org_connection_generation_channel_provider_object",
          (query) =>
            query
              .eq("organizationKey", envelope.organizationKey)
              .eq("connectionKey", envelope.connectionKey)
              .eq("connectionGeneration", envelope.connectionGeneration)
              .eq("channelKey", canonical.envelope.channelKey)
              .eq("providerObjectId", canonical.observation.providerObjectId),
        ),
        uniqueRow<StoredDocument>(
          "sourceRevisions",
          "by_source_revision_key",
          (query) =>
            query
              .eq("organizationKey", envelope.organizationKey)
              .eq("sourceRevisionKey", keys.sourceRevisionKey),
        ),
        uniqueRow<StoredDocument>(
          "providerEventReceipts",
          "by_connection_generation_transport_delivery",
          (query) =>
            query
              .eq("organizationKey", envelope.organizationKey)
              .eq("connectionKey", envelope.connectionKey)
              .eq("connectionGeneration", envelope.connectionGeneration)
              .eq("transport", "reconciliation")
              .eq(
                "transportDeliveryId",
                canonical.envelope.transportDeliveryId,
              ),
        ),
      ]);
      if (
        existingReceipt !== null &&
        (existingReceipt.observationKey !== keys.observationKey ||
          existingReceipt.sourceRevisionKey !== keys.sourceRevisionKey)
      )
        return yield* conflict(
          "chunk_conflict",
          "The Slack reconciliation delivery identity resolves to another observation.",
        );
      const rows = yield* Effect.try({
        try: () =>
          buildSlackReconciliationRows({
            write,
            ...(knownRevision === null
              ? {}
              : { existingObservationKey: keys.observationKey }),
            ...(artifact === null
              ? {}
              : {
                  existingArtifact: {
                    sourceKey: String(artifact.sourceKey),
                    latestProviderOrder: String(artifact.latestProviderOrder),
                    lifecycle: {
                      generation: Number(
                        (artifact.lifecycle as { generation?: unknown })
                          .generation,
                      ),
                    },
                    createdAt: Number(artifact.createdAt),
                  },
                }),
          }),
        catch: () =>
          new ProviderReconciliationConflict({
            reason: "page_conflict",
            detail:
              "The persisted Slack observation could not be normalized by the source adapter.",
          }),
      });
      if (existingReceipt === null)
        yield* insertRow("providerEventReceipts", rows.receipt);
      if (rows.revision !== null && rows.artifact !== null) {
        const ledgerSequence = reservedLedgerSequence(
          envelope,
          chunkIndex,
          writeIndex,
        );
        if (artifact === null)
          yield* insertRow("sourceArtifacts", rows.artifact);
        else yield* patchRow("sourceArtifacts", artifact._id, rows.artifact);
        yield* insertRow("sourceRevisions", {
          ...rows.revision,
          ledgerSequence,
        });
        if (rows.processingJob !== null)
          yield* insertRow("sourceProcessingJobs", rows.processingJob);
        yield* transitionEligibilityFenceEffect({
          identity: slackSourceLifecycleFenceIdentity({
            organizationKey: envelope.organizationKey,
            sourceKey: rows.revision.sourceKey,
          }),
          eligible: !rows.revision.tombstone,
          now: rows.revision.createdAt,
        });
      }
      const revision =
        rows.revision ??
        knownRevision ??
        (yield* uniqueRow<StoredDocument>(
          "sourceRevisions",
          "by_source_revision_key",
          (query) =>
            query
              .eq("organizationKey", envelope.organizationKey)
              .eq("sourceRevisionKey", keys.sourceRevisionKey),
        ));
      if (
        revision === null ||
        revision.sourceKey !== keys.sourceKey ||
        revision.contentHash !== keys.contentHash
      )
        return yield* conflict(
          "page_conflict",
          "The Slack adapter did not commit the expected immutable revision.",
        );
      observations.push(
        slackReconciliationObservation({
          organizationKey: envelope.organizationKey,
          connectionKey: envelope.connectionKey,
          connectionGeneration: envelope.connectionGeneration,
          channelKey: canonical.envelope.channelKey,
          sourceKey: keys.sourceKey,
          sourceRevisionKey: keys.sourceRevisionKey,
          providerObjectKey: canonical.observation.providerObjectId,
          ledgerSequence: reservedLedgerSequence(
            envelope,
            chunkIndex,
            writeIndex,
          ),
          observationDigest: keys.contentHash,
          tombstone: canonical.observation.tombstone,
        }),
      );
    }
    return {
      observations,
      canonicalChunkDigest: preparedSlackChunkDigest(writes),
    };
  });

const commitPreparedTranscriptChunk = (
  envelope: StoredEnvelope,
  chunkIndex: number,
) =>
  Effect.gen(function* () {
    const writes = envelope.preparedTranscriptPage?.chunks[chunkIndex];
    if (writes === undefined)
      return yield* conflict(
        "chunk_conflict",
        "The transcript chunk has no persisted prepared payload.",
      );
    const observations: ProviderObservation[] = [];
    for (const [writeIndex, write] of writes.entries()) {
      if (write.call.connectionKey !== envelope.connectionKey)
        return yield* conflict(
          "scope_tuple_changed",
          "The persisted transcript observation is outside the page authority.",
        );
      const result = yield* ingestSourceUnitEffect({
        input: write.call,
        authority: {
          kind: "provider",
          organizationKey: envelope.organizationKey,
          connectionKey: envelope.connectionKey,
          connectionGeneration: envelope.connectionGeneration,
        },
        caller: {
          kind: "system",
          name: "transcript-reconciliation",
          surface: "internal",
        },
        receivedAt: write.receivedAt,
      }).pipe(
        Effect.mapError(
          () =>
            new ProviderReconciliationConflict({
              reason: "page_conflict",
              detail:
                "The persisted transcript observation could not commit through the source adapter.",
            }),
        ),
      );
      const [revision, unit] = yield* Effect.all([
        uniqueRow<StoredDocument>(
          "sourceUnitRevisions",
          "by_unit_revision_key",
          (query) =>
            query
              .eq("organizationKey", envelope.organizationKey)
              .eq("unitRevisionKey", result.unitRevisionKey),
        ),
        uniqueRow<StoredDocument>("sourceUnits", "by_unit_key", (query) =>
          query
            .eq("organizationKey", envelope.organizationKey)
            .eq("unitKey", result.unitKey),
        ),
      ]);
      if (
        revision === null ||
        unit === null ||
        revision.unitKey !== result.unitKey ||
        unit.providerKey !== write.call.providerKey ||
        unit.externalCallId !== write.call.externalCallId
      )
        return yield* conflict(
          "page_conflict",
          "The transcript adapter did not commit the expected immutable revision.",
        );
      const ledgerSequence = reservedLedgerSequence(
        envelope,
        chunkIndex,
        writeIndex,
      );
      if (result.outcome !== "duplicate")
        yield* patchRow("sourceUnitRevisions", revision._id, {
          ledgerSequence,
        });
      observations.push(
        transcriptReconciliationObservation({
          organizationKey: envelope.organizationKey,
          connectionKey: envelope.connectionKey,
          connectionGeneration: envelope.connectionGeneration,
          providerKey: String(unit.providerKey),
          unitKey: result.unitKey,
          unitRevisionKey: result.unitRevisionKey,
          externalCallId: String(unit.externalCallId),
          ledgerSequence,
          observationDigest: String(revision.contentHash),
          tombstone: write.call.deleted,
        }),
      );
    }
    return {
      observations,
      canonicalChunkDigest: preparedTranscriptChunkDigest(writes),
    };
  });

const commitReconciliationPageChunk = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "commitReconciliationPageChunk",
  (input) =>
    Effect.gen(function* () {
      const envelope = yield* requireEnvelope(input.pageEnvelopeKey);
      const run = yield* requireAuthoritativeRun(envelope.reconciliationRunKey);
      yield* assertLeasedRunRef({ run, ...input });
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
      const sourceChunk =
        input.sourceChunk ??
        (input.driveChunk === true ? ("google_drive" as const) : null);
      const expectedSourceChunk =
        envelope.preparedDrivePage !== undefined
          ? ("google_drive" as const)
          : envelope.preparedSlackPage !== undefined
            ? ("slack" as const)
            : envelope.preparedTranscriptPage !== undefined
              ? ("transcript" as const)
              : null;
      if (
        sourceChunk !== expectedSourceChunk ||
        sourceChunk === null ||
        input.observations.length !== 0
      )
        return yield* conflict(
          "chunk_conflict",
          "The chunk mode does not match the immutable page payload.",
        );
      if (existing !== null) {
        const writes =
          sourceChunk === "google_drive"
            ? envelope.preparedDrivePage?.chunks[input.chunkIndex]
            : sourceChunk === "slack"
              ? envelope.preparedSlackPage?.chunks[input.chunkIndex]
              : envelope.preparedTranscriptPage?.chunks[input.chunkIndex];
        const persistedDigest =
          writes === undefined
            ? null
            : sourceChunk === "google_drive"
              ? preparedDriveChunkDigest(
                  writes as readonly DrivePreparedWrite[],
                )
              : sourceChunk === "slack"
                ? preparedSlackChunkDigest(
                    writes as readonly PreparedSlackReconciliationWrite[],
                  )
                : preparedTranscriptChunkDigest(
                    writes as readonly PreparedTranscriptReconciliationWrite[],
                  );
        if (
          writes === undefined ||
          existing.chunkDigest !== input.chunkDigest ||
          persistedDigest !== input.chunkDigest ||
          (sourceChunk === "google_drive" &&
            existing.driveReceipts === undefined)
        )
          return yield* conflict(
            "chunk_conflict",
            "The durable provider chunk receipt does not match its prepared payload.",
          );
        return {
          pageChunkKey: existing.pageChunkKey,
          observationCount: existing.observationCount,
          seenCount: existing.seenCount,
          obligationCount: existing.obligationCount,
          duplicate: true,
          ...(existing.driveReceipts === undefined
            ? {}
            : { driveReceipts: existing.driveReceipts }),
        };
      }
      const committedDrive =
        sourceChunk === "google_drive"
          ? yield* commitPreparedDriveChunk(envelope, input.chunkIndex)
          : null;
      const committedSlack =
        sourceChunk === "slack"
          ? yield* commitPreparedSlackChunk(envelope, input.chunkIndex)
          : null;
      const committedTranscript =
        sourceChunk === "transcript"
          ? yield* commitPreparedTranscriptChunk(envelope, input.chunkIndex)
          : null;
      const observations =
        committedDrive?.observations ??
        committedSlack?.observations ??
        committedTranscript?.observations ??
        [];
      const canonicalChunkDigest =
        committedDrive?.canonicalChunkDigest ??
        committedSlack?.canonicalChunkDigest ??
        committedTranscript?.canonicalChunkDigest;
      const planned = yield* mapInvariant(
        commitProviderPageChunkPlan({
          envelope,
          chunkIndex: input.chunkIndex,
          chunkDigest: input.chunkDigest,
          observations,
          existingReceipt: existing,
          ...(canonicalChunkDigest === undefined
            ? {}
            : { canonicalChunkDigest }),
          now: input.now,
        }),
      );
      if (
        run.status !== "scan" ||
        run.runGeneration !== envelope.runGeneration ||
        !sameScopeTuple(run, envelope)
      )
        return yield* conflict(
          "phase_conflict",
          "Only the authoritative scanning run may commit new page chunks.",
        );
      yield* requireCurrentIntent(
        input.requiredScopeIntentKey,
        authorityFor(envelope),
      );
      for (const observation of observations)
        yield* verifyOrigin(observation, authorityFor(envelope));
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
        let targetResolutionIntentId:
          GenericId<"providerTargetResolutionIntents"> | undefined;
        let targetResolutionIntentKey: string | null = null;
        if (obligation.cause === "observation") {
          targetResolutionIntentKey = providerTargetResolutionIntentKey({
            ingestionObligationKey: obligation.ingestionObligationKey,
          });
          const authority = {
            authorityKind: "reconciliation_page",
            targetResolutionIntentKey,
            ingestionObligationKey: obligation.ingestionObligationKey,
            requiredScopeIntentKey: input.requiredScopeIntentKey,
            pageChunkKey: planned.receipt.pageChunkKey,
            pageEnvelopeKey: envelope.pageEnvelopeKey,
            reconciliationRunKey: envelope.reconciliationRunKey,
            runGeneration: envelope.runGeneration,
            organizationKey: envelope.organizationKey,
            workspaceId: String(envelope.workspaceId),
            brainKey: envelope.brainKey,
            corpusKey: envelope.corpusKey,
            providerKind: envelope.providerKind,
            connectorScopeKey: envelope.connectorScopeKey,
            connectionKey: envelope.connectionKey,
            connectionGeneration: envelope.connectionGeneration,
            allowlistGeneration: envelope.allowlistGeneration,
            membershipKey: obligation.membershipKey,
            originKind: obligation.originKind,
            originKey: obligation.originKey,
            originRevisionKey: obligation.originRevisionKey,
            ledgerSequence: obligation.ledgerSequence,
            observationDigest: obligation.observationDigest,
            resolutionGeneration: 1,
          } satisfies ReconciliationPageTargetResolutionAuthority;
          targetResolutionIntentId = (yield* insertRow(
            "providerTargetResolutionIntents",
            {
              schemaVersion: 1,
              ...authority,
              workspaceId: envelope.workspaceId,
              authorityDigest:
                providerTargetResolutionAuthorityDigest(authority),
              status: "pending",
              attemptCount: 0,
              nextAttemptAt: input.now,
              lastErrorTag: null,
              targetCount: 0,
              targetDigest: null,
              targets: [],
              completedAt: null,
              createdAt: input.now,
              updatedAt: input.now,
            },
          )) as GenericId<"providerTargetResolutionIntents">;
        }
        yield* insertRow("ingestionObligations", {
          schemaVersion: 1,
          ...obligation,
          workspaceId: envelope.workspaceId,
          requiredScopeIntentKey: input.requiredScopeIntentKey,
          ...(targetResolutionIntentId === undefined
            ? {}
            : { targetResolutionIntentId }),
          targetResolutionIntentKey,
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
        ...(committedDrive === null
          ? {}
          : { driveReceipts: committedDrive.receipts }),
      });
      yield* patchRow("connectorReconciliationRuns", run._id, {
        observedCount: run.observedCount + planned.receipt.observationCount,
        obligationCount:
          run.obligationCount +
          planned.obligations.filter(({ cause }) => cause === "observation")
            .length,
        removalRequiredCount:
          run.removalRequiredCount +
          planned.obligations.filter(({ cause }) => cause === "removal").length,
        removalBacklogCount:
          run.removalBacklogCount +
          planned.obligations.filter(({ cause }) => cause === "removal").length,
        updatedAt: input.now,
      });
      return {
        pageChunkKey: planned.receipt.pageChunkKey,
        observationCount: planned.receipt.observationCount,
        seenCount: planned.receipt.seenCount,
        obligationCount: planned.receipt.obligationCount,
        duplicate: false,
        ...(committedDrive === null
          ? {}
          : { driveReceipts: committedDrive.receipts }),
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
      const leasedRun = yield* requireRun(envelope.reconciliationRunKey);
      yield* assertLeasedRunRef({ run: leasedRun, ...input });
      if (envelope.cursorKey !== input.cursorKey)
        return yield* conflict(
          "cursor_conflict",
          "The requested cursor does not own this page envelope.",
        );
      const cursor = yield* cursorByKey(input.cursorKey);
      if (cursor === null)
        return yield* notFound("connectorIncrementalCursor", input.cursorKey);
      if (
        cursor.cursorGeneration === envelope.expectedCursorGeneration + 1 &&
        cursor.providerCursor === envelope.nextCursor &&
        cursor.traversalComplete === envelope.traversalComplete &&
        cursor.activeEnvelopeKey === null &&
        cursor.lastProviderHighWater === envelope.providerHighWater &&
        cursor.ledgerHighWater >= envelope.ledgerHighWater
      )
        return {
          providerCursor: cursor.providerCursor,
          traversalComplete: cursor.traversalComplete,
          cursorGeneration: cursor.cursorGeneration,
          ledgerHighWater: cursor.ledgerHighWater,
        };
      const run = yield* requireAuthoritativeRun(envelope.reconciliationRunKey);
      if (
        run.status !== "scan" ||
        run.runGeneration !== envelope.runGeneration ||
        !sameScopeTuple(run, envelope)
      )
        return yield* conflict(
          "phase_conflict",
          "Only the authoritative scanning run may finalize a new page.",
        );
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
        traversalComplete: advanced.traversalComplete,
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
        traversalComplete: advanced.traversalComplete,
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
      yield* assertLeasedRunRef({ run, ...input });
      const latest = yield* latestRunForScope(run.connectorScopeKey);
      if (
        latest?.reconciliationRunKey === run.reconciliationRunKey &&
        (run.status === "traversal_closed" ||
          run.status === "apply_removals" ||
          run.status === "drain_derived" ||
          run.status === "complete")
      )
        return {
          reconciliationRunKey: run.reconciliationRunKey,
          status: "traversal_closed" as const,
        };
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
          traversalComplete: cursor.traversalComplete,
          activeEnvelopeKey: cursor.activeEnvelopeKey,
          now: input.now,
        }),
      );
      yield* patchRow("connectorReconciliationRuns", run._id, {
        status: closed.status,
        scanCursor: cursor.providerCursor,
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
      yield* assertLeasedRunRef({ run, ...input });
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
        yield* verifyOrigin(
          {
            organizationKey: run.organizationKey,
            connectionKey: run.connectionKey,
            connectionGeneration: run.connectionGeneration,
            membershipKey: candidate.membershipKey,
            providerObjectKey: candidate.providerObjectKey,
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
                : candidate.originKind === "transcript"
                  ? String(
                      (yield* uniqueRow<StoredDocument>(
                        "sourceUnitRevisions",
                        "by_unit_revision_key",
                        (query) =>
                          query
                            .eq("organizationKey", run.organizationKey)
                            .eq("unitRevisionKey", candidate.originRevisionKey),
                      ))?.contentHash ?? "",
                    )
                  : `sha256:${String(
                      (yield* uniqueRow<StoredDocument>(
                        "documentSourceRevisions",
                        "by_organization_revision_key",
                        (query) =>
                          query
                            .eq("organizationKey", run.organizationKey)
                            .eq(
                              "documentRevisionKey",
                              candidate.originRevisionKey,
                            ),
                      ))?.contentHash ?? "",
                    )}`,
          },
          authorityFor(run),
        );
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

const retireRemovalLifecycle = (obligation: StoredObligation, now: number) =>
  Effect.gen(function* () {
    if (obligation.originKind === "slack") {
      const artifact = yield* uniqueRow<StoredDocument>(
        "sourceArtifacts",
        "by_org_source_key",
        (query) =>
          query
            .eq("organizationKey", obligation.organizationKey)
            .eq("sourceKey", obligation.originKey),
      );
      const lifecycle = artifact?.lifecycle as
        | {
            readonly state: string;
            readonly generation: number;
            readonly purgeAfter: number | null;
          }
        | undefined;
      if (
        artifact === null ||
        artifact.connectionKey !== obligation.connectionKey ||
        artifact.connectionGeneration !== obligation.connectionGeneration ||
        artifact.channelKey !== obligation.connectorScopeKey ||
        lifecycle === undefined
      )
        return yield* conflict(
          "removal_incomplete",
          "The Slack removal no longer resolves to its exact source lifecycle.",
        );
      if (lifecycle.state === "active")
        yield* patchRow("sourceArtifacts", artifact._id, {
          lifecycle: {
            state: "deleted_tombstone",
            generation: lifecycle.generation + 1,
            updatedAt: now,
            purgeAfter: lifecycle.purgeAfter,
          },
          updatedAt: now,
        });
      yield* transitionEligibilityFenceEffect({
        identity: slackSourceLifecycleFenceIdentity({
          organizationKey: obligation.organizationKey,
          sourceKey: obligation.originKey,
        }),
        eligible: false,
        now,
      });
      return;
    }
    if (obligation.originKind === "transcript") {
      const unit = yield* uniqueRow<StoredDocument>(
        "sourceUnits",
        "by_unit_key",
        (query) =>
          query
            .eq("organizationKey", obligation.organizationKey)
            .eq("unitKey", obligation.originKey),
      );
      const lifecycle = unit?.lifecycle as
        | {
            readonly state: string;
            readonly generation: number;
            readonly purgeAfter: number | null;
          }
        | undefined;
      if (
        unit === null ||
        unit.connectionKey !== obligation.connectionKey ||
        unit.connectionGeneration !== obligation.connectionGeneration ||
        lifecycle === undefined
      )
        return yield* conflict(
          "removal_incomplete",
          "The transcript removal no longer resolves to its exact source lifecycle.",
        );
      if (lifecycle.state === "active")
        yield* patchRow("sourceUnits", unit._id, {
          lifecycle: {
            state: "deleted_tombstone",
            generation: lifecycle.generation + 1,
            updatedAt: now,
            purgeAfter: lifecycle.purgeAfter,
          },
          updatedAt: now,
        });
      yield* transitionEligibilityFenceEffect({
        identity: transcriptUnitLifecycleFenceIdentity({
          organizationKey: obligation.organizationKey,
          unitKey: obligation.originKey,
        }),
        eligible: false,
        now,
      });
      return;
    }
    const membership = yield* uniqueRow<StoredDocument>(
      "documentSourceMembershipEdges",
      "by_organization_membership_edge_key",
      (query) =>
        query
          .eq("organizationKey", obligation.organizationKey)
          .eq("membershipEdgeKey", obligation.membershipKey),
    );
    if (
      membership === null ||
      membership.documentObjectKey !== obligation.originKey ||
      membership.documentRevisionKey !== obligation.originRevisionKey ||
      membership.connectorScopeKey !== obligation.connectorScopeKey ||
      membership.connectionKey !== obligation.connectionKey ||
      membership.connectionGeneration !== obligation.connectionGeneration ||
      membership.allowlistGeneration !== obligation.allowlistGeneration
    )
      return yield* conflict(
        "removal_incomplete",
        "The Drive removal no longer resolves to its exact membership lifecycle.",
      );
    if (membership.membershipState === "active")
      yield* patchRow("documentSourceMembershipEdges", membership._id, {
        membershipState: "tombstoned",
      });
  });

const drainRemovalPublication = (obligation: StoredObligation, now: number) =>
  commitPreparedPublicationEffect({
    organizationKey: obligation.organizationKey,
    workspaceId: obligation.workspaceId as GenericId<"workspaces">,
    brainKey: obligation.brainKey,
    corpusKey: obligation.corpusKey,
    kind:
      obligation.originKind === "document" ? "document" : obligation.originKind,
    originTable:
      obligation.originKind === "slack"
        ? "sourceRevisions"
        : obligation.originKind === "transcript"
          ? "sourceUnitRevisions"
          : "documentSourceRevisions",
    sourceKey: obligation.originKey,
    sourceRevisionKey: obligation.originRevisionKey,
    connectionKey: obligation.connectionKey,
    connectionGeneration: obligation.connectionGeneration,
    ...(obligation.originKind === "transcript"
      ? {}
      : { connectorScopeKey: obligation.connectorScopeKey }),
    authority: "authoritative",
    authorityPolicyKey: "provider-reconciliation-removal",
    policyGeneration: 1,
    lifecycleGeneration: 1,
    routeGeneration: 1,
    revoked: true,
    passages: [],
    now,
  }).pipe(
    Effect.mapError(
      () =>
        new ProviderReconciliationConflict({
          reason: "drain_incomplete",
          detail: "The exact derived retrieval publication could not retire.",
        }),
    ),
  );

type ObservationProgressStatus =
  | { readonly kind: "eligible" }
  | { readonly kind: "policy_excluded"; readonly errorTag: string }
  | { readonly kind: "failed"; readonly errorTag: string };

const obligationScopeAuthorityStatusEffect = (
  obligation: StoredObligation,
): Effect.Effect<ObservationProgressStatus, never, DatabaseReader> =>
  Effect.gen(function* () {
    const [intents, scopes, allowlists, connections] = yield* Effect.all([
      queryRows<StoredIntent>(
        "brainRequiredScopeIntents",
        "by_required_scope_intent_key",
        (query) =>
          query.eq("requiredScopeIntentKey", obligation.requiredScopeIntentKey),
        2,
      ),
      queryRows<StoredConnectorScope>(
        "connectorScopes",
        "by_connector_scope_key",
        (query) => query.eq("connectorScopeKey", obligation.connectorScopeKey),
        2,
      ),
      queryRows<StoredAllowlistGeneration>(
        "connectorAllowlistGenerations",
        "by_scope_generation",
        (query) =>
          query
            .eq("connectorScopeKey", obligation.connectorScopeKey)
            .eq("allowlistGeneration", obligation.allowlistGeneration),
        2,
      ),
      queryRows<StoredProviderConnection>(
        "providerConnections",
        "by_connection_key",
        (query) => query.eq("connectionKey", obligation.connectionKey),
        2,
      ),
    ]);
    if (
      intents.length !== 1 ||
      scopes.length !== 1 ||
      allowlists.length !== 1 ||
      connections.length !== 1
    )
      return {
        kind: "failed",
        errorTag: "IngestionAuthorityMissingOrDuplicate",
      };
    const intent = intents[0];
    const scope = scopes[0];
    const allowlist = allowlists[0];
    const connection = connections[0];
    if (
      intent === undefined ||
      scope === undefined ||
      allowlist === undefined ||
      connection === undefined ||
      !sameScopeTuple(intent, obligation) ||
      scope.organizationKey !== obligation.organizationKey ||
      scope.providerKind !== obligation.providerKind ||
      scope.connectionKey !== obligation.connectionKey ||
      allowlist.organizationKey !== obligation.organizationKey ||
      allowlist.connectionKey !== obligation.connectionKey ||
      allowlist.connectionGeneration !== obligation.connectionGeneration ||
      connection.organizationKey !== obligation.organizationKey
    )
      return {
        kind: "failed",
        errorTag: "IngestionAuthorityTupleMismatch",
      };
    if (
      intent.state === "decommissioned" ||
      scope.state === "revoked" ||
      allowlist.state === "revoked" ||
      connection.status === "revoked"
    )
      return {
        kind: "policy_excluded",
        errorTag: "IngestionScopePolicyExcluded",
      };
    if (
      intent.state !== "required" ||
      scope.state !== "active" ||
      scope.currentConnectionGeneration !== obligation.connectionGeneration ||
      scope.currentAllowlistGeneration !== obligation.allowlistGeneration ||
      allowlist.state !== "current" ||
      connection.status !== "active" ||
      connection.connectionGeneration !== obligation.connectionGeneration
    )
      return {
        kind: "failed",
        errorTag: "IngestionAuthorityNotCurrent",
      };
    return { kind: "eligible" };
  });

const observationProgressStatusEffect = (
  obligation: StoredObligation,
  resolveTarget: boolean,
): Effect.Effect<ObservationProgressStatus, never, DatabaseReader> =>
  Effect.gen(function* () {
    const authority = yield* obligationScopeAuthorityStatusEffect(obligation);
    if (authority.kind === "failed") return authority;
    if (authority.kind === "policy_excluded" && resolveTarget) return authority;
    if (obligation.originKind === "slack") {
      const [revisions, artifacts] = yield* Effect.all([
        queryRows<StoredSlackRevision>(
          "sourceRevisions",
          "by_source_revision_key",
          (query) =>
            query
              .eq("organizationKey", obligation.organizationKey)
              .eq("sourceRevisionKey", obligation.originRevisionKey),
          2,
        ),
        queryRows<StoredSlackArtifact>(
          "sourceArtifacts",
          "by_org_source_key",
          (query) =>
            query
              .eq("organizationKey", obligation.organizationKey)
              .eq("sourceKey", obligation.originKey),
          2,
        ),
      ]);
      const revision = revisions[0];
      const artifact = artifacts[0];
      if (
        revisions.length !== 1 ||
        artifacts.length !== 1 ||
        revision === undefined ||
        artifact === undefined ||
        revision.sourceKey !== obligation.originKey ||
        revision.connectionKey !== obligation.connectionKey ||
        revision.connectionGeneration !== obligation.connectionGeneration ||
        revision.channelKey !== obligation.connectorScopeKey ||
        revision.ledgerSequence !== obligation.ledgerSequence ||
        revision.tombstone ||
        revision.lifecycle.state !== "active" ||
        revision.normalizedText.trim().length === 0 ||
        artifact.sourceKey !== obligation.originKey ||
        artifact.latestSourceRevisionKey !== obligation.originRevisionKey ||
        artifact.connectionKey !== obligation.connectionKey ||
        artifact.connectionGeneration !== obligation.connectionGeneration ||
        artifact.channelKey !== obligation.connectorScopeKey ||
        artifact.lifecycle.state !== "active"
      )
        return {
          kind: "failed",
          errorTag: "SlackNormalizedSourceAuthorityInvalid",
        };
      if (!resolveTarget) return { kind: "eligible" };
      const policies = yield* queryRows<StoredSlackPolicy>(
        "channelRoutingPolicies",
        "by_channel_active",
        (query) =>
          query
            .eq("channelKey", obligation.connectorScopeKey)
            .eq("active", true),
        3,
      );
      if (policies.length > 1)
        return {
          kind: "failed",
          errorTag: "SlackTargetPolicyAmbiguous",
        };
      const policy = policies[0];
      return policy !== undefined &&
        policy.organizationKey === obligation.organizationKey &&
        policy.connectionKey === obligation.connectionKey &&
        policy.connectionGeneration === obligation.connectionGeneration &&
        policy.mode !== "capture_only" &&
        policy.targetBrainKeys.includes(obligation.brainKey) &&
        policy.historicalBackfillStartAt !== undefined &&
        revision.sourceCreatedAt >= policy.historicalBackfillStartAt
        ? { kind: "eligible" }
        : {
            kind: "policy_excluded",
            errorTag: "SlackTargetPolicyExcluded",
          };
    }

    if (obligation.originKind === "transcript") {
      const [revisions, units, segments] = yield* Effect.all([
        queryRows<StoredTranscriptRevision>(
          "sourceUnitRevisions",
          "by_unit_revision_key",
          (query) =>
            query
              .eq("organizationKey", obligation.organizationKey)
              .eq("unitRevisionKey", obligation.originRevisionKey),
          2,
        ),
        queryRows<StoredTranscriptUnit>(
          "sourceUnits",
          "by_unit_key",
          (query) =>
            query
              .eq("organizationKey", obligation.organizationKey)
              .eq("unitKey", obligation.originKey),
          2,
        ),
        queryRows<StoredDocument>(
          "sourceSegments",
          "by_unit_revision_ordinal",
          (query) =>
            query
              .eq("organizationKey", obligation.organizationKey)
              .eq("unitRevisionKey", obligation.originRevisionKey),
          1,
        ),
      ]);
      const revision = revisions[0];
      const unit = units[0];
      if (
        revisions.length !== 1 ||
        units.length !== 1 ||
        segments.length === 0 ||
        revision === undefined ||
        unit === undefined ||
        revision.unitKey !== obligation.originKey ||
        revision.ledgerSequence !== obligation.ledgerSequence ||
        revision.tombstone ||
        unit.unitKey !== obligation.originKey ||
        unit.currentUnitRevisionKey !== obligation.originRevisionKey ||
        unit.connectionKey !== obligation.connectionKey ||
        unit.connectionGeneration !== obligation.connectionGeneration ||
        unit.lifecycle.state !== "active"
      )
        return {
          kind: "failed",
          errorTag: "TranscriptNormalizedSourceAuthorityInvalid",
        };
      if (!resolveTarget) return { kind: "eligible" };
      const routes = yield* queryRows<StoredTranscriptRoute>(
        "callRoutingProposals",
        "by_org_revision",
        (query) =>
          query
            .eq("organizationKey", obligation.organizationKey)
            .eq("unitRevisionKey", obligation.originRevisionKey),
        101,
      );
      if (routes.length > 100)
        return {
          kind: "failed",
          errorTag: "TranscriptTargetRouteCapacityExceeded",
        };
      return routes.some(
        (route) =>
          route.unitKey === obligation.originKey &&
          route.outcome === "routed" &&
          route.brainKey === obligation.brainKey &&
          (route.status === "current" || route.status === "accepted"),
      )
        ? { kind: "eligible" }
        : {
            kind: "policy_excluded",
            errorTag: "TranscriptTargetPolicyExcluded",
          };
    }

    const [revisions, objects, memberships, passages] = yield* Effect.all([
      queryRows<StoredDocumentRevision>(
        "documentSourceRevisions",
        "by_organization_revision_key",
        (query) =>
          query
            .eq("organizationKey", obligation.organizationKey)
            .eq("documentRevisionKey", obligation.originRevisionKey),
        2,
      ),
      queryRows<StoredDocumentObject>(
        "documentSourceObjects",
        "by_organization_object_key",
        (query) =>
          query
            .eq("organizationKey", obligation.organizationKey)
            .eq("documentObjectKey", obligation.originKey),
        2,
      ),
      queryRows<StoredDocumentMembership>(
        "documentSourceMembershipEdges",
        "by_organization_membership_edge_key",
        (query) =>
          query
            .eq("organizationKey", obligation.organizationKey)
            .eq("membershipEdgeKey", obligation.membershipKey),
        2,
      ),
      queryRows<StoredDocument>(
        "documentSourcePassages",
        "by_revision_ordinal",
        (query) =>
          query.eq("documentRevisionKey", obligation.originRevisionKey),
        1,
      ),
    ]);
    const revision = revisions[0];
    const object = objects[0];
    const membership = memberships[0];
    if (
      revisions.length !== 1 ||
      objects.length !== 1 ||
      memberships.length !== 1 ||
      passages.length === 0 ||
      revision === undefined ||
      object === undefined ||
      membership === undefined ||
      revision.documentObjectKey !== obligation.originKey ||
      revision.connectorScopeKey !== obligation.connectorScopeKey ||
      revision.connectionKey !== obligation.connectionKey ||
      revision.connectionGeneration !== obligation.connectionGeneration ||
      revision.allowlistGeneration !== obligation.allowlistGeneration ||
      revision.ledgerSequence !== obligation.ledgerSequence ||
      revision.tombstone ||
      object.documentObjectKey !== obligation.originKey ||
      object.lifecycleState !== "live" ||
      membership.documentObjectKey !== obligation.originKey ||
      membership.documentRevisionKey !== obligation.originRevisionKey ||
      membership.connectorScopeKey !== obligation.connectorScopeKey ||
      membership.connectionKey !== obligation.connectionKey ||
      membership.connectionGeneration !== obligation.connectionGeneration ||
      membership.allowlistGeneration !== obligation.allowlistGeneration ||
      membership.membershipState !== "active"
    )
      return {
        kind: "failed",
        errorTag: "DriveNormalizedSourceAuthorityInvalid",
      };
    return { kind: "eligible" };
  });

const transitionStoredObligationEffect = (
  obligation: StoredObligation,
  nextState: IngestionObligationState,
  input: {
    readonly targetResolutionIntentKey?: string | null;
    readonly publicationJobKeys?: readonly string[];
    readonly errorTag?: string | null;
    readonly now: number;
  },
) =>
  Effect.gen(function* () {
    yield* mapInvariant(
      transitionIngestionObligationPlan({
        current: obligation.state,
        expected: obligation.state,
        next: nextState,
      }),
    );
    const terminal = isSuccessfulObligationState(nextState);
    yield* patchRow("ingestionObligations", obligation._id, {
      state: nextState,
      targetResolutionIntentKey:
        input.targetResolutionIntentKey ?? obligation.targetResolutionIntentKey,
      publicationJobKeys: [
        ...(input.publicationJobKeys ?? obligation.publicationJobKeys),
      ],
      errorTag:
        input.errorTag === undefined ? obligation.errorTag : input.errorTag,
      terminalAt: terminal ? input.now : null,
      updatedAt: input.now,
    });
    return {
      ...obligation,
      state: nextState,
      targetResolutionIntentKey:
        input.targetResolutionIntentKey ?? obligation.targetResolutionIntentKey,
      publicationJobKeys:
        input.publicationJobKeys ?? obligation.publicationJobKeys,
      errorTag:
        input.errorTag === undefined ? obligation.errorTag : input.errorTag,
      terminalAt: terminal ? input.now : null,
      updatedAt: input.now,
    } satisfies StoredObligation;
  });

const publicationJobByKey = (jobKey: string) =>
  Effect.gen(function* () {
    const rows = yield* queryRows<StoredPublicationJob>(
      "retrievalPublicationJobs",
      "by_job_key",
      (query) => query.eq("jobKey", jobKey),
      2,
    );
    return rows.length === 1 ? (rows[0] ?? null) : null;
  });

const publicationJobMatchesObligation = (
  job: StoredPublicationJob,
  obligation: StoredObligation,
) =>
  job.ingestionObligationKey === obligation.ingestionObligationKey &&
  job.organizationKey === obligation.organizationKey &&
  String(job.workspaceId) === String(obligation.workspaceId) &&
  job.brainKey === obligation.brainKey &&
  job.originKind === obligation.originKind &&
  job.sourceKey === obligation.originKey &&
  job.sourceRevisionKey === obligation.originRevisionKey &&
  (obligation.targetResolutionIntentId === undefined ||
    (job.providerTargetResolutionIntentId ===
      obligation.targetResolutionIntentId &&
      job.providerTargetResolutionGeneration === 1));

const publicationLineageMatchesResolution = (
  jobs: readonly StoredPublicationJob[],
  canonicalJob: StoredPublicationJob,
  obligation: StoredObligation,
  intent: StoredProviderTargetIntent,
) => {
  if (
    jobs.length > 100 ||
    !jobs.every(
      (candidate) =>
        candidate.authorityDigest !== undefined &&
        candidate.providerTargetResolutionIntentId === intent._id &&
        candidate.providerTargetResolutionGeneration ===
          intent.resolutionGeneration &&
        publicationJobMatchesObligation(candidate, obligation),
    )
  )
    return false;
  if (canonicalJob.effectClass === "direct_publication")
    return jobs.length === 1 && jobs[0]?.jobKey === canonicalJob.jobKey;
  if (canonicalJob.effectClass !== "attributed_repair") return false;
  const predecessorKey = canonicalJob.authorityEnvelope?.repairOfJobKey;
  if (
    predecessorKey === undefined ||
    predecessorKey === canonicalJob.jobKey ||
    obligation.publicationJobKeys.length > 1 ||
    (obligation.publicationJobKeys.length === 1 &&
      obligation.publicationJobKeys[0] !== predecessorKey)
  )
    return false;
  const predecessor = jobs.find(
    (candidate) => candidate.jobKey === predecessorKey,
  );
  return (
    jobs.length === 2 &&
    jobs.some((candidate) => candidate.jobKey === canonicalJob.jobKey) &&
    predecessor?.effectClass === "direct_publication" &&
    predecessor.status === "dead_letter"
  );
};

const providerIntentAuthorityOf = (
  intent: StoredProviderTargetIntent,
): ReconciliationPageTargetResolutionAuthority => ({
  authorityKind: "reconciliation_page",
  targetResolutionIntentKey: intent.targetResolutionIntentKey,
  ingestionObligationKey: intent.ingestionObligationKey,
  requiredScopeIntentKey: intent.requiredScopeIntentKey,
  pageChunkKey: intent.pageChunkKey,
  pageEnvelopeKey: intent.pageEnvelopeKey,
  reconciliationRunKey: intent.reconciliationRunKey,
  runGeneration: intent.runGeneration,
  organizationKey: intent.organizationKey,
  workspaceId: String(intent.workspaceId),
  brainKey: intent.brainKey,
  corpusKey: intent.corpusKey,
  providerKind: intent.providerKind,
  connectorScopeKey: intent.connectorScopeKey,
  connectionKey: intent.connectionKey,
  connectionGeneration: intent.connectionGeneration,
  allowlistGeneration: intent.allowlistGeneration,
  membershipKey: intent.membershipKey,
  originKind: intent.originKind,
  originKey: intent.originKey,
  originRevisionKey: intent.originRevisionKey,
  ledgerSequence: intent.ledgerSequence,
  observationDigest: intent.observationDigest,
  resolutionGeneration: intent.resolutionGeneration,
});

const providerIntentMatchesObligation = (
  intent: StoredProviderTargetIntent,
  obligation: StoredObligation,
) =>
  obligation.targetResolutionIntentId !== undefined &&
  intent._id === obligation.targetResolutionIntentId &&
  intent.targetResolutionIntentKey === obligation.targetResolutionIntentKey &&
  intent.ingestionObligationKey === obligation.ingestionObligationKey &&
  intent.requiredScopeIntentKey === obligation.requiredScopeIntentKey &&
  intent.reconciliationRunKey === obligation.reconciliationRunKey &&
  intent.runGeneration === obligation.runGeneration &&
  intent.organizationKey === obligation.organizationKey &&
  String(intent.workspaceId) === String(obligation.workspaceId) &&
  intent.brainKey === obligation.brainKey &&
  intent.corpusKey === obligation.corpusKey &&
  intent.providerKind === obligation.providerKind &&
  intent.connectorScopeKey === obligation.connectorScopeKey &&
  intent.connectionKey === obligation.connectionKey &&
  intent.connectionGeneration === obligation.connectionGeneration &&
  intent.allowlistGeneration === obligation.allowlistGeneration &&
  intent.membershipKey === obligation.membershipKey &&
  intent.originKind === obligation.originKind &&
  intent.originKey === obligation.originKey &&
  intent.originRevisionKey === obligation.originRevisionKey &&
  intent.ledgerSequence === obligation.ledgerSequence &&
  intent.authorityDigest ===
    providerTargetResolutionAuthorityDigest(providerIntentAuthorityOf(intent));

const providerIntentForObligationEffect = (obligation: StoredObligation) =>
  Effect.gen(function* () {
    const intent = yield* uniqueRow<StoredProviderTargetIntent>(
      "providerTargetResolutionIntents",
      "by_ingestion_obligation_key",
      (query) =>
        query.eq("ingestionObligationKey", obligation.ingestionObligationKey),
    );
    if (intent === null || !providerIntentMatchesObligation(intent, obligation))
      return yield* conflict(
        "page_conflict",
        "The obligation does not own one exact provider target-resolution intent.",
      );
    return intent;
  });

const enqueueJobForObligationEffect = (
  obligation: StoredObligation,
  intent: StoredProviderTargetIntent,
  now: number,
): Effect.Effect<
  string | null,
  never,
  DatabaseReader | DatabaseWriter | Scheduler
> =>
  Effect.gen(function* () {
    if (obligation.publicationJobKeys.length > 1) return null;
    const priorJobKey = obligation.publicationJobKeys[0];
    if (priorJobKey !== undefined) {
      const prior = yield* publicationJobByKey(priorJobKey);
      if (prior === null || !publicationJobMatchesObligation(prior, obligation))
        return null;
      if (prior.status === "pending" || prior.status === "retry_wait")
        return prior.jobKey;
      if (prior.status === "succeeded") return prior.jobKey;
      if (prior.status === "dead_letter")
        return yield* enqueueAttributedPublicationRepairEffect({
          jobKey: prior.jobKey,
          now,
        });
      return null;
    }
    const jobKey = yield* enqueueRetrievalPublicationJobEffect(
      {
        organizationKey: obligation.organizationKey,
        workspaceId: obligation.workspaceId as GenericId<"workspaces">,
        brainKey: obligation.brainKey,
        originKind: obligation.originKind,
        effectClass: "direct_publication",
        operation: "publish",
        sourceKey: obligation.originKey,
        sourceRevisionKey: obligation.originRevisionKey,
        ingestionObligationKey: obligation.ingestionObligationKey,
        providerTargetResolutionIntentId:
          intent._id as GenericId<"providerTargetResolutionIntents">,
        providerTargetResolutionGeneration: intent.resolutionGeneration,
        requestGeneration: obligation.runGeneration,
      },
      now,
    );
    const job = yield* publicationJobByKey(jobKey);
    if (job?.status === "dead_letter")
      return yield* enqueueAttributedPublicationRepairEffect({ jobKey, now });
    return jobKey;
  });

const progressObservationObligationEffect = (
  stored: StoredObligation,
  now: number,
): Effect.Effect<
  "progressed" | "complete" | "policy_excluded" | "failed" | "waiting",
  ProviderReconciliationConflict,
  DatabaseReader | DatabaseWriter | Scheduler
> =>
  Effect.gen(function* () {
    let obligation = stored;
    if (
      obligation.state === "captured" ||
      obligation.state === "normalization_pending"
    ) {
      const normalized = yield* observationProgressStatusEffect(
        obligation,
        false,
      );
      if (normalized.kind !== "eligible") {
        const nextState =
          normalized.kind === "policy_excluded"
            ? ("policy_excluded" as const)
            : ("failed" as const);
        yield* transitionStoredObligationEffect(obligation, nextState, {
          errorTag: normalized.errorTag,
          now,
        });
        return normalized.kind;
      }
      obligation = yield* transitionStoredObligationEffect(
        obligation,
        "target_resolution_pending",
        { errorTag: null, now },
      );
    }

    if (obligation.state === "target_resolution_pending") {
      const resolved = yield* observationProgressStatusEffect(obligation, true);
      const intent = yield* providerIntentForObligationEffect(obligation);
      if (resolved.kind !== "eligible") {
        const nextState =
          resolved.kind === "policy_excluded"
            ? ("policy_excluded" as const)
            : ("failed" as const);
        yield* patchRow("providerTargetResolutionIntents", intent._id, {
          status:
            resolved.kind === "policy_excluded"
              ? "policy_excluded"
              : "integrity_failure",
          attemptCount: intent.attemptCount + 1,
          nextAttemptAt: now,
          lastErrorTag: resolved.errorTag,
          targetCount: 0,
          targetDigest:
            resolved.kind === "policy_excluded"
              ? providerTargetResolutionPopulationDigest([])
              : null,
          targets: [],
          completedAt: resolved.kind === "policy_excluded" ? now : null,
          updatedAt: now,
        });
        yield* transitionStoredObligationEffect(obligation, nextState, {
          targetResolutionIntentKey: intent.targetResolutionIntentKey,
          errorTag: resolved.errorTag,
          now,
        });
        return resolved.kind;
      }
      const jobKey = yield* enqueueJobForObligationEffect(
        obligation,
        intent,
        now,
      );
      if (jobKey === null) {
        yield* patchRow("providerTargetResolutionIntents", intent._id, {
          status: "integrity_failure",
          attemptCount: intent.attemptCount + 1,
          nextAttemptAt: now,
          lastErrorTag: "PublicationJobObligationLinkageInvalid",
          targetCount: 0,
          targetDigest: null,
          targets: [],
          completedAt: null,
          updatedAt: now,
        });
        yield* transitionStoredObligationEffect(obligation, "failed", {
          targetResolutionIntentKey: intent.targetResolutionIntentKey,
          errorTag: "PublicationJobObligationLinkageInvalid",
          now,
        });
        return "failed";
      }
      const job = yield* publicationJobByKey(jobKey);
      if (
        job === null ||
        job.authorityDigest === undefined ||
        !publicationJobMatchesObligation(job, obligation)
      ) {
        yield* transitionStoredObligationEffect(obligation, "failed", {
          targetResolutionIntentKey: intent.targetResolutionIntentKey,
          errorTag: "PublicationJobObligationLinkageInvalid",
          now,
        });
        return "failed";
      }
      const expectedTarget = {
        workspaceId: String(obligation.workspaceId),
        brainKey: obligation.brainKey,
        jobKey,
        authorityDigest: job.authorityDigest,
      } satisfies ProviderTargetResolutionTarget;
      const intentJobs = yield* queryRows<StoredPublicationJob>(
        "retrievalPublicationJobs",
        "by_provider_target_resolution_intent_job",
        (query) => query.eq("providerTargetResolutionIntentId", intent._id),
        101,
      );
      const lineageValid = publicationLineageMatchesResolution(
        intentJobs,
        job,
        obligation,
        intent,
      );
      const intentChildren =
        lineageValid && job.authorityDigest !== undefined
          ? [
              {
                workspaceId: String(job.workspaceId),
                brainKey: job.brainKey,
                jobKey: job.jobKey,
                authorityDigest: job.authorityDigest,
                targetResolutionIntentKey: intent.targetResolutionIntentKey,
                parentIngestionObligationKey: obligation.ingestionObligationKey,
                resolutionGeneration: intent.resolutionGeneration,
              },
            ]
          : [];
      const population = yield* Effect.either(
        validateProviderTargetResolutionPopulation({
          authority: providerIntentAuthorityOf(intent),
          expectedTargets: [expectedTarget],
          existingChildren: intentChildren,
          maxTargets: 100,
        }),
      );
      if (
        !lineageValid ||
        population._tag === "Left" ||
        population.right.kind !== "already_complete"
      ) {
        yield* patchRow("providerTargetResolutionIntents", intent._id, {
          status: "integrity_failure",
          attemptCount: intent.attemptCount + 1,
          nextAttemptAt: now,
          lastErrorTag: "ProviderTargetPopulationMismatch",
          targetCount: 0,
          targetDigest: null,
          targets: [],
          completedAt: null,
          updatedAt: now,
        });
        yield* transitionStoredObligationEffect(obligation, "failed", {
          targetResolutionIntentKey: intent.targetResolutionIntentKey,
          errorTag: "ProviderTargetPopulationMismatch",
          now,
        });
        return "failed";
      }
      yield* patchRow("providerTargetResolutionIntents", intent._id, {
        status: "succeeded",
        attemptCount: intent.attemptCount + 1,
        nextAttemptAt: now,
        lastErrorTag: null,
        targetCount: population.right.targetCount,
        targetDigest: population.right.targetDigest,
        targets: population.right.targets,
        completedAt: now,
        updatedAt: now,
      });
      if (job.status === "succeeded") {
        yield* transitionStoredObligationEffect(
          obligation,
          "publication_pending",
          {
            targetResolutionIntentKey: intent.targetResolutionIntentKey,
            publicationJobKeys: [jobKey],
            errorTag: null,
            now,
          },
        ).pipe(
          Effect.flatMap((pending) =>
            transitionStoredObligationEffect(pending, "complete", {
              errorTag: null,
              now,
            }),
          ),
        );
        return "complete";
      }
      yield* transitionStoredObligationEffect(
        obligation,
        "publication_pending",
        {
          targetResolutionIntentKey: intent.targetResolutionIntentKey,
          publicationJobKeys: [jobKey],
          errorTag: null,
          now,
        },
      );
      return "progressed";
    }

    if (obligation.state !== "publication_pending") return "waiting";
    const jobKey = obligation.publicationJobKeys[0];
    if (obligation.publicationJobKeys.length !== 1 || jobKey === undefined) {
      yield* transitionStoredObligationEffect(obligation, "failed", {
        errorTag: "PublicationJobObligationLinkageInvalid",
        now,
      });
      return "failed";
    }
    const jobs = yield* queryRows<StoredPublicationJob>(
      "retrievalPublicationJobs",
      "by_ingestion_obligation_job",
      (query) =>
        query
          .eq("ingestionObligationKey", obligation.ingestionObligationKey)
          .eq("jobKey", jobKey),
      2,
    );
    const job = jobs[0];
    const intent = yield* providerIntentForObligationEffect(obligation);
    const expectedTarget =
      job?.authorityDigest === undefined
        ? null
        : {
            workspaceId: String(job.workspaceId),
            brainKey: job.brainKey,
            jobKey: job.jobKey,
            authorityDigest: job.authorityDigest,
          };
    if (
      jobs.length !== 1 ||
      job === undefined ||
      expectedTarget === null ||
      !publicationJobMatchesObligation(job, obligation) ||
      intent.status !== "succeeded" ||
      intent.targetCount !== 1 ||
      intent.targets.length !== 1 ||
      intent.targets[0]?.workspaceId !== expectedTarget.workspaceId ||
      intent.targets[0]?.brainKey !== expectedTarget.brainKey ||
      intent.targets[0]?.jobKey !== expectedTarget.jobKey ||
      intent.targets[0]?.authorityDigest !== expectedTarget.authorityDigest ||
      intent.targetDigest !==
        providerTargetResolutionPopulationDigest([expectedTarget])
    ) {
      yield* transitionStoredObligationEffect(obligation, "failed", {
        errorTag: "PublicationJobObligationLinkageInvalid",
        now,
      });
      return "failed";
    }
    if (job.status === "succeeded") {
      yield* transitionStoredObligationEffect(obligation, "complete", {
        errorTag: null,
        now,
      });
      return "complete";
    }
    if (job.status === "pending" || job.status === "retry_wait") {
      yield* patchRow("ingestionObligations", obligation._id, {
        updatedAt: now,
      });
      return "waiting";
    }
    yield* transitionStoredObligationEffect(obligation, "failed", {
      errorTag: `PublicationJob${job.status}`,
      now,
    });
    return "failed";
  });

const progressRemovalObligationEffect = (
  obligation: StoredObligation,
  now: number,
): Effect.Effect<
  "progressed" | "complete" | "failed",
  never,
  DatabaseReader | DatabaseWriter | MutationCtx | Scheduler
> =>
  Effect.gen(function* () {
    if (obligation.state === "removal_pending") {
      const retired = yield* Effect.either(
        retireRemovalLifecycle(obligation, now),
      );
      if (retired._tag === "Left") {
        yield* transitionStoredObligationEffect(obligation, "failed", {
          errorTag: retired.left._tag,
          now,
        }).pipe(Effect.orDie);
        return "failed";
      }
      const pending = yield* transitionStoredObligationEffect(
        obligation,
        "drain_pending",
        { errorTag: null, now },
      ).pipe(Effect.orDie);
      const run = yield* requireRun(obligation.reconciliationRunKey).pipe(
        Effect.orDie,
      );
      yield* patchRow("connectorReconciliationRuns", run._id, {
        removalBacklogCount: Math.max(0, run.removalBacklogCount - 1),
        drainBacklogCount: run.drainBacklogCount + 1,
        updatedAt: now,
      });
      void pending;
      return "progressed";
    }
    if (obligation.state !== "drain_pending") return "failed";
    const drained = yield* Effect.either(
      drainRemovalPublication(obligation, now),
    );
    if (drained._tag === "Left") {
      yield* transitionStoredObligationEffect(obligation, "failed", {
        errorTag: drained.left._tag,
        now,
      }).pipe(Effect.orDie);
      return "failed";
    }
    yield* transitionStoredObligationEffect(obligation, "complete", {
      errorTag: null,
      now,
    }).pipe(Effect.orDie);
    const run = yield* requireRun(obligation.reconciliationRunKey).pipe(
      Effect.orDie,
    );
    yield* patchRow("connectorReconciliationRuns", run._id, {
      drainBacklogCount: Math.max(0, run.drainBacklogCount - 1),
      drainedCount: run.drainedCount + 1,
      updatedAt: now,
    });
    return "complete";
  });

type CompletionRunRef = Readonly<{
  readonly reconciliationRunKey: string;
  readonly expectedRunGeneration: number;
  readonly expectedConnectionGeneration: number;
  readonly expectedAllowlistGeneration: number;
  readonly now: number;
}>;

type LeasedCompletionRunRef = CompletionRunRef &
  Readonly<{
    readonly expectedLeaseGeneration: number;
    readonly leaseId: string;
  }>;

const completeReconciliationRunEffectWith = (
  input: CompletionRunRef,
  assertCurrentRun: (
    run: StoredRun,
  ) => Effect.Effect<void, ProviderReconciliationConflict>,
) =>
  Effect.gen(function* () {
    const run = yield* requireRun(input.reconciliationRunKey);
    yield* assertCurrentRun(run);
    const latest = yield* latestRunForScope(run.connectorScopeKey);
    if (
      latest?.reconciliationRunKey === run.reconciliationRunKey &&
      run.status === "complete" &&
      run.completionReceipt !== null
    )
      return {
        reconciliationRunKey: run.reconciliationRunKey,
        status: "complete" as const,
        receiptDigest: run.completionReceipt.receiptDigest,
        successfulObligationCount:
          run.completionReceipt.successfulObligationCount,
      };
    const blockingRows = yield* Effect.all(
      blockingIngestionObligationStates.map((state) =>
        queryRows<StoredObligation>(
          "ingestionObligations",
          "by_scope_tuple_state_ledger",
          (query) =>
            query
              .eq("connectorScopeKey", run.connectorScopeKey)
              .eq("connectionGeneration", run.connectionGeneration)
              .eq("allowlistGeneration", run.allowlistGeneration)
              .eq("state", state)
              .lte("ledgerSequence", run.ledgerHighWater),
          1,
        ),
      ),
    );
    const blockingStates = blockingRows.flatMap((rows) =>
      rows.map(({ state }) => state),
    );
    const expectedObligationCount =
      run.obligationCount + run.removalRequiredCount;
    const successfulRows = yield* Effect.all(
      (["complete", "policy_excluded"] as const).map((state) =>
        queryRows<StoredObligation>(
          "ingestionObligations",
          "by_run_state_ledger_sequence",
          (query) =>
            query
              .eq("reconciliationRunKey", run.reconciliationRunKey)
              .eq("state", state)
              .lte("ledgerSequence", run.ledgerHighWater),
          expectedObligationCount + 1,
        ),
      ),
    );
    const successfulObligations = successfulRows.flat();
    if (
      blockingStates.length === 0 &&
      (successfulObligations.length !== expectedObligationCount ||
        new Set(
          successfulObligations.map(
            ({ ingestionObligationKey }) => ingestionObligationKey,
          ),
        ).size !== expectedObligationCount)
    )
      return yield* conflict(
        "obligation_blocked",
        "The run counters do not match its exact terminal obligation census.",
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
        successfulObligationCount: successfulObligations.length,
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
  });

const completeReconciliationRunEffect = (input: LeasedCompletionRunRef) =>
  completeReconciliationRunEffectWith(input, (run) =>
    assertLeasedRunRef({ run, ...input }),
  );

const completeReconciliationRunTrustedEffect = (input: CompletionRunRef) =>
  completeReconciliationRunEffectWith(input, (run) =>
    assertRunRef({ run, ...input }),
  );

const completeReconciliationRun = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "completeReconciliationRun",
  completeReconciliationRunEffect,
);

type MaybeCompletionResult = {
  readonly reconciliationRunKey: string;
  readonly status: "complete" | "pending" | "superseded";
  readonly receiptDigest: string | null;
};

const maybeCompleteReconciliationRunEffect = (input: LeasedCompletionRunRef) =>
  completeReconciliationRunEffect(input).pipe(
    Effect.map((completed): MaybeCompletionResult => ({
      reconciliationRunKey: completed.reconciliationRunKey,
      status: "complete",
      receiptDigest: completed.receiptDigest,
    })),
    Effect.catchTag("ProviderReconciliationConflict", (error) => {
      if (
        error.reason === "run_superseded" ||
        error.reason === "scope_tuple_changed"
      )
        return Effect.gen(function* () {
          const run = yield* requireRun(input.reconciliationRunKey);
          if (run.status !== "complete" && run.status !== "superseded")
            yield* patchRow("connectorReconciliationRuns", run._id, {
              status: "superseded",
              updatedAt: input.now,
            });
          return {
            reconciliationRunKey: input.reconciliationRunKey,
            status: "superseded" as const,
            receiptDigest: null,
          } satisfies MaybeCompletionResult;
        });
      if (
        error.reason === "drain_incomplete" ||
        error.reason === "obligation_blocked" ||
        error.reason === "required_intent_stale" ||
        error.reason === "phase_conflict" ||
        error.reason === "removal_incomplete" ||
        error.reason === "traversal_incomplete"
      )
        return Effect.succeed<MaybeCompletionResult>({
          reconciliationRunKey: input.reconciliationRunKey,
          status: "pending",
          receiptDigest: null,
        });
      return Effect.fail(error);
    }),
  );

const maybeCompleteReconciliationRun = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "maybeCompleteReconciliationRun",
  maybeCompleteReconciliationRunEffect,
);

const recoverReconciliationRuns = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "recoverReconciliationRuns",
  (input) =>
    Effect.gen(function* () {
      const limit = Math.min(input.limit, 100);
      const now = input.now ?? (yield* Clock.currentTimeMillis);
      const candidates = yield* queryRows<StoredRun>(
        "connectorReconciliationRuns",
        "by_status_updated",
        (query) => query.eq("status", "drain_derived"),
        limit + 1,
      );
      const selected = candidates.slice(0, limit);
      let completedCount = 0;
      let pendingCount = 0;
      let supersededCount = 0;
      for (const run of selected) {
        const result = yield* completeReconciliationRunTrustedEffect({
          reconciliationRunKey: run.reconciliationRunKey,
          expectedRunGeneration: run.runGeneration,
          expectedConnectionGeneration: run.connectionGeneration,
          expectedAllowlistGeneration: run.allowlistGeneration,
          now,
        }).pipe(
          Effect.map((completed): MaybeCompletionResult => ({
            reconciliationRunKey: completed.reconciliationRunKey,
            status: "complete",
            receiptDigest: completed.receiptDigest,
          })),
          Effect.catchTag("ProviderReconciliationConflict", (error) => {
            if (
              error.reason === "drain_incomplete" ||
              error.reason === "obligation_blocked" ||
              error.reason === "required_intent_stale" ||
              error.reason === "phase_conflict" ||
              error.reason === "removal_incomplete" ||
              error.reason === "traversal_incomplete"
            )
              return Effect.succeed<MaybeCompletionResult>({
                reconciliationRunKey: run.reconciliationRunKey,
                status: "pending",
                receiptDigest: null,
              });
            if (
              error.reason === "run_superseded" ||
              error.reason === "scope_tuple_changed"
            )
              return Effect.gen(function* () {
                const current = yield* requireRun(run.reconciliationRunKey);
                if (
                  current.status !== "complete" &&
                  current.status !== "superseded"
                )
                  yield* patchRow("connectorReconciliationRuns", current._id, {
                    status: "superseded",
                    updatedAt: now,
                  });
                return {
                  reconciliationRunKey: run.reconciliationRunKey,
                  status: "superseded" as const,
                  receiptDigest: null,
                } satisfies MaybeCompletionResult;
              });
            return Effect.fail(error);
          }),
        );
        if (result.status === "complete") completedCount += 1;
        else if (result.status === "superseded") supersededCount += 1;
        else {
          pendingCount += 1;
          yield* patchRow("connectorReconciliationRuns", run._id, {
            updatedAt: now,
          });
        }
      }
      return {
        selectedCount: selected.length,
        completedCount,
        pendingCount,
        supersededCount,
        hasMore: candidates.length > limit,
      };
    }),
);

const reconciliationProjectionConflict = (error: { readonly reason: string }) =>
  new ProviderReconciliationConflict({
    reason: "page_conflict" as const,
    detail: `Reconciliation projection failed: ${error.reason}.`,
  });

const loadReconciliationPage = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "loadReconciliationPage",
  (input) =>
    Effect.gen(function* () {
      const request = {
        reconciliationRunKey: input.reconciliationRunKey,
        expectedRunGeneration: input.expectedRunGeneration,
        expectedConnectionGeneration: input.expectedConnectionGeneration,
        expectedAllowlistGeneration: input.expectedAllowlistGeneration,
        cursorKey: input.cursorKey,
        expectedCursor: input.expectedCursor,
        expectedCursorGeneration: input.expectedCursorGeneration,
      };
      if (input.sourceKind === "google_drive") {
        const page = yield* runWithDriveReader(
          loadPersistedDriveReconciliationPage(request),
        ).pipe(Effect.mapError(reconciliationProjectionConflict));
        return page === null
          ? null
          : {
              kind: "google_drive" as const,
              pageEnvelopeKey: page.pageEnvelopeKey,
              pageDigest: page.pageDigest,
              ledgerHighWater: page.ledgerHighWater,
              chunks: page.chunks,
              preparedDrivePage: page.preparedDrivePage,
            };
      }
      const page = yield* loadPersistedSourceReconciliationPage({
        ...request,
        sourceChunk: input.sourceKind,
      }).pipe(Effect.mapError(reconciliationProjectionConflict));
      if (page === null) return null;
      return page.sourceChunk === "slack"
        ? {
            kind: "slack" as const,
            pageEnvelopeKey: page.pageEnvelopeKey,
            pageDigest: page.pageDigest,
            ledgerHighWater: page.ledgerHighWater,
            chunks: page.chunks,
            preparedSlackPage: page.preparedPage,
          }
        : {
            kind: "transcript" as const,
            pageEnvelopeKey: page.pageEnvelopeKey,
            pageDigest: page.pageDigest,
            ledgerHighWater: page.ledgerHighWater,
            chunks: page.chunks,
            preparedTranscriptPage: page.preparedPage,
          };
    }),
);

const getDriveExpectedIncarnation = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "getDriveExpectedIncarnation",
  (input) =>
    Effect.gen(function* () {
      const rows = yield* queryRows<
        StoredDocument & { readonly incarnation: number }
      >(
        "documentSourceObjects",
        "by_organization_provider_object",
        (query) =>
          query
            .eq("organizationKey", input.organizationKey)
            .eq("providerKey", "google_drive")
            .eq("providerObjectKey", input.providerObjectKey),
        2,
      );
      if (rows.length > 1)
        return yield* conflict(
          "page_conflict",
          "Drive object identity is not unique.",
        );
      return rows[0]?.incarnation ?? null;
    }),
);

const listReconciliationRemovalCandidates = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "listReconciliationRemovalCandidates",
  (input) => {
    const effect =
      input.sourceKind === "slack"
        ? listSlackReconciliationRemovalCandidates({
            organizationKey: input.organizationKey,
            connectorScopeKey: input.connectorScopeKey,
            connectionKey: input.connectionKey,
            connectionGeneration: input.connectionGeneration,
            afterSourceKey: input.cursor,
            limit: input.limit,
          })
        : input.sourceKind === "transcript"
          ? listTranscriptReconciliationRemovalCandidates({
              organizationKey: input.organizationKey,
              connectorScopeKey: input.connectorScopeKey,
              connectionKey: input.connectionKey,
              connectionGeneration: input.connectionGeneration,
              afterUnitKey: input.cursor,
              limit: input.limit,
            })
          : runWithDriveReader(
              listDriveReconciliationRemovalCandidates({
                organizationKey: input.organizationKey,
                connectorScopeKey: input.connectorScopeKey,
                connectionGeneration: input.connectionGeneration,
                allowlistGeneration: input.allowlistGeneration,
                afterDocumentObjectKey: input.cursor,
                limit: input.limit,
              }),
            );
    return effect.pipe(Effect.mapError(reconciliationProjectionConflict));
  },
);

const sweepIngestionObligationRepairs = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "sweepIngestionObligationRepairs",
  (input) =>
    Effect.gen(function* () {
      const limit = Math.min(input.limit, 100);
      const now = input.now ?? (yield* Clock.currentTimeMillis);
      const ctx = yield* MutationCtx;
      const repairDatabase = rawMutationDatabase(ctx);
      const queued = (yield* Effect.promise(() =>
        repairDatabase
          .query("ingestionObligationRepairEffects")
          .withIndex("by_state_updated", (query) => query.eq("state", "queued"))
          .take(limit + 1),
      )) as readonly StoredRepairEffect[];
      const selected = queued.slice(0, limit);
      let succeededCount = 0;
      let failedCount = 0;
      for (const repair of selected) {
        const obligation = yield* obligationByKey(
          repair.ingestionObligationKey,
        );
        const current =
          obligation !== null &&
          obligation.organizationKey === repair.organizationKey &&
          String(obligation.workspaceId) === String(repair.workspaceId) &&
          obligation.brainKey === repair.brainKey &&
          obligation.connectorScopeKey === repair.scopeKey &&
          obligation.state === "retry_wait" &&
          obligation.updatedAt === repair.createdAt;
        if (!current) {
          yield* Effect.promise(() =>
            repairDatabase.patch(repair._id, {
              state: "failed",
              updatedAt: now,
            }),
          );
          failedCount += 1;
          continue;
        }
        const nextState: IngestionObligationState =
          obligation.cause === "removal"
            ? "removal_pending"
            : repair.mode === "attributed_repair"
              ? "target_resolution_pending"
              : "normalization_pending";
        yield* mapInvariant(
          transitionIngestionObligationPlan({
            current: obligation.state,
            expected: "retry_wait",
            next: nextState,
          }),
        );
        yield* patchRow("ingestionObligations", obligation._id, {
          state: nextState,
          errorTag: null,
          terminalAt: null,
          updatedAt: now,
        });
        yield* Effect.promise(() =>
          repairDatabase.patch(repair._id, {
            state: "succeeded",
            updatedAt: now,
          }),
        );
        succeededCount += 1;
      }
      return {
        selectedCount: selected.length,
        succeededCount,
        failedCount,
        hasMore: queued.length > limit,
      };
    }),
);

const getDriveScopeConfigurationForStart = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "getDriveScopeConfigurationForStart",
  (input) =>
    Effect.gen(function* () {
      const rows = yield* driveConfigurationRows(input);
      if (rows.length > 1)
        return yield* conflict(
          "page_conflict",
          "The Drive scope tuple has duplicate configuration rows.",
        );
      const row = rows[0];
      return row === undefined ? null : driveConfigurationResult(row);
    }),
);

const listRecoverableReconciliationRuns = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "listRecoverableReconciliationRuns",
  (input) =>
    Effect.gen(function* () {
      const limit = Math.min(input.limit, 100);
      const statuses = [
        "scan",
        "traversal_closed",
        "apply_removals",
        "drain_derived",
      ] as const;
      const batches = yield* Effect.all(
        statuses.map((status) =>
          queryRows<StoredRun>(
            "connectorReconciliationRuns",
            "by_status_lease_expiry",
            (query) =>
              query.eq("status", status).lte("leaseExpiresAt", input.now),
            limit + 1,
          ),
        ),
      );
      const selected = batches
        .flat()
        .sort(
          (left, right) =>
            left.leaseExpiresAt - right.leaseExpiresAt ||
            left.reconciliationRunKey.localeCompare(right.reconciliationRunKey),
        )
        .slice(0, limit);
      return {
        runs: selected.map((run) => ({
          reconciliationRunKey: run.reconciliationRunKey,
          expectedRunGeneration: run.runGeneration,
          expectedConnectionGeneration: run.connectionGeneration,
          expectedAllowlistGeneration: run.allowlistGeneration,
          expectedLeaseGeneration: run.leaseGeneration,
        })),
        hasMore:
          batches.some((batch) => batch.length > limit) ||
          batches.reduce((count, batch) => count + batch.length, 0) > limit,
      };
    }),
);

const sweepIngestionObligations = FunctionImpl.make(
  databaseSchema,
  providerReconciliation,
  "sweepIngestionObligations",
  (input) =>
    Effect.gen(function* () {
      const limit = Math.min(input.limit, 100);
      const now = input.now ?? (yield* Clock.currentTimeMillis);
      const states = [
        "captured",
        "normalization_pending",
        "target_resolution_pending",
        "publication_pending",
        "removal_pending",
        "drain_pending",
      ] as const satisfies readonly IngestionObligationState[];
      const batches = yield* Effect.all(
        states.map((state) =>
          queryRows<StoredObligation>(
            "ingestionObligations",
            "by_state_updated_obligation",
            (query) => query.eq("state", state),
            limit + 1,
          ),
        ),
      );
      const candidates = batches
        .flat()
        .sort(
          (left, right) =>
            left.updatedAt - right.updatedAt ||
            left.ingestionObligationKey.localeCompare(
              right.ingestionObligationKey,
            ),
        );
      const selected = candidates.slice(0, limit);
      const counts = {
        progressed: 0,
        complete: 0,
        policy_excluded: 0,
        failed: 0,
        waiting: 0,
      };
      for (const obligation of selected) {
        const result = yield* Effect.either(
          obligation.cause === "removal"
            ? progressRemovalObligationEffect(obligation, now)
            : progressObservationObligationEffect(obligation, now),
        );
        if (result._tag === "Left") {
          yield* patchRow("ingestionObligations", obligation._id, {
            state: "failed",
            errorTag: `ProviderReconciliationConflict:${result.left.reason}`,
            terminalAt: null,
            updatedAt: now,
          });
          counts.failed += 1;
          continue;
        }
        counts[result.right] += 1;
      }
      return {
        selectedCount: selected.length,
        progressedCount: counts.progressed,
        completedCount: counts.complete,
        policyExcludedCount: counts.policy_excluded,
        failedCount: counts.failed,
        waitingCount: counts.waiting,
        hasMore:
          candidates.length > limit ||
          batches.some((batch) => batch.length > limit),
      };
    }),
);

const providerReconciliationImpl = GroupImpl.make(
  databaseSchema,
  providerReconciliation,
).pipe(
  Layer.provide(upsertRequiredScopeIntent),
  Layer.provide(activateRequiredScope),
  Layer.provide(openReconciliationRun),
  Layer.provide(getReconciliationStartContext),
  Layer.provide(claimReconciliationStep),
  Layer.provide(upsertDriveScopeConfiguration),
  Layer.provide(getDriveScopeConfiguration),
  Layer.provide(getDriveScopeConfigurationForStart),
  Layer.provide(beginReconciliationPage),
  Layer.provide(commitReconciliationPageChunk),
  Layer.provide(finalizeReconciliationPage),
  Layer.provide(closeReconciliationTraversal),
  Layer.provide(applyReconciliationRemovalBatch),
  Layer.provide(completeReconciliationRun),
  Layer.provide(maybeCompleteReconciliationRun),
  Layer.provide(recoverReconciliationRuns),
  Layer.provide(listRecoverableReconciliationRuns),
);

export default providerReconciliationImpl.pipe(
  Layer.provide(loadReconciliationPage),
  Layer.provide(getDriveExpectedIncarnation),
  Layer.provide(listReconciliationRemovalCandidates),
  Layer.provide(sweepIngestionObligationRepairs),
  Layer.provide(sweepIngestionObligations),
  GroupImpl.finalize,
);
