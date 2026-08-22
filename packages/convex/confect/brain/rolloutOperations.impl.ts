import {
  DataModel,
  type DatabaseSchema,
  FunctionImpl,
  GroupImpl,
} from "@confect/server";
import type { GenericDatabaseWriter } from "convex/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";

import type {
  RetrievalPublicationJobsDoc,
  RetrievalPublicationSetsDoc,
  RetrievalPublicationSubjectsDoc,
  RetrievalTokensDoc,
} from "../_generated/docs";
import databaseSchema from "../_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationCtx,
  QueryCtx,
} from "../_generated/services";
import { sha256Hex } from "../shared/sha256";
import type brainProjectionPopulationSource from "../tables/brainProjectionPopulation";
import type brainProjectionValidationReceiptsSource from "../tables/brainProjectionValidationReceipts";
import type brainOperationReceiptsSource from "../tables/brainOperationReceipts";
import type brainPublicationPausesSource from "../tables/brainPublicationPauses";
import type brainPublicationWorkerLeasesSource from "../tables/brainPublicationWorkerLeases";
import type connectorAllowlistGenerationsSource from "../tables/connectorAllowlistGenerations";
import type connectorScopesSource from "../tables/connectorScopes";
import type documentSourceObjectsSource from "../tables/documentSourceObjects";
import type documentSourceRevisionsSource from "../tables/documentSourceRevisions";
import type ingestionObligationRepairEffectsSource from "../tables/ingestionObligationRepairEffects";
import type retrievalPublicationSetsSource from "../tables/retrievalPublicationSets";
import { readProcessEnv } from "../shared/env";
import {
  advancePublicationIntegrityDigest,
  inspectPublicationIntegrity,
  MAX_PUBLICATION_ENTRY_ROWS,
  MAX_PUBLICATION_HISTORY_ROWS,
  MAX_PUBLICATION_TOKEN_ROWS,
  publicationOriginPresentEffect,
  publicationCitationInvalidationReceipt,
  publicationSubjectDigest,
  validatePublicationSetIntegrityEffect,
  type PublicationIntegritySet,
  type PublicationIntegritySubject,
} from "./publicationIntegrity";
import {
  connectionFenceIdentity,
  connectorAllowlistFenceIdentity,
  connectorScopeFenceIdentity,
  documentLifecycleFenceIdentity,
  ensureEligibilityFenceEffect,
  pageLifecycleFenceIdentity,
  slackPolicyFenceIdentity,
  slackSourceLifecycleFenceIdentity,
  transcriptRouteFenceIdentity,
  transcriptUnitLifecycleFenceIdentity,
  type EligibilityFenceIdentity,
} from "./retrievalEligibility";
import {
  retrievalEligibilityFenceKey,
  retrievalPublicationSubjectKey,
} from "./retrievalPublication";
import type { RetrievalEligibilityFenceRef } from "./retrievalPublication";
import {
  RETRIEVAL_TOKEN_CATALOG_POSTING_LIMIT,
  retrievalTokenCatalogIsConsistent,
  retrievalTokenCatalogProjection,
} from "./retrievalTokenCatalog";
import {
  enqueueAttributedPublicationRepairEffect,
  migrateLegacyPublicationJobEffect,
  synchronizeCurrentTokenCatalogEffect,
} from "./retrievalPublication.impl";
import {
  activePublicationLeasesEffect,
  activePublicationLeasesForMutationEffect,
  loadPublicationPauseEffect,
  loadPublicationPauseForMutationEffect,
  publicationPauseKey,
  publicationScopeKeyForJob,
} from "./publicationWorkerControl";
import {
  resumeTranscriptRevisionOrderBackfillEffect,
  startTranscriptRevisionOrderBackfillEffect,
} from "./transcriptRevisionOrderMigration";
import { evaluateBrainRolloutStatusEffect } from "./rolloutStatus.impl";
import rolloutOperations, {
  ProjectionBackfillCapacityExceeded,
  ProjectionBackfillConflict,
  ProjectionBackfillNotFound,
  BrainOperationConflict,
  ProjectionReadinessRejected,
} from "./rolloutOperations.spec";

type BrainProjectionPopulationTable = ReturnType<
  typeof brainProjectionPopulationSource<"brainProjectionPopulation">
>;
type BrainOperationReceiptsTable = ReturnType<
  typeof brainOperationReceiptsSource<"brainOperationReceipts">
>;
type BrainProjectionValidationReceiptsTable = ReturnType<
  typeof brainProjectionValidationReceiptsSource<"brainProjectionValidationReceipts">
>;
type BrainPublicationPausesTable = ReturnType<
  typeof brainPublicationPausesSource<"brainPublicationPauses">
>;
type BrainPublicationWorkerLeasesTable = ReturnType<
  typeof brainPublicationWorkerLeasesSource<"brainPublicationWorkerLeases">
>;
type ConnectorScopesTable = ReturnType<
  typeof connectorScopesSource<"connectorScopes">
>;
type ConnectorAllowlistGenerationsTable = ReturnType<
  typeof connectorAllowlistGenerationsSource<"connectorAllowlistGenerations">
>;
type DocumentSourceObjectsTable = ReturnType<
  typeof documentSourceObjectsSource<"documentSourceObjects">
>;
type DocumentSourceRevisionsTable = ReturnType<
  typeof documentSourceRevisionsSource<"documentSourceRevisions">
>;
type IngestionObligationRepairEffectsTable = ReturnType<
  typeof ingestionObligationRepairEffectsSource<"ingestionObligationRepairEffects">
>;
type RetrievalPublicationSetsTable = ReturnType<
  typeof retrievalPublicationSetsSource<"retrievalPublicationSets">
>;
type ProjectionConfectDataModel = DataModel.FromTables<
  | DatabaseSchema.Tables<typeof databaseSchema>
  | BrainProjectionPopulationTable
  | BrainProjectionValidationReceiptsTable
  | BrainOperationReceiptsTable
  | BrainPublicationPausesTable
  | BrainPublicationWorkerLeasesTable
  | ConnectorScopesTable
  | ConnectorAllowlistGenerationsTable
  | DocumentSourceObjectsTable
  | DocumentSourceRevisionsTable
  | IngestionObligationRepairEffectsTable
  | RetrievalPublicationSetsTable
>;
type ProjectionDataModel = DataModel.ToConvex<ProjectionConfectDataModel>;
type ProjectionPopulationDoc = DataModel.DocumentWithName<
  ProjectionConfectDataModel,
  "brainProjectionPopulation"
>;
type ProjectionPopulationInsert = Omit<
  ProjectionPopulationDoc,
  "_creationTime" | "_id"
>;
type ProjectionPopulationPatch = Partial<ProjectionPopulationInsert>;
type ProjectionPublicationSetDoc = DataModel.DocumentWithName<
  ProjectionConfectDataModel,
  "retrievalPublicationSets"
>;
type BrainOperationReceiptDoc = DataModel.DocumentWithName<
  ProjectionConfectDataModel,
  "brainOperationReceipts"
>;
type BrainProjectionValidationReceiptDoc = DataModel.DocumentWithName<
  ProjectionConfectDataModel,
  "brainProjectionValidationReceipts"
>;
type IngestionObligationDoc = DataModel.DocumentWithName<
  ProjectionConfectDataModel,
  "ingestionObligations"
>;
type IngestionObligationRepairEffectDoc = DataModel.DocumentWithName<
  ProjectionConfectDataModel,
  "ingestionObligationRepairEffects"
>;
type BackfillStage = NonNullable<ProjectionPopulationDoc["activeStage"]>;
type JobAuthorityMigrationStage = NonNullable<
  ProjectionPopulationDoc["jobAuthorityMigrationStage"]
>;
type RetainedPublicationSet = ProjectionPublicationSetDoc &
  RetrievalPublicationSetsDoc & {
    readonly state: "current" | "retired";
  };
type ActivePopulation = ProjectionPopulationDoc & {
  readonly activeRunKey: string;
  readonly activePhase: NonNullable<ProjectionPopulationDoc["activePhase"]>;
  readonly activeStage: BackfillStage;
  readonly activeConfigurationDigest: string;
  readonly scanHighWater: number;
  readonly validationPredecessorDigest: string | null;
};
type ActiveJobAuthorityMigration = ProjectionPopulationDoc & {
  readonly jobAuthorityMigrationRunKey: string;
  readonly jobAuthorityMigrationStage: JobAuthorityMigrationStage;
  readonly jobAuthorityMigrationConfigurationDigest: string;
  readonly jobAuthorityMigrationScanHighWater: number;
  readonly jobAuthorityMigrationPredecessorDigest: string;
};

const initialDigest = () => digest({ kind: "projection_population", rows: [] });
const initialJobAuthorityMigrationDigest = () =>
  digest({ kind: "legacy_job_authority_migration", rows: [] });
const initialEligibilityFenceDigest = () =>
  digest({ kind: "legacy_eligibility_fence_population", rows: [] });
const digest = (value: unknown): string =>
  `sha256:${sha256Hex(JSON.stringify(value))}`;
const keyedDigest = (
  prefix: "bpop" | "pbrun" | "pjam",
  value: unknown,
): string => `${prefix}_${sha256Hex(JSON.stringify(value))}`;

const rawDatabase = (ctx: Effect.Effect.Success<typeof MutationCtx>) =>
  ctx.db as unknown as GenericDatabaseWriter<ProjectionDataModel>;

type BrainOperationName = BrainOperationReceiptDoc["operation"];
type BrainOperationTargetKind = BrainOperationReceiptDoc["targetKind"];

const operationConflict = (
  operation: string,
  reason: BrainOperationConflict["reason"],
  detail: string,
) => new BrainOperationConflict({ operation, reason, detail });

const operationReceiptKey = (input: {
  readonly organizationKey: string;
  readonly operationKey: string;
  readonly operation: BrainOperationName;
}): string =>
  `bopr_${sha256Hex(
    JSON.stringify({
      organizationKey: input.organizationKey,
      operationKey: input.operationKey,
      operation: input.operation,
    }),
  )}`;

const loadOperationReceiptEffect = (
  organizationKey: string,
  operationKey: string,
) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const rows = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("brainOperationReceipts")
        .withIndex("by_operation_key", (query) =>
          query
            .eq("organizationKey", organizationKey)
            .eq("operationKey", operationKey),
        )
        .take(2),
    );
    if (rows.length > 1)
      return yield* operationConflict(
        "brain_operation",
        "integrity_conflict",
        "More than one immutable receipt owns the operation key.",
      );
    return rows[0] ?? null;
  });

const assertReceiptIdentity = (
  receipt: BrainOperationReceiptDoc,
  input: {
    readonly operation: BrainOperationName;
    readonly workspaceId: GenericId<"workspaces">;
    readonly brainKey: string;
    readonly scopeKey: string;
    readonly targetKind: BrainOperationTargetKind;
    readonly targetKey: string;
  },
) =>
  receipt.operation !== input.operation ||
  receipt.workspaceId !== input.workspaceId ||
  receipt.brainKey !== input.brainKey ||
  receipt.scopeKey !== input.scopeKey ||
  receipt.targetKind !== input.targetKind ||
  receipt.targetKey !== input.targetKey
    ? operationConflict(
        input.operation,
        "scope_mismatch",
        "The operation key is already bound to a different scoped target.",
      )
    : null;

const insertOperationReceiptEffect = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly scopeKey: string;
  readonly operationKey: string;
  readonly operation: BrainOperationName;
  readonly targetKind: BrainOperationTargetKind;
  readonly targetKey: string;
  readonly expectedGeneration: number | null;
  readonly resultGeneration: number | null;
  readonly controllingConfigurationDigest?: string | undefined;
  readonly priorState: string;
  readonly resultState: string;
  readonly repairMode?: "retry" | "attributed_repair" | undefined;
  readonly reason: string;
  readonly approvedBy?: string | undefined;
  readonly linkedEffectKey: string | null;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const receiptKey = operationReceiptKey(input);
    yield* Effect.promise(() =>
      rawDatabase(ctx).insert("brainOperationReceipts", {
        schemaVersion: 1,
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        scopeKey: input.scopeKey,
        operationKey: input.operationKey,
        receiptKey,
        operation: input.operation,
        targetKind: input.targetKind,
        targetKey: input.targetKey,
        expectedGeneration: input.expectedGeneration,
        resultGeneration: input.resultGeneration,
        controllingConfigurationDigest:
          input.controllingConfigurationDigest ?? null,
        priorState: input.priorState,
        resultState: input.resultState,
        repairMode: input.repairMode ?? null,
        reason: input.reason,
        approvedBy: input.approvedBy ?? null,
        linkedEffectKey: input.linkedEffectKey,
        createdAt: input.now,
      }),
    );
    return receiptKey;
  });

const exactScope = (
  row: {
    readonly organizationKey: string;
    readonly workspaceId?: GenericId<"workspaces"> | undefined;
    readonly brainKey?: string | undefined;
  },
  input: {
    readonly organizationKey: string;
    readonly workspaceId: GenericId<"workspaces">;
    readonly brainKey: string;
  },
) =>
  row.organizationKey === input.organizationKey &&
  row.workspaceId === input.workspaceId &&
  row.brainKey === input.brainKey;

const existingTargetOperationReceiptEffect = (input: {
  readonly targetKind: BrainOperationTargetKind;
  readonly targetKey: string;
  readonly operation: BrainOperationName;
  readonly expectedGeneration: number | null;
}) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const rows = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("brainOperationReceipts")
        .withIndex("by_target_operation_generation", (query) =>
          query
            .eq("targetKind", input.targetKind)
            .eq("targetKey", input.targetKey)
            .eq("operation", input.operation)
            .eq("expectedGeneration", input.expectedGeneration),
        )
        .take(2),
    );
    if (rows.length > 1)
      return yield* operationConflict(
        input.operation,
        "integrity_conflict",
        "Multiple immutable operation receipts resolve the same failed effect.",
      );
    return rows[0] ?? null;
  });

const loadPopulationEffect = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
}) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const rows = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("brainProjectionPopulation")
        .withIndex("by_workspace_brain", (query) =>
          query
            .eq("workspaceId", input.workspaceId)
            .eq("brainKey", input.brainKey),
        )
        .take(2),
    );
    if (rows.length > 1)
      return yield* new ProjectionBackfillConflict({
        reason: "integrity_conflict",
        detail: "More than one projection population row exists for the Brain.",
      });
    return rows[0] ?? null;
  });

const loadPopulationByRunEffect = (runKey: string) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const rows = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("brainProjectionPopulation")
        .withIndex("by_active_run_key", (query) =>
          query.eq("activeRunKey", runKey),
        )
        .take(2),
    );
    if (rows.length > 1)
      return yield* new ProjectionBackfillConflict({
        reason: "integrity_conflict",
        detail: "More than one projection population row owns the run key.",
      });
    return rows[0] ?? null;
  });

const loadPopulationByJobAuthorityMigrationRunEffect = (runKey: string) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const rows = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("brainProjectionPopulation")
        .withIndex("by_job_authority_migration_run_key", (query) =>
          query.eq("jobAuthorityMigrationRunKey", runKey),
        )
        .take(2),
    );
    if (rows.length > 1)
      return yield* new ProjectionBackfillConflict({
        reason: "integrity_conflict",
        detail:
          "More than one projection population row owns the legacy job-authority migration run key.",
      });
    return rows[0] ?? null;
  });

const insertPopulationEffect = (row: ProjectionPopulationInsert) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const id = yield* Effect.promise(() =>
      rawDatabase(ctx).insert("brainProjectionPopulation", row),
    );
    return { ...row, _id: id, _creationTime: row.createdAt } as const;
  });

const patchPopulationEffect = (
  row: ProjectionPopulationDoc,
  patch: ProjectionPopulationPatch,
) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    yield* Effect.promise(() => rawDatabase(ctx).patch(row._id, patch));
    return { ...row, ...patch } as ProjectionPopulationDoc;
  });

const activePopulation = (
  row: ProjectionPopulationDoc,
): ActivePopulation | null =>
  row.activeRunKey !== null &&
  row.activePhase !== null &&
  row.activeStage !== null &&
  row.activeConfigurationDigest !== null &&
  row.scanHighWater !== null
    ? (row as ActivePopulation)
    : null;

const activeJobAuthorityMigration = (
  row: ProjectionPopulationDoc,
): ActiveJobAuthorityMigration | null =>
  row.jobAuthorityMigrationRunKey !== null &&
  row.jobAuthorityMigrationStage !== null &&
  row.jobAuthorityMigrationConfigurationDigest !== null &&
  row.jobAuthorityMigrationScanHighWater !== null &&
  row.jobAuthorityMigrationPredecessorDigest !== null
    ? (row as ActiveJobAuthorityMigration)
    : null;

const progressFrom = (row: ActivePopulation, processed = 0) => ({
  runKey: row.activeRunKey,
  runGeneration: row.activeRunGeneration,
  phase: row.activePhase,
  stage: row.activeStage,
  cursor: row.activeCursor,
  projectionPopulationGeneration: row.projectionPopulationGeneration,
  subjectBackfillGeneration: row.subjectBackfillGeneration,
  fenceBackfillGeneration: row.fenceBackfillGeneration,
  processed,
  backfilled: row.backfilledSetCount,
  validated: row.validatedSetCount + row.validatedSubjectCount,
  conflictCount:
    row.activePhase === "eligibility_fences"
      ? row.fenceConflictCount
      : row.conflictCount,
  capacityCount: row.capacityCount,
  validationRestartCount: row.validationRestartCount,
  current: row.currentFenceSetCount,
  retired: row.retiredFenceSetCount,
  fenceBackfilled: row.fenceBackfilledSetCount,
  invalidated: row.invalidatedFenceSetCount,
  terminal:
    row.activeStage === "complete" ||
    row.activeStage === "blocked" ||
    row.activeStage === "superseded",
  legacyCompletionDigest:
    row.legacySubjectBackfillCompletion?.completionDigest ?? null,
  fenceCompletionDigest:
    row.legacyEligibilityFenceBackfillCompletion?.completionDigest ?? null,
});

const jobAuthorityMigrationProgressFrom = (
  row: ActiveJobAuthorityMigration,
) => ({
  runKey: row.jobAuthorityMigrationRunKey,
  runGeneration: row.jobAuthorityMigrationRunGeneration,
  stage: row.jobAuthorityMigrationStage,
  cursor: row.jobAuthorityMigrationCursor,
  projectionPopulationGeneration: row.projectionPopulationGeneration,
  processed: row.jobAuthorityMigrationProcessedCount,
  replaced: row.jobAuthorityMigrationReplacementCount,
  completeAuthority: row.jobAuthorityMigrationCompleteAuthorityCount,
  terminalHistory: row.jobAuthorityMigrationTerminalHistoryCount,
  conflictCount: row.jobAuthorityMigrationConflictCount,
  terminal:
    row.jobAuthorityMigrationStage === "complete" ||
    row.jobAuthorityMigrationStage === "blocked",
  completionDigest:
    row.legacyJobAuthorityMigrationCompletion?.completionDigest ?? null,
});

const sameOptional = <Value>(
  left: Value | undefined,
  right: Value | undefined,
) => (left ?? null) === (right ?? null);

const isRetainedPublicationSet = (
  set: RetrievalPublicationSetsDoc,
): set is RetainedPublicationSet =>
  set.state === "current" || set.state === "retired";

const setMatchesScope = (
  row: RetrievalPublicationSetsDoc,
  population: ActivePopulation,
) =>
  (population.activeCorpusKey === null ||
    row.corpusKey === population.activeCorpusKey) &&
  (population.activeConnectorScopeKey === null ||
    row.connectorScopeKey === population.activeConnectorScopeKey);

const canonicalFenceRefs = (
  refs: readonly RetrievalEligibilityFenceRef[],
): readonly RetrievalEligibilityFenceRef[] =>
  [...refs].sort((left, right) =>
    left.kind === right.kind
      ? left.fenceKey.localeCompare(right.fenceKey)
      : left.kind.localeCompare(right.kind),
  );

const sameFenceManifest = (
  left: readonly RetrievalEligibilityFenceRef[],
  right: readonly RetrievalEligibilityFenceRef[],
): boolean => {
  const canonicalLeft = canonicalFenceRefs(left);
  const canonicalRight = canonicalFenceRefs(right);
  return (
    canonicalLeft.length === canonicalRight.length &&
    canonicalLeft.every(
      (ref, index) =>
        ref.kind === canonicalRight[index]?.kind &&
        ref.fenceKey === canonicalRight[index]?.fenceKey &&
        ref.eligibilityGeneration ===
          canonicalRight[index]?.eligibilityGeneration,
    )
  );
};

const hasValidCitationInvalidationReceipt = (
  set: RetainedPublicationSet,
): boolean => {
  const receipt = set.citationInvalidationReceipt;
  if (set.state !== "retired" || receipt === undefined) return false;
  const expected = publicationCitationInvalidationReceipt({
    organizationKey: set.organizationKey,
    workspaceId: String(set.workspaceId),
    brainKey: set.brainKey,
    publicationSetKey: set.publicationSetKey,
    reason: receipt.reason,
    invalidatedAt: receipt.invalidatedAt,
  });
  return (
    receipt.receiptKey === expected.receiptKey &&
    receipt.receiptDigest === expected.receiptDigest
  );
};

const resolveFenceIdentitiesEffect = (
  rows: readonly {
    readonly identity: EligibilityFenceIdentity;
    readonly eligible: boolean;
  }[],
  now: number,
  createMissing = true,
) =>
  Effect.gen(function* () {
    if (
      rows.length === 0 ||
      rows.length > 6 ||
      new Set(rows.map(({ identity }) => identity.kind)).size !== rows.length ||
      new Set(rows.map(({ identity }) => identity.controllerKey)).size !==
        rows.length
    )
      return { kind: "conflict" as const, reason: "manifest_matrix_invalid" };
    const reader = yield* DatabaseReader;
    const storedRows = yield* Effect.all(
      rows.map(({ identity }) =>
        reader
          .table("retrievalEligibilityFences")
          .index("by_organization_fence", (query) =>
            query
              .eq("organizationKey", identity.organizationKey)
              .eq("fenceKey", retrievalEligibilityFenceKey(identity)),
          )
          .take(2)
          .pipe(Effect.orDie),
      ),
    );
    if (
      storedRows.some((matches, index) => {
        const expected = rows[index]?.identity;
        const stored = matches[0];
        return (
          expected === undefined ||
          matches.length > 1 ||
          (stored !== undefined &&
            (stored.kind !== expected.kind ||
              stored.controllerKey !== expected.controllerKey))
        );
      })
    )
      return {
        kind: "conflict" as const,
        reason: "fence_controller_collision",
      };
    const resolved = createMissing
      ? yield* Effect.all(
          rows.map(({ identity, eligible }) =>
            ensureEligibilityFenceEffect({ identity, eligible, now }),
          ),
        )
      : storedRows.map((matches, index) => {
          const stored = matches[0];
          const expected = rows[index];
          return stored === undefined || expected === undefined
            ? null
            : {
                ref: {
                  kind: stored.kind,
                  fenceKey: stored.fenceKey,
                  eligibilityGeneration: stored.eligibilityGeneration,
                },
                eligible:
                  stored.eligible && stored.eligible === expected.eligible,
              };
        });
    const complete: Array<{
      readonly ref: RetrievalEligibilityFenceRef;
      readonly eligible: boolean;
    }> = [];
    for (const state of resolved) if (state !== null) complete.push(state);
    if (
      complete.length !== rows.length ||
      complete.some((state) => state.eligible === false)
    )
      return {
        kind: "conflict" as const,
        reason: "fence_missing_or_ineligible",
      };
    const refs = canonicalFenceRefs(complete.map(({ ref }) => ref));
    return {
      kind: "resolved" as const,
      refs,
      digest: digest({
        controllers: rows
          .map(({ identity, eligible }) => ({ ...identity, eligible }))
          .sort((left, right) =>
            left.controllerKey.localeCompare(right.controllerKey),
          ),
        refs,
      }),
    };
  });

const resolveRequiredEligibilityManifestEffect = (
  set: RetainedPublicationSet,
  now: number,
  createMissing = true,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    if (set.originKind === "page") {
      const [pages, revisions] = yield* Effect.all([
        reader
          .table("brainPages")
          .index("by_workspace_page_key", (query) =>
            query
              .eq("workspaceId", set.workspaceId)
              .eq("pageKey", set.sourceKey),
          )
          .take(2)
          .pipe(Effect.orDie),
        reader
          .table("pageRevisions")
          .index("by_workspace_revision_key", (query) =>
            query
              .eq("workspaceId", set.workspaceId)
              .eq("revisionKey", set.sourceRevisionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      const page = pages[0];
      const revision = revisions[0];
      if (
        pages.length !== 1 ||
        revisions.length !== 1 ||
        page === undefined ||
        revision === undefined ||
        revision.pageKey !== set.sourceKey
      )
        return { kind: "conflict" as const, reason: "page_origin_invalid" };
      return yield* resolveFenceIdentitiesEffect(
        [
          {
            identity: pageLifecycleFenceIdentity({
              organizationKey: set.organizationKey,
              workspaceId: String(set.workspaceId),
              pageKey: set.sourceKey,
            }),
            eligible:
              page.status === "active" &&
              page.lifecycle?.state === "active" &&
              revision.lifecycle?.state === "active",
          },
        ],
        now,
        createMissing,
      );
    }
    if (set.originKind === "slack") {
      const [revisions, artifacts] = yield* Effect.all([
        reader
          .table("sourceRevisions")
          .index("by_source_revision_key", (query) =>
            query
              .eq("organizationKey", set.organizationKey)
              .eq("sourceRevisionKey", set.sourceRevisionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
        reader
          .table("sourceArtifacts")
          .index("by_org_source_key", (query) =>
            query
              .eq("organizationKey", set.organizationKey)
              .eq("sourceKey", set.sourceKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      const revision = revisions[0];
      const artifact = artifacts[0];
      if (
        revisions.length !== 1 ||
        artifacts.length !== 1 ||
        revision === undefined ||
        artifact === undefined ||
        revision.sourceKey !== set.sourceKey ||
        revision.channelKey !== set.connectorScopeKey ||
        revision.connectionKey !== set.connectionKey ||
        revision.connectionGeneration !== set.connectionGeneration ||
        artifact.channelKey !== revision.channelKey ||
        artifact.connectionKey !== revision.connectionKey
      )
        return { kind: "conflict" as const, reason: "slack_origin_invalid" };
      const [policies, connections] = yield* Effect.all([
        reader
          .table("channelRoutingPolicies")
          .index("by_channel_active", (query) =>
            query.eq("channelKey", revision.channelKey).eq("active", true),
          )
          .take(3)
          .pipe(Effect.orDie),
        reader
          .table("providerConnections")
          .index("by_connection_key", (query) =>
            query.eq("connectionKey", revision.connectionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      const matchingPolicies = policies.filter(
        (policy) =>
          policy.mode !== "capture_only" &&
          policy.targetBrainKeys.includes(set.brainKey),
      );
      const connection = connections[0];
      if (matchingPolicies.length > 1 || connections.length > 1)
        return {
          kind: "conflict" as const,
          reason: "slack_controller_collision",
        };
      return yield* resolveFenceIdentitiesEffect(
        [
          {
            identity: slackSourceLifecycleFenceIdentity({
              organizationKey: set.organizationKey,
              sourceKey: set.sourceKey,
            }),
            eligible:
              !revision.tombstone &&
              revision.lifecycle.state === "active" &&
              artifact.lifecycle.state === "active",
          },
          {
            identity: slackPolicyFenceIdentity({
              organizationKey: set.organizationKey,
              channelKey: revision.channelKey,
              brainKey: set.brainKey,
            }),
            eligible: matchingPolicies.length === 1,
          },
          {
            identity: connectionFenceIdentity({
              organizationKey: set.organizationKey,
              connectionKey: revision.connectionKey,
            }),
            eligible:
              connection !== undefined &&
              connection.organizationKey === set.organizationKey &&
              connection.status === "active" &&
              connection.connectionGeneration === revision.connectionGeneration,
          },
        ],
        now,
        createMissing,
      );
    }
    if (set.originKind === "transcript") {
      const [revisions, units] = yield* Effect.all([
        reader
          .table("sourceUnitRevisions")
          .index("by_unit_revision_key", (query) =>
            query
              .eq("organizationKey", set.organizationKey)
              .eq("unitRevisionKey", set.sourceRevisionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
        reader
          .table("sourceUnits")
          .index("by_unit_key", (query) =>
            query
              .eq("organizationKey", set.organizationKey)
              .eq("unitKey", set.sourceKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      const revision = revisions[0];
      const unit = units[0];
      if (
        revisions.length !== 1 ||
        units.length !== 1 ||
        revision === undefined ||
        unit === undefined ||
        revision.unitKey !== set.sourceKey ||
        unit.connectionKey !== set.connectionKey ||
        unit.connectionGeneration !== set.connectionGeneration
      )
        return {
          kind: "conflict" as const,
          reason: "transcript_origin_invalid",
        };
      const [routes, connections] = yield* Effect.all([
        reader
          .table("callRoutingProposals")
          .index("by_org_revision", (query) =>
            query
              .eq("organizationKey", set.organizationKey)
              .eq("unitRevisionKey", revision.unitRevisionKey),
          )
          .take(101)
          .pipe(Effect.orDie),
        reader
          .table("providerConnections")
          .index("by_connection_key", (query) =>
            query.eq("connectionKey", unit.connectionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      const matchingRoutes = routes.filter(
        (route) =>
          route.outcome === "routed" &&
          route.brainKey === set.brainKey &&
          (route.status === "current" || route.status === "accepted"),
      );
      const connection = connections[0];
      if (matchingRoutes.length > 1 || connections.length > 1)
        return {
          kind: "conflict" as const,
          reason: "transcript_controller_collision",
        };
      return yield* resolveFenceIdentitiesEffect(
        [
          {
            identity: transcriptUnitLifecycleFenceIdentity({
              organizationKey: set.organizationKey,
              unitKey: set.sourceKey,
            }),
            eligible: !revision.tombstone && unit.lifecycle.state === "active",
          },
          {
            identity: transcriptRouteFenceIdentity({
              organizationKey: set.organizationKey,
              unitKey: set.sourceKey,
              brainKey: set.brainKey,
            }),
            eligible: matchingRoutes.length === 1,
          },
          {
            identity: connectionFenceIdentity({
              organizationKey: set.organizationKey,
              connectionKey: unit.connectionKey,
            }),
            eligible:
              connection !== undefined &&
              connection.organizationKey === set.organizationKey &&
              connection.status === "active" &&
              connection.connectionGeneration === unit.connectionGeneration,
          },
        ],
        now,
        createMissing,
      );
    }
    if (set.originKind === "document") {
      if (
        set.connectorScopeKey === undefined ||
        set.connectionKey === undefined ||
        set.connectionGeneration === undefined
      )
        return {
          kind: "conflict" as const,
          reason: "document_scope_missing",
        };
      const ctx = yield* MutationCtx;
      const [objects, revisions, scopes] = yield* Effect.all([
        Effect.promise(() =>
          rawDatabase(ctx)
            .query("documentSourceObjects")
            .withIndex("by_organization_object_key", (query) =>
              query
                .eq("organizationKey", set.organizationKey)
                .eq("documentObjectKey", set.sourceKey),
            )
            .take(2),
        ),
        Effect.promise(() =>
          rawDatabase(ctx)
            .query("documentSourceRevisions")
            .withIndex("by_organization_revision_key", (query) =>
              query
                .eq("organizationKey", set.organizationKey)
                .eq("documentRevisionKey", set.sourceRevisionKey),
            )
            .take(2),
        ),
        Effect.promise(() =>
          rawDatabase(ctx)
            .query("connectorScopes")
            .withIndex("by_connector_scope_key", (query) =>
              query.eq("connectorScopeKey", set.connectorScopeKey ?? ""),
            )
            .take(2),
        ),
      ]);
      const object = objects[0];
      const revision = revisions[0];
      const scope = scopes[0];
      if (
        objects.length !== 1 ||
        revisions.length !== 1 ||
        scopes.length !== 1 ||
        object === undefined ||
        revision === undefined ||
        scope === undefined ||
        revision.documentObjectKey !== set.sourceKey ||
        revision.connectorScopeKey !== set.connectorScopeKey ||
        revision.connectionKey !== set.connectionKey ||
        revision.connectionGeneration !== set.connectionGeneration ||
        scope.organizationKey !== set.organizationKey ||
        scope.connectionKey !== set.connectionKey ||
        scope.currentConnectionGeneration !== set.connectionGeneration ||
        scope.currentAllowlistGeneration !== revision.allowlistGeneration
      )
        return {
          kind: "conflict" as const,
          reason: "document_controller_tuple_invalid",
        };
      const [allowlists, connections] = yield* Effect.all([
        Effect.promise(() =>
          rawDatabase(ctx)
            .query("connectorAllowlistGenerations")
            .withIndex("by_scope_generation", (query) =>
              query
                .eq("connectorScopeKey", set.connectorScopeKey ?? "")
                .eq("allowlistGeneration", revision.allowlistGeneration),
            )
            .take(2),
        ),
        reader
          .table("providerConnections")
          .index("by_connection_key", (query) =>
            query.eq("connectionKey", set.connectionKey ?? ""),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      const allowlist = allowlists[0];
      const connection = connections[0];
      if (
        allowlists.length !== 1 ||
        connections.length > 1 ||
        allowlist === undefined ||
        allowlist.organizationKey !== set.organizationKey ||
        allowlist.connectionKey !== set.connectionKey ||
        allowlist.connectionGeneration !== set.connectionGeneration
      )
        return {
          kind: "conflict" as const,
          reason: "document_allowlist_invalid",
        };
      return yield* resolveFenceIdentitiesEffect(
        [
          {
            identity: documentLifecycleFenceIdentity({
              organizationKey: set.organizationKey,
              documentObjectKey: set.sourceKey,
            }),
            eligible: object.lifecycleState === "live" && !revision.tombstone,
          },
          {
            identity: connectorScopeFenceIdentity({
              organizationKey: set.organizationKey,
              connectorScopeKey: set.connectorScopeKey,
            }),
            eligible: scope.state === "active",
          },
          {
            identity: connectorAllowlistFenceIdentity({
              organizationKey: set.organizationKey,
              connectorScopeKey: set.connectorScopeKey,
            }),
            eligible: allowlist.state === "current",
          },
          {
            identity: connectionFenceIdentity({
              organizationKey: set.organizationKey,
              connectionKey: set.connectionKey,
            }),
            eligible:
              connection !== undefined &&
              connection.organizationKey === set.organizationKey &&
              connection.status === "active" &&
              connection.connectionGeneration === set.connectionGeneration,
          },
        ],
        now,
        createMissing,
      );
    }
    return {
      kind: "conflict" as const,
      reason: "unsupported_publication_origin",
    };
  });

const samePublicationIdentity = (
  left: RetrievalPublicationSetsDoc,
  right: RetrievalPublicationSetsDoc,
) =>
  String(left.workspaceId) === String(right.workspaceId) &&
  left.brainKey === right.brainKey &&
  left.corpusKey === right.corpusKey &&
  left.originKind === right.originKind &&
  left.originTable === right.originTable &&
  left.sourceKey === right.sourceKey &&
  sameOptional(left.connectorScopeKey, right.connectorScopeKey) &&
  sameOptional(left.connectionKey, right.connectionKey) &&
  sameOptional(left.connectionGeneration, right.connectionGeneration);

const subjectMatchesSet = (
  subject: RetrievalPublicationSubjectsDoc,
  set: RetrievalPublicationSetsDoc,
) =>
  String(subject.workspaceId) === String(set.workspaceId) &&
  subject.brainKey === set.brainKey &&
  subject.corpusKey === set.corpusKey &&
  subject.originKind === set.originKind &&
  subject.originTable === set.originTable &&
  subject.sourceKey === set.sourceKey &&
  sameOptional(subject.connectorScopeKey, set.connectorScopeKey) &&
  sameOptional(subject.connectionKey, set.connectionKey) &&
  sameOptional(subject.connectionGeneration, set.connectionGeneration);

const publicationSubjectKeyFor = (set: RetrievalPublicationSetsDoc) =>
  retrievalPublicationSubjectKey({
    workspaceId: String(set.workspaceId),
    brainKey: set.brainKey,
    corpusKey: set.corpusKey,
    originTable: set.originTable,
    kind: set.originKind,
    sourceKey: set.sourceKey,
    ...(set.connectorScopeKey === undefined
      ? {}
      : { connectorScopeKey: set.connectorScopeKey }),
  });

const MAX_BACKFILL_PUBLICATION_TOKENS = 3_300;
const MAX_BACKFILL_WRITES = 7_000;

const backfillPublicationSetEffect = (set: RetrievalPublicationSetsDoc) =>
  Effect.gen(function* () {
    if (!isRetainedPublicationSet(set)) return { kind: "conflict" };
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const expectedSubjectKey = publicationSubjectKeyFor(set);
    const [subjects, historyRows, entries, tokens, originPresent] =
      yield* Effect.all([
        reader
          .table("retrievalPublicationSubjects")
          .index("by_workspace_subject", (query) =>
            query
              .eq("workspaceId", set.workspaceId)
              .eq("publicationSubjectKey", expectedSubjectKey),
          )
          .take(3)
          .pipe(Effect.orDie),
        reader
          .table("retrievalPublicationSets")
          .index("by_workspace_brain_source_state_generation", (query) =>
            query
              .eq("workspaceId", set.workspaceId)
              .eq("brainKey", set.brainKey)
              .eq("originTable", set.originTable)
              .eq("sourceKey", set.sourceKey),
          )
          .take(MAX_PUBLICATION_HISTORY_ROWS + 1)
          .pipe(Effect.orDie),
        reader
          .table("retrievalEntries")
          .index("by_workspace_brain_publication_set_entry", (query) =>
            query
              .eq("workspaceId", set.workspaceId)
              .eq("brainKey", set.brainKey)
              .eq("publicationSetKey", set.publicationSetKey),
          )
          .take(MAX_PUBLICATION_ENTRY_ROWS + 1)
          .pipe(Effect.orDie),
        reader
          .table("retrievalTokens")
          .index("by_workspace_brain_publication_set_entry", (query) =>
            query
              .eq("workspaceId", set.workspaceId)
              .eq("brainKey", set.brainKey)
              .eq("publicationSetKey", set.publicationSetKey),
          )
          .take(MAX_BACKFILL_PUBLICATION_TOKENS + 1)
          .pipe(Effect.orDie),
        publicationOriginPresentEffect(set),
      ]);
    if (
      historyRows.length > MAX_PUBLICATION_HISTORY_ROWS ||
      entries.length > MAX_PUBLICATION_ENTRY_ROWS ||
      tokens.length > MAX_BACKFILL_PUBLICATION_TOKENS
    )
      return {
        kind: "capacity",
        publicationSetKey: set.publicationSetKey,
        historyCount: historyRows.length,
        entryCount: entries.length,
        tokenCount: tokens.length,
      };

    const history = historyRows.filter(
      (candidate): candidate is RetainedPublicationSet =>
        isRetainedPublicationSet(candidate) &&
        samePublicationIdentity(candidate, set),
    );
    const currentSets = history.filter(({ state }) => state === "current");
    const maximumGeneration = Math.max(
      0,
      ...history.map(({ publicationGeneration }) => publicationGeneration),
    );
    const currentPublicationSetKey =
      currentSets.length === 1
        ? (currentSets[0]?.publicationSetKey ?? null)
        : null;
    const storedSubject = subjects.length === 1 ? subjects[0] : undefined;
    const prospectiveSubject: PublicationIntegritySubject = storedSubject ?? {
      workspaceId: String(set.workspaceId),
      brainKey: set.brainKey,
      corpusKey: set.corpusKey,
      originKind: set.originKind,
      originTable: set.originTable,
      sourceKey: set.sourceKey,
      ...(set.connectorScopeKey === undefined
        ? {}
        : { connectorScopeKey: set.connectorScopeKey }),
      ...(set.connectionKey === undefined
        ? {}
        : { connectionKey: set.connectionKey }),
      ...(set.connectionGeneration === undefined
        ? {}
        : { connectionGeneration: set.connectionGeneration }),
      publicationSubjectKey: expectedSubjectKey,
      currentPublicationSetKey,
      lastPublicationGeneration: maximumGeneration,
    };
    const prospectiveSet = {
      ...set,
      publicationSubjectKey: expectedSubjectKey,
    } as PublicationIntegritySet;
    const prospectiveEntries = entries.map((entry) => ({
      ...entry,
      publicationSubjectKey: expectedSubjectKey,
    }));
    const entriesByKey = new Map(
      entries.map((entry) => [entry.entryKey, entry]),
    );
    if (entriesByKey.size !== entries.length) return { kind: "conflict" };
    const prospectiveTokens = tokens.map((token) => {
      const entry = entriesByKey.get(token.entryKey);
      if (entry === undefined) return null;
      const evidenceAt = entry.sourceModifiedAt ?? entry.observedAt;
      if (
        (token.corpusKey !== undefined &&
          token.corpusKey !== entry.corpusKey) ||
        (token.evidenceAt !== undefined && token.evidenceAt !== evidenceAt)
      )
        return null;
      return {
        ...token,
        publicationState: token.publicationState ?? set.state,
        corpusKey: entry.corpusKey,
        evidenceAt,
      };
    });
    if (prospectiveTokens.some((token) => token === null))
      return { kind: "conflict" };
    const completeProspectiveTokens = prospectiveTokens.filter(
      (token): token is NonNullable<typeof token> => token !== null,
    );
    const report = inspectPublicationIntegrity({
      expectedPublicationSubjectKey: expectedSubjectKey,
      originPresent,
      set: prospectiveSet,
      subjects: subjects.length === 0 ? [prospectiveSubject] : subjects,
      subjectHistory: history,
      entries: prospectiveEntries,
      tokens: completeProspectiveTokens,
    });
    if (
      !originPresent ||
      subjects.length > 1 ||
      currentSets.length > 1 ||
      (storedSubject !== undefined && !subjectMatchesSet(storedSubject, set)) ||
      report.issues.length > 0 ||
      (set.publicationSubjectKey !== undefined &&
        set.publicationSubjectKey !== expectedSubjectKey) ||
      entries.some(
        (entry) =>
          entry.publicationSubjectKey !== undefined &&
          entry.publicationSubjectKey !== expectedSubjectKey,
      ) ||
      tokens.some((token) => token.organizationKey !== set.organizationKey)
    )
      return { kind: "conflict" };

    const tokenClassificationWrites = tokens.filter(
      ({ publicationState, corpusKey, evidenceAt }) =>
        publicationState === undefined ||
        corpusKey === undefined ||
        evidenceAt === undefined,
    ).length;
    const catalogWrites = new Set(tokens.map(({ token }) => token)).size;
    const projectedWrites =
      tokenClassificationWrites +
      catalogWrites +
      (storedSubject === undefined ? 1 : 0) +
      (set.publicationSubjectKey === undefined ? 1 : 0) +
      entries.filter(
        ({ publicationSubjectKey }) => publicationSubjectKey === undefined,
      ).length;
    if (projectedWrites > MAX_BACKFILL_WRITES)
      return {
        kind: "capacity" as const,
        publicationSetKey: set.publicationSetKey,
        historyCount: historyRows.length,
        entryCount: entries.length,
        tokenCount: tokens.length,
      };

    const at = yield* Clock.currentTimeMillis;
    const catalogResult = yield* synchronizeCurrentTokenCatalogEffect({
      organizationKey: set.organizationKey,
      workspaceId: set.workspaceId,
      brainKey: set.brainKey,
      removedPostings: set.state === "retired" ? completeProspectiveTokens : [],
      addedPostings: set.state === "current" ? completeProspectiveTokens : [],
      now: at,
    }).pipe(Effect.either);
    if (Either.isLeft(catalogResult))
      return catalogResult.left._tag === "RetrievalPublicationCapacityExceeded"
        ? {
            kind: "capacity" as const,
            publicationSetKey: set.publicationSetKey,
            historyCount: historyRows.length,
            entryCount: entries.length,
            tokenCount: tokens.length,
          }
        : { kind: "conflict" as const };

    let wrote = tokens.length > 0;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const prospective = completeProspectiveTokens[index];
      if (token === undefined || prospective === undefined) continue;
      if (
        token.publicationState !== undefined &&
        token.corpusKey !== undefined &&
        token.evidenceAt !== undefined
      )
        continue;
      yield* writer
        .table("retrievalTokens")
        .patch(token._id, {
          publicationState: set.state,
          corpusKey: prospective.corpusKey,
          evidenceAt: prospective.evidenceAt,
        })
        .pipe(Effect.orDie);
    }
    if (storedSubject === undefined) {
      yield* writer
        .table("retrievalPublicationSubjects")
        .insert({
          schemaVersion: 1,
          organizationKey: set.organizationKey,
          workspaceId: set.workspaceId,
          brainKey: set.brainKey,
          corpusKey: set.corpusKey,
          publicationSubjectKey: expectedSubjectKey,
          originKind: set.originKind,
          originTable: set.originTable,
          sourceKey: set.sourceKey,
          ...(set.connectorScopeKey === undefined
            ? {}
            : { connectorScopeKey: set.connectorScopeKey }),
          ...(set.connectionKey === undefined
            ? {}
            : { connectionKey: set.connectionKey }),
          ...(set.connectionGeneration === undefined
            ? {}
            : { connectionGeneration: set.connectionGeneration }),
          currentPublicationSetKey,
          lastPublicationGeneration: maximumGeneration,
          createdAt: set.createdAt,
          updatedAt: set.createdAt,
        })
        .pipe(Effect.orDie);
      wrote = true;
    }
    if (set.publicationSubjectKey === undefined) {
      yield* writer
        .table("retrievalPublicationSets")
        .patch(set._id, { publicationSubjectKey: expectedSubjectKey })
        .pipe(Effect.orDie);
      wrote = true;
    }
    for (const entry of entries) {
      if (entry.publicationSubjectKey !== undefined) continue;
      yield* writer
        .table("retrievalEntries")
        .patch(entry._id, { publicationSubjectKey: expectedSubjectKey })
        .pipe(Effect.orDie);
      wrote = true;
    }
    return { kind: "backfilled", wrote };
  });

const loadSetPageEffect = (
  population: ActivePopulation,
  state: "current" | "retired",
  batchSize: number,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    return yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_brain_state_publication_set", (query) => {
        const scoped = query
          .eq("workspaceId", population.workspaceId)
          .eq("brainKey", population.brainKey)
          .eq("state", state);
        return population.activeCursor === null
          ? scoped
          : scoped.gt("publicationSetKey", population.activeCursor);
      })
      .take(batchSize + 1)
      .pipe(Effect.orDie);
  });

const nextFenceScanStage = (
  stage:
    | "fence_scan_current"
    | "fence_scan_retired"
    | "fence_catch_up_current"
    | "fence_catch_up_retired",
): BackfillStage => {
  switch (stage) {
    case "fence_scan_current":
      return "fence_scan_retired";
    case "fence_scan_retired":
      return "fence_catch_up_current";
    case "fence_catch_up_current":
      return "fence_catch_up_retired";
    case "fence_catch_up_retired":
      return "fence_validate_current";
  }
};

const processEligibilityFenceScanPageEffect = (
  population: ActivePopulation,
  batchSize: number,
) =>
  Effect.gen(function* () {
    const stage = population.activeStage;
    if (
      stage !== "fence_scan_current" &&
      stage !== "fence_scan_retired" &&
      stage !== "fence_catch_up_current" &&
      stage !== "fence_catch_up_retired"
    )
      return progressFrom(population);
    const state = stage.endsWith("current") ? "current" : "retired";
    const rows = yield* loadSetPageEffect(population, state, batchSize);
    const page = rows.slice(0, batchSize);
    const at = yield* Clock.currentTimeMillis;
    const ctx = yield* MutationCtx;
    let current = 0;
    let retired = 0;
    let backfilled = 0;
    let invalidated = 0;
    let conflicts = 0;
    let wrote = false;
    for (const candidate of page) {
      if (!isRetainedPublicationSet(candidate)) continue;
      const set = candidate;
      const withinHighWater = stage.startsWith("fence_scan_")
        ? set._creationTime <= population.scanHighWater
        : population.catchUpHighWater !== null &&
          set._creationTime > population.scanHighWater &&
          set._creationTime <= population.catchUpHighWater;
      if (!withinHighWater || !setMatchesScope(set, population)) continue;
      const marker = set.eligibilityFenceBackfill;
      if (
        marker?.runKey === population.activeRunKey &&
        marker.runGeneration === population.activeRunGeneration
      ) {
        if (marker.scannedState !== set.state) {
          if (set.state === "current") {
            current += 1;
            retired -= 1;
          } else {
            current -= 1;
            retired += 1;
          }
          yield* Effect.promise(() =>
            rawDatabase(ctx).patch(set._id, {
              eligibilityFenceBackfill: {
                ...marker,
                scannedState: set.state,
              },
            }),
          );
          wrote = true;
        }
        continue;
      }
      if (set.state === "current") current += 1;
      else retired += 1;
      if (set.citationInvalidationReceipt !== undefined) {
        if (hasValidCitationInvalidationReceipt(set)) invalidated += 1;
        else conflicts += 1;
        continue;
      }
      const resolved = yield* resolveRequiredEligibilityManifestEffect(set, at);
      if (resolved.kind === "conflict") {
        conflicts += 1;
        continue;
      }
      const existing = set.eligibilityFences;
      if (
        existing !== undefined &&
        !sameFenceManifest(existing, resolved.refs)
      ) {
        conflicts += 1;
        continue;
      }
      yield* Effect.promise(() =>
        rawDatabase(ctx).patch(set._id, {
          ...(existing === undefined
            ? { eligibilityFences: [...resolved.refs] }
            : {}),
          eligibilityFenceBackfill: {
            runKey: population.activeRunKey,
            runGeneration: population.activeRunGeneration,
            configurationDigest: population.activeConfigurationDigest,
            backfilledAt: at,
            scannedState: set.state,
          },
        }),
      );
      wrote = true;
      if (existing === undefined) backfilled += 1;
    }
    const exhausted = rows.length <= batchSize;
    const nextStage = exhausted ? nextFenceScanStage(stage) : stage;
    const enteringCatchUp = exhausted && stage === "fence_scan_retired";
    const enteringValidation = exhausted && stage === "fence_catch_up_retired";
    const nextPopulationGeneration =
      population.projectionPopulationGeneration + (wrote ? 1 : 0);
    const nextConflictCount = population.fenceConflictCount + conflicts;
    const updated = yield* patchPopulationEffect(population, {
      activeStage:
        enteringValidation && nextConflictCount > 0 ? "blocked" : nextStage,
      activeCursor:
        exhausted || page.length === 0
          ? null
          : (page[page.length - 1]?.publicationSetKey ?? null),
      ...(enteringCatchUp ? { catchUpHighWater: at } : {}),
      ...(enteringValidation && nextConflictCount === 0
        ? {
            validationPopulationGeneration: nextPopulationGeneration,
            validationPredecessorDigest: initialEligibilityFenceDigest(),
          }
        : {}),
      projectionPopulationGeneration: nextPopulationGeneration,
      currentFenceSetCount: population.currentFenceSetCount + current,
      retiredFenceSetCount: population.retiredFenceSetCount + retired,
      fenceBackfilledSetCount: population.fenceBackfilledSetCount + backfilled,
      invalidatedFenceSetCount:
        population.invalidatedFenceSetCount + invalidated,
      fenceConflictCount: nextConflictCount,
      updatedAt: at,
    });
    const active = activePopulation(updated);
    if (active === null)
      return yield* Effect.dieMessage(
        "Eligibility-fence scan lost its active run state.",
      );
    return progressFrom(active, page.length);
  });

const resetEligibilityFenceValidationEffect = (population: ActivePopulation) =>
  Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    const updated = yield* patchPopulationEffect(population, {
      activeStage: "fence_validate_current",
      activeCursor: null,
      validationPopulationGeneration: population.projectionPopulationGeneration,
      validationPredecessorDigest: initialEligibilityFenceDigest(),
      validationRestartCount: population.validationRestartCount + 1,
      fenceConflictCount: 0,
      updatedAt: at,
    });
    return progressFrom(activePopulation(updated) ?? population);
  });

const closeEligibilityFenceBackfillEffect = (population: ActivePopulation) =>
  Effect.gen(function* () {
    if (
      population.validationPopulationGeneration !==
      population.projectionPopulationGeneration
    )
      return yield* resetEligibilityFenceValidationEffect(population);
    if (population.fenceConflictCount > 0) {
      const at = yield* Clock.currentTimeMillis;
      const blocked = yield* patchPopulationEffect(population, {
        activeStage: "blocked",
        activeCursor: null,
        updatedAt: at,
      });
      return progressFrom(activePopulation(blocked) ?? population);
    }
    if (population.legacyEligibilityFenceBackfillCompletion !== null)
      return yield* new ProjectionBackfillConflict({
        reason: "completion_immutable",
        detail:
          "The immutable legacy eligibility-fence backfill receipt already exists.",
      });
    if (
      population.catchUpHighWater === null ||
      population.validationPredecessorDigest === null
    )
      return yield* new ProjectionBackfillConflict({
        reason: "integrity_conflict",
        detail:
          "The eligibility-fence validation pass has no pinned high-water or digest.",
      });
    const at = yield* Clock.currentTimeMillis;
    const fenceBackfillGeneration = population.fenceBackfillGeneration + 1;
    const completionBase = {
      runKey: population.activeRunKey,
      runGeneration: population.activeRunGeneration,
      fenceBackfillGeneration,
      scanHighWater: population.scanHighWater,
      catchUpHighWater: population.catchUpHighWater,
      populationGeneration: population.projectionPopulationGeneration,
      configurationDigest: population.activeConfigurationDigest,
      populationDigest: population.validationPredecessorDigest,
      currentSetCount: population.currentFenceSetCount,
      retiredSetCount: population.retiredFenceSetCount,
      backfilledSetCount: population.fenceBackfilledSetCount,
      invalidatedSetCount: population.invalidatedFenceSetCount,
      conflictCount: population.fenceConflictCount,
      completedAt: at,
    };
    const completion = {
      ...completionBase,
      completionDigest: digest(completionBase),
    };
    const completed = yield* patchPopulationEffect(population, {
      activeStage: "complete",
      activeCursor: null,
      fenceBackfillGeneration,
      legacyEligibilityFenceBackfillCompletion: completion,
      updatedAt: at,
    });
    return progressFrom(activePopulation(completed) ?? population);
  });

const validateEligibilityFencePageEffect = (
  population: ActivePopulation,
  batchSize: number,
) =>
  Effect.gen(function* () {
    const state =
      population.activeStage === "fence_validate_current"
        ? "current"
        : "retired";
    const rows = yield* loadSetPageEffect(population, state, batchSize);
    const page = rows.slice(0, batchSize);
    const at = yield* Clock.currentTimeMillis;
    const ctx = yield* MutationCtx;
    let predecessor =
      population.validationPredecessorDigest ?? initialEligibilityFenceDigest();
    let conflicts = 0;
    let controllerChanged = false;
    for (const candidate of page) {
      if (!isRetainedPublicationSet(candidate)) continue;
      const set = candidate;
      if (
        population.catchUpHighWater === null ||
        set._creationTime > population.catchUpHighWater ||
        !setMatchesScope(set, population)
      )
        continue;
      const marker = set.eligibilityFenceBackfill;
      if (
        marker?.runKey === population.activeRunKey &&
        marker.runGeneration === population.activeRunGeneration &&
        marker.validationPass === population.validationRestartCount
      )
        continue;
      if (set.citationInvalidationReceipt !== undefined) {
        if (!hasValidCitationInvalidationReceipt(set)) conflicts += 1;
        else
          predecessor = advancePublicationIntegrityDigest(
            predecessor,
            digest({
              publicationSetKey: set.publicationSetKey,
              state: set.state,
              citationInvalidationReceipt: set.citationInvalidationReceipt,
            }),
          );
        continue;
      }
      const resolved = yield* resolveRequiredEligibilityManifestEffect(set, at);
      if (resolved.kind === "conflict") {
        if (
          marker?.runKey === population.activeRunKey &&
          marker.runGeneration === population.activeRunGeneration
        )
          controllerChanged = true;
        else conflicts += 1;
        continue;
      }
      if (
        set.eligibilityFences === undefined ||
        !sameFenceManifest(set.eligibilityFences, resolved.refs)
      ) {
        if (
          marker?.runKey === population.activeRunKey &&
          marker.runGeneration === population.activeRunGeneration
        )
          controllerChanged = true;
        else conflicts += 1;
        continue;
      }
      predecessor = advancePublicationIntegrityDigest(
        predecessor,
        digest({
          publicationSetKey: set.publicationSetKey,
          state: set.state,
          manifestDigest: resolved.digest,
        }),
      );
      yield* Effect.promise(() =>
        rawDatabase(ctx).patch(set._id, {
          eligibilityFenceBackfill: {
            runKey: population.activeRunKey,
            runGeneration: population.activeRunGeneration,
            configurationDigest: population.activeConfigurationDigest,
            backfilledAt: marker?.backfilledAt ?? at,
            scannedState: marker?.scannedState ?? set.state,
            validationPass: population.validationRestartCount,
            validatedAt: at,
          },
        }),
      );
    }
    const exhausted = rows.length <= batchSize;
    const nextStage: BackfillStage = exhausted
      ? state === "current"
        ? "fence_validate_retired"
        : "complete"
      : population.activeStage;
    const updated = yield* patchPopulationEffect(population, {
      activeStage: controllerChanged ? "superseded" : nextStage,
      activeCursor:
        exhausted || page.length === 0
          ? null
          : (page[page.length - 1]?.publicationSetKey ?? null),
      validationPredecessorDigest: predecessor,
      fenceConflictCount: population.fenceConflictCount + conflicts,
      updatedAt: at,
    });
    const active = activePopulation(updated);
    if (active === null)
      return yield* Effect.dieMessage(
        "Eligibility-fence validation lost its active run state.",
      );
    if (controllerChanged) return progressFrom(active, page.length);
    return exhausted && state === "retired"
      ? yield* closeEligibilityFenceBackfillEffect(active)
      : progressFrom(active, page.length);
  });

const nextBackfillStage = (
  stage:
    "scan_current" | "scan_retired" | "catch_up_current" | "catch_up_retired",
): BackfillStage => {
  switch (stage) {
    case "scan_current":
      return "scan_retired";
    case "scan_retired":
      return "catch_up_current";
    case "catch_up_current":
      return "catch_up_retired";
    case "catch_up_retired":
      return "validate_current";
  }
};

const processBackfillPageEffect = (
  population: ActivePopulation,
  batchSize: number,
) =>
  Effect.gen(function* () {
    const stage = population.activeStage;
    if (
      stage !== "scan_current" &&
      stage !== "scan_retired" &&
      stage !== "catch_up_current" &&
      stage !== "catch_up_retired"
    )
      return progressFrom(population);
    const state = stage.endsWith("current") ? "current" : "retired";
    const effectiveBatchSize = Math.min(batchSize, 1);
    const rows = yield* loadSetPageEffect(
      population,
      state,
      effectiveBatchSize,
    );
    const page = rows.slice(0, effectiveBatchSize);
    let scanned = 0;
    let backfilled = 0;
    let conflicts = 0;
    let capacities = 0;
    let wrote = false;
    for (const set of page) {
      if (!isRetainedPublicationSet(set)) continue;
      const withinHighWater = stage.startsWith("scan_")
        ? set._creationTime <= population.scanHighWater
        : population.catchUpHighWater !== null &&
          set._creationTime > population.scanHighWater &&
          set._creationTime <= population.catchUpHighWater;
      if (!withinHighWater || !setMatchesScope(set, population)) continue;
      scanned += 1;
      const result = yield* backfillPublicationSetEffect(set);
      if (result.kind === "conflict") conflicts += 1;
      else if (result.kind === "capacity") capacities += 1;
      else {
        backfilled += 1;
        wrote = wrote || result.wrote === true;
      }
    }
    const exhausted = rows.length <= effectiveBatchSize;
    const at = yield* Clock.currentTimeMillis;
    const nextStage = exhausted ? nextBackfillStage(stage) : stage;
    const enteringCatchUp = exhausted && stage === "scan_retired";
    const enteringValidation = exhausted && stage === "catch_up_retired";
    const patch: ProjectionPopulationPatch = {
      activeStage: nextStage,
      activeCursor:
        exhausted || page.length === 0
          ? null
          : (page[page.length - 1]?.publicationSetKey ?? null),
      ...(enteringCatchUp ? { catchUpHighWater: at } : {}),
      ...(enteringValidation
        ? {
            validationPopulationGeneration:
              population.projectionPopulationGeneration + (wrote ? 1 : 0),
            validationPredecessorDigest: initialDigest(),
            validatedSetCount: 0,
            validatedSubjectCount: 0,
            validatedEntryCount: 0,
            validatedTokenCount: 0,
          }
        : {}),
      projectionPopulationGeneration:
        population.projectionPopulationGeneration + (wrote ? 1 : 0),
      scannedSetCount: population.scannedSetCount + scanned,
      backfilledSetCount: population.backfilledSetCount + backfilled,
      conflictCount: population.conflictCount + conflicts,
      capacityCount: population.capacityCount + capacities,
      updatedAt: at,
    };
    const updated = yield* patchPopulationEffect(population, patch);
    return progressFrom(activePopulation(updated) ?? population, page.length);
  });

const resetValidationEffect = (population: ActivePopulation) =>
  Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    const updated = yield* patchPopulationEffect(population, {
      activeStage: "validate_current",
      activeCursor: null,
      validationPopulationGeneration: population.projectionPopulationGeneration,
      validationPredecessorDigest: initialDigest(),
      validationRestartCount: population.validationRestartCount + 1,
      validatedSetCount: 0,
      validatedSubjectCount: 0,
      validatedEntryCount: 0,
      validatedTokenCount: 0,
      conflictCount: 0,
      capacityCount: 0,
      updatedAt: at,
    });
    return progressFrom(activePopulation(updated) ?? population);
  });

const validateSetPageEffect = (
  population: ActivePopulation,
  batchSize: number,
) =>
  Effect.gen(function* () {
    const state =
      population.activeStage === "validate_current" ? "current" : "retired";
    const rows = yield* loadSetPageEffect(population, state, batchSize);
    const page = rows.slice(0, batchSize);
    let predecessor = population.validationPredecessorDigest ?? initialDigest();
    let validated = 0;
    let entryCount = 0;
    let tokenCount = 0;
    let conflicts = 0;
    let capacities = 0;
    for (const set of page) {
      if (!isRetainedPublicationSet(set)) continue;
      if (
        population.catchUpHighWater === null ||
        set._creationTime > population.catchUpHighWater ||
        !setMatchesScope(set, population)
      )
        continue;
      const result = yield* validatePublicationSetIntegrityEffect(set);
      if (result.kind === "capacity") {
        capacities += 1;
        continue;
      }
      validated += 1;
      entryCount += result.report.entryCount;
      tokenCount += result.report.tokenCount;
      conflicts += result.report.issues.length;
      predecessor = advancePublicationIntegrityDigest(
        predecessor,
        result.report.setDigest,
      );
    }
    const exhausted = rows.length <= batchSize;
    const nextStage: BackfillStage = exhausted
      ? state === "current"
        ? "validate_retired"
        : "validate_subjects"
      : population.activeStage;
    const at = yield* Clock.currentTimeMillis;
    const updated = yield* patchPopulationEffect(population, {
      activeStage: nextStage,
      activeCursor:
        exhausted || page.length === 0
          ? null
          : (page[page.length - 1]?.publicationSetKey ?? null),
      validationPredecessorDigest: predecessor,
      validatedSetCount: population.validatedSetCount + validated,
      validatedEntryCount: population.validatedEntryCount + entryCount,
      validatedTokenCount: population.validatedTokenCount + tokenCount,
      conflictCount: population.conflictCount + conflicts,
      capacityCount: population.capacityCount + capacities,
      updatedAt: at,
    });
    return progressFrom(activePopulation(updated) ?? population, page.length);
  });

const loadSubjectPageEffect = (
  population: ActivePopulation,
  batchSize: number,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    return yield* reader
      .table("retrievalPublicationSubjects")
      .index("by_workspace_brain_subject", (query) => {
        const scoped = query
          .eq("workspaceId", population.workspaceId)
          .eq("brainKey", population.brainKey);
        return population.activeCursor === null
          ? scoped
          : scoped.gt("publicationSubjectKey", population.activeCursor);
      })
      .take(batchSize + 1)
      .pipe(Effect.orDie);
  });

const validateSubjectEffect = (
  subject: RetrievalPublicationSubjectsDoc,
  population: ActivePopulation,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const historyRows = yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_subject_generation", (query) =>
        query
          .eq("workspaceId", subject.workspaceId)
          .eq("publicationSubjectKey", subject.publicationSubjectKey),
      )
      .take(MAX_PUBLICATION_HISTORY_ROWS + 1)
      .pipe(Effect.orDie);
    if (historyRows.length > MAX_PUBLICATION_HISTORY_ROWS)
      return { kind: "capacity" as const };
    const history = historyRows.filter(
      (set): set is RetainedPublicationSet =>
        isRetainedPublicationSet(set) &&
        (population.catchUpHighWater === null ||
          set._creationTime <= population.catchUpHighWater),
    );
    const current = history.filter(({ state }) => state === "current");
    const maximumGeneration = Math.max(
      0,
      ...history.map(({ publicationGeneration }) => publicationGeneration),
    );
    const identityMatches = history.every(
      (set) =>
        subjectMatchesSet(subject, set) &&
        set.publicationSubjectKey === subject.publicationSubjectKey,
    );
    const pointerMatches =
      current.length <= 1 &&
      subject.currentPublicationSetKey ===
        (current.length === 1 ? (current[0]?.publicationSetKey ?? null) : null);
    const valid =
      history.length > 0 &&
      identityMatches &&
      pointerMatches &&
      subject.lastPublicationGeneration >= maximumGeneration;
    return {
      kind: "validated" as const,
      valid,
      digest: publicationSubjectDigest(subject, history),
    };
  });

const validateSubjectPageEffect = (
  population: ActivePopulation,
  batchSize: number,
) =>
  Effect.gen(function* () {
    const rows = yield* loadSubjectPageEffect(population, batchSize);
    const page = rows.slice(0, batchSize);
    let predecessor = population.validationPredecessorDigest ?? initialDigest();
    let validated = 0;
    let conflicts = 0;
    let capacities = 0;
    for (const subject of page) {
      if (
        population.catchUpHighWater === null ||
        subject._creationTime > population.catchUpHighWater ||
        (population.activeCorpusKey !== null &&
          subject.corpusKey !== population.activeCorpusKey) ||
        (population.activeConnectorScopeKey !== null &&
          subject.connectorScopeKey !== population.activeConnectorScopeKey)
      )
        continue;
      const result = yield* validateSubjectEffect(subject, population);
      if (result.kind === "capacity") {
        capacities += 1;
        continue;
      }
      validated += 1;
      if (!result.valid) conflicts += 1;
      predecessor = advancePublicationIntegrityDigest(
        predecessor,
        result.digest,
      );
    }
    const exhausted = rows.length <= batchSize;
    const at = yield* Clock.currentTimeMillis;
    const updated = yield* patchPopulationEffect(population, {
      activeStage: exhausted ? "complete" : "validate_subjects",
      activeCursor:
        exhausted || page.length === 0
          ? null
          : (page[page.length - 1]?.publicationSubjectKey ?? null),
      validationPredecessorDigest: predecessor,
      validatedSubjectCount: population.validatedSubjectCount + validated,
      conflictCount: population.conflictCount + conflicts,
      capacityCount: population.capacityCount + capacities,
      updatedAt: at,
    });
    const active = activePopulation(updated) ?? population;
    return exhausted
      ? yield* closeBackfillEffect(active)
      : progressFrom(active, page.length);
  });

const closeBackfillEffect = (population: ActivePopulation) =>
  Effect.gen(function* () {
    if (
      population.validationPopulationGeneration !==
      population.projectionPopulationGeneration
    )
      return yield* resetValidationEffect(population);
    if (population.capacityCount > 0)
      return yield* new ProjectionBackfillCapacityExceeded({
        publicationSetKey: population.activeRunKey,
        historyCount: 0,
        entryCount: population.validatedEntryCount,
        tokenCount: population.validatedTokenCount,
      });
    if (population.conflictCount > 0)
      return yield* new ProjectionBackfillConflict({
        reason: "integrity_conflict",
        detail: `Validation found ${population.conflictCount} publication integrity conflict(s).`,
      });
    if (population.legacySubjectBackfillCompletion !== null)
      return yield* new ProjectionBackfillConflict({
        reason: "completion_immutable",
        detail: "The immutable legacy subject-backfill receipt already exists.",
      });
    if (
      population.catchUpHighWater === null ||
      population.validationPredecessorDigest === null
    )
      return yield* new ProjectionBackfillConflict({
        reason: "integrity_conflict",
        detail: "The validation pass has no pinned high-water or digest.",
      });
    const at = yield* Clock.currentTimeMillis;
    const subjectBackfillGeneration = population.subjectBackfillGeneration + 1;
    const completionBase = {
      runKey: population.activeRunKey,
      runGeneration: population.activeRunGeneration,
      subjectBackfillGeneration,
      scanHighWater: population.scanHighWater,
      catchUpHighWater: population.catchUpHighWater,
      populationGeneration: population.projectionPopulationGeneration,
      populationDigest: population.validationPredecessorDigest,
      setCount: population.validatedSetCount,
      subjectCount: population.validatedSubjectCount,
      entryCount: population.validatedEntryCount,
      tokenCount: population.validatedTokenCount,
      completedAt: at,
    };
    const completion = {
      ...completionBase,
      completionDigest: digest(completionBase),
    };
    const updated = yield* patchPopulationEffect(population, {
      activeStage: "complete",
      activeCursor: null,
      subjectBackfillGeneration,
      legacySubjectBackfillCompletion: completion,
      updatedAt: at,
    });
    return progressFrom(activePopulation(updated) ?? population);
  });

export const advanceProjectionPopulationEffect = (input: {
  readonly organizationKey?: string | undefined;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly expectedGeneration: number;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const stored = yield* loadPopulationEffect(input);
    if (stored === null) {
      if (input.expectedGeneration !== 0)
        return yield* new ProjectionBackfillConflict({
          reason: "generation_changed",
          detail: "The projection population row does not exist.",
        });
      const populationKey = keyedDigest("bpop", {
        workspaceId: String(input.workspaceId),
        brainKey: input.brainKey,
      });
      const inserted = yield* insertPopulationEffect({
        schemaVersion: 1,
        organizationKey: input.organizationKey ?? "",
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        populationKey,
        projectionPopulationGeneration: 1,
        subjectBackfillGeneration: 0,
        fenceBackfillGeneration: 0,
        activeRunKey: null,
        activeRunGeneration: 0,
        activePhase: null,
        activeStage: null,
        activeCursor: null,
        activeCorpusKey: null,
        activeConnectorScopeKey: null,
        activeConfigurationDigest: null,
        scanHighWater: null,
        catchUpHighWater: null,
        validationPopulationGeneration: null,
        validationPredecessorDigest: null,
        validationRestartCount: 0,
        scannedSetCount: 0,
        backfilledSetCount: 0,
        validatedSetCount: 0,
        validatedSubjectCount: 0,
        validatedEntryCount: 0,
        validatedTokenCount: 0,
        conflictCount: 0,
        capacityCount: 0,
        legacySubjectBackfillCompletion: null,
        currentFenceSetCount: 0,
        retiredFenceSetCount: 0,
        fenceBackfilledSetCount: 0,
        invalidatedFenceSetCount: 0,
        fenceConflictCount: 0,
        legacyEligibilityFenceBackfillCompletion: null,
        jobAuthorityMigrationRunKey: null,
        jobAuthorityMigrationRunGeneration: 0,
        jobAuthorityMigrationStage: null,
        jobAuthorityMigrationCursor: null,
        jobAuthorityMigrationConfigurationDigest: null,
        jobAuthorityMigrationScanHighWater: null,
        jobAuthorityMigrationPredecessorDigest: null,
        jobAuthorityMigrationProcessedCount: 0,
        jobAuthorityMigrationReplacementCount: 0,
        jobAuthorityMigrationCompleteAuthorityCount: 0,
        jobAuthorityMigrationTerminalHistoryCount: 0,
        jobAuthorityMigrationConflictCount: 0,
        legacyJobAuthorityMigrationCompletion: null,
        createdAt: input.now,
        updatedAt: input.now,
      });
      return inserted.projectionPopulationGeneration;
    }
    if (stored.projectionPopulationGeneration !== input.expectedGeneration)
      return yield* new ProjectionBackfillConflict({
        reason: "generation_changed",
        detail: `Expected projection population generation ${input.expectedGeneration}, found ${stored.projectionPopulationGeneration}.`,
      });
    const nextGeneration = stored.projectionPopulationGeneration + 1;
    yield* patchPopulationEffect(stored, {
      projectionPopulationGeneration: nextGeneration,
      updatedAt: input.now,
    });
    return nextGeneration;
  });

const loadLegacyPublicationJobPageEffect = (
  population: ActiveJobAuthorityMigration,
  batchSize: number,
) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    return yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("retrievalPublicationJobs")
        .withIndex("by_workspace_brain_job", (query) =>
          query
            .eq("workspaceId", population.workspaceId)
            .eq("brainKey", population.brainKey),
        )
        .paginate({
          cursor: population.jobAuthorityMigrationCursor,
          numItems: batchSize,
        }),
    );
  });

const closeLegacyPublicationJobAuthorityMigrationEffect = (
  population: ActiveJobAuthorityMigration,
) =>
  Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    if (population.jobAuthorityMigrationConflictCount > 0) {
      const blocked = yield* patchPopulationEffect(population, {
        jobAuthorityMigrationStage: "blocked",
        jobAuthorityMigrationCursor: null,
        updatedAt: at,
      });
      return jobAuthorityMigrationProgressFrom(
        activeJobAuthorityMigration(blocked) ?? population,
      );
    }
    if (population.legacyJobAuthorityMigrationCompletion !== null)
      return yield* new ProjectionBackfillConflict({
        reason: "completion_immutable",
        detail:
          "The immutable legacy publication-job authority migration receipt already exists.",
      });
    const completionBase = {
      runKey: population.jobAuthorityMigrationRunKey,
      runGeneration: population.jobAuthorityMigrationRunGeneration,
      scanHighWater: population.jobAuthorityMigrationScanHighWater,
      populationGeneration: population.projectionPopulationGeneration,
      configurationDigest: population.jobAuthorityMigrationConfigurationDigest,
      populationDigest: population.jobAuthorityMigrationPredecessorDigest,
      processedJobCount: population.jobAuthorityMigrationProcessedCount,
      replacementJobCount: population.jobAuthorityMigrationReplacementCount,
      completeAuthorityJobCount:
        population.jobAuthorityMigrationCompleteAuthorityCount,
      terminalHistoryJobCount:
        population.jobAuthorityMigrationTerminalHistoryCount,
      conflictCount: population.jobAuthorityMigrationConflictCount,
      completedAt: at,
    };
    const completion = {
      ...completionBase,
      completionDigest: digest(completionBase),
    };
    const completed = yield* patchPopulationEffect(population, {
      jobAuthorityMigrationStage: "complete",
      jobAuthorityMigrationCursor: null,
      legacyJobAuthorityMigrationCompletion: completion,
      updatedAt: at,
    });
    return jobAuthorityMigrationProgressFrom(
      activeJobAuthorityMigration(completed) ?? population,
    );
  });

const processLegacyPublicationJobAuthorityPageEffect = (
  population: ActiveJobAuthorityMigration,
  batchSize: number,
) =>
  Effect.gen(function* () {
    const pageResult = yield* loadLegacyPublicationJobPageEffect(
      population,
      batchSize,
    );
    const at = yield* Clock.currentTimeMillis;
    let predecessor = population.jobAuthorityMigrationPredecessorDigest;
    let processed = 0;
    let replaced = 0;
    let completeAuthority = 0;
    let terminalHistory = 0;
    let conflicts = 0;
    for (const job of pageResult.page) {
      if (job._creationTime > population.jobAuthorityMigrationScanHighWater)
        continue;
      const result = yield* migrateLegacyPublicationJobEffect(
        job as RetrievalPublicationJobsDoc,
        at,
      );
      processed += 1;
      switch (result.kind) {
        case "replaced":
          replaced += 1;
          break;
        case "complete_authority":
          completeAuthority += 1;
          break;
        case "terminal_history":
          terminalHistory += 1;
          break;
        case "conflict":
          conflicts += 1;
          break;
      }
      predecessor = advancePublicationIntegrityDigest(
        predecessor,
        digest({
          jobKey: job.jobKey,
          priorStatus: job.status,
          priorAuthorityDigest: job.authorityDigest ?? null,
          result,
        }),
      );
    }
    const updated = yield* patchPopulationEffect(population, {
      jobAuthorityMigrationCursor: pageResult.isDone
        ? null
        : pageResult.continueCursor,
      jobAuthorityMigrationPredecessorDigest: predecessor,
      jobAuthorityMigrationProcessedCount:
        population.jobAuthorityMigrationProcessedCount + processed,
      jobAuthorityMigrationReplacementCount:
        population.jobAuthorityMigrationReplacementCount + replaced,
      jobAuthorityMigrationCompleteAuthorityCount:
        population.jobAuthorityMigrationCompleteAuthorityCount +
        completeAuthority,
      jobAuthorityMigrationTerminalHistoryCount:
        population.jobAuthorityMigrationTerminalHistoryCount + terminalHistory,
      jobAuthorityMigrationConflictCount:
        population.jobAuthorityMigrationConflictCount + conflicts,
      projectionPopulationGeneration:
        population.projectionPopulationGeneration + (replaced > 0 ? 1 : 0),
      updatedAt: at,
    });
    const active = activeJobAuthorityMigration(updated);
    if (active === null)
      return yield* Effect.dieMessage(
        "Legacy publication-job authority migration lost its active run state.",
      );
    return pageResult.isDone
      ? yield* closeLegacyPublicationJobAuthorityMigrationEffect(active)
      : jobAuthorityMigrationProgressFrom(active);
  });

const startImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "startProjectionBackfill",
  (args) =>
    Effect.gen(function* () {
      const stored = yield* loadPopulationEffect(args);
      const active = stored === null ? null : activePopulation(stored);
      if (
        active !== null &&
        active.activeStage !== "superseded" &&
        active.activePhase === args.phase &&
        active.activeConfigurationDigest === args.expectedConfigurationDigest &&
        active.activeCorpusKey === args.corpusKey &&
        active.activeConnectorScopeKey === args.connectorScopeKey
      )
        return progressFrom(active);
      if (
        stored !== null &&
        stored.projectionPopulationGeneration !==
          args.expectedProjectionPopulationGeneration
      )
        return yield* new ProjectionBackfillConflict({
          reason: "generation_changed",
          detail: `Expected projection population generation ${args.expectedProjectionPopulationGeneration}, found ${stored.projectionPopulationGeneration}.`,
        });
      if (
        active !== null &&
        active.activeStage !== "complete" &&
        active.activeStage !== "blocked" &&
        active.activeStage !== "superseded"
      )
        return yield* new ProjectionBackfillConflict({
          reason: "configuration_changed",
          detail:
            "A projection backfill with a different configuration is active.",
        });
      if (
        args.phase === "publication_subjects" &&
        stored !== null &&
        stored.legacySubjectBackfillCompletion !== null
      )
        return yield* new ProjectionBackfillConflict({
          reason: "completion_immutable",
          detail:
            "The legacy subject population already has an immutable completion receipt.",
        });
      if (
        args.phase === "eligibility_fences" &&
        stored !== null &&
        stored.legacyEligibilityFenceBackfillCompletion !== null
      )
        return yield* new ProjectionBackfillConflict({
          reason: "completion_immutable",
          detail:
            "The legacy eligibility-fence population already has an immutable completion receipt.",
        });
      if (
        args.phase === "eligibility_fences" &&
        (stored?.legacySubjectBackfillCompletion === null ||
          stored?.legacySubjectBackfillCompletion === undefined ||
          stored.legacyJobAuthorityMigrationCompletion === null)
      )
        return yield* new ProjectionBackfillConflict({
          reason: "integrity_conflict",
          detail:
            "Eligibility-fence backfill requires immutable subject and legacy job-authority migration receipts.",
        });
      const at = yield* Clock.currentTimeMillis;
      const projectionPopulationGeneration =
        stored?.projectionPopulationGeneration ?? 1;
      const runGeneration = (stored?.activeRunGeneration ?? 0) + 1;
      const subjectBackfillGeneration = stored?.subjectBackfillGeneration ?? 0;
      const populationKey =
        stored?.populationKey ??
        keyedDigest("bpop", {
          workspaceId: String(args.workspaceId),
          brainKey: args.brainKey,
        });
      const runKey = keyedDigest("pbrun", {
        populationKey,
        phase: args.phase,
        corpusKey: args.corpusKey,
        connectorScopeKey: args.connectorScopeKey,
        configurationDigest: args.expectedConfigurationDigest,
        targetGeneration:
          args.phase === "publication_subjects"
            ? subjectBackfillGeneration + 1
            : (stored?.fenceBackfillGeneration ?? 0) + 1,
        runGeneration,
      });
      const patch: ProjectionPopulationInsert = {
        schemaVersion: 1,
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        populationKey,
        projectionPopulationGeneration,
        subjectBackfillGeneration,
        fenceBackfillGeneration: stored?.fenceBackfillGeneration ?? 0,
        activeRunKey: runKey,
        activeRunGeneration: runGeneration,
        activePhase: args.phase,
        activeStage:
          args.phase === "publication_subjects"
            ? "scan_current"
            : "fence_scan_current",
        activeCursor: null,
        activeCorpusKey: args.corpusKey,
        activeConnectorScopeKey: args.connectorScopeKey,
        activeConfigurationDigest: args.expectedConfigurationDigest,
        scanHighWater: at,
        catchUpHighWater: null,
        validationPopulationGeneration: null,
        validationPredecessorDigest: null,
        validationRestartCount: 0,
        scannedSetCount:
          args.phase === "publication_subjects"
            ? 0
            : (stored?.scannedSetCount ?? 0),
        backfilledSetCount:
          args.phase === "publication_subjects"
            ? 0
            : (stored?.backfilledSetCount ?? 0),
        validatedSetCount:
          args.phase === "publication_subjects"
            ? 0
            : (stored?.validatedSetCount ?? 0),
        validatedSubjectCount:
          args.phase === "publication_subjects"
            ? 0
            : (stored?.validatedSubjectCount ?? 0),
        validatedEntryCount:
          args.phase === "publication_subjects"
            ? 0
            : (stored?.validatedEntryCount ?? 0),
        validatedTokenCount:
          args.phase === "publication_subjects"
            ? 0
            : (stored?.validatedTokenCount ?? 0),
        conflictCount: 0,
        capacityCount: 0,
        legacySubjectBackfillCompletion:
          args.phase === "publication_subjects"
            ? null
            : (stored?.legacySubjectBackfillCompletion ?? null),
        currentFenceSetCount:
          args.phase === "eligibility_fences"
            ? 0
            : (stored?.currentFenceSetCount ?? 0),
        retiredFenceSetCount:
          args.phase === "eligibility_fences"
            ? 0
            : (stored?.retiredFenceSetCount ?? 0),
        fenceBackfilledSetCount:
          args.phase === "eligibility_fences"
            ? 0
            : (stored?.fenceBackfilledSetCount ?? 0),
        invalidatedFenceSetCount:
          args.phase === "eligibility_fences"
            ? 0
            : (stored?.invalidatedFenceSetCount ?? 0),
        fenceConflictCount:
          args.phase === "eligibility_fences"
            ? 0
            : (stored?.fenceConflictCount ?? 0),
        legacyEligibilityFenceBackfillCompletion:
          args.phase === "eligibility_fences"
            ? null
            : (stored?.legacyEligibilityFenceBackfillCompletion ?? null),
        jobAuthorityMigrationRunKey:
          stored?.jobAuthorityMigrationRunKey ?? null,
        jobAuthorityMigrationRunGeneration:
          stored?.jobAuthorityMigrationRunGeneration ?? 0,
        jobAuthorityMigrationStage: stored?.jobAuthorityMigrationStage ?? null,
        jobAuthorityMigrationCursor:
          stored?.jobAuthorityMigrationCursor ?? null,
        jobAuthorityMigrationConfigurationDigest:
          stored?.jobAuthorityMigrationConfigurationDigest ?? null,
        jobAuthorityMigrationScanHighWater:
          stored?.jobAuthorityMigrationScanHighWater ?? null,
        jobAuthorityMigrationPredecessorDigest:
          stored?.jobAuthorityMigrationPredecessorDigest ?? null,
        jobAuthorityMigrationProcessedCount:
          stored?.jobAuthorityMigrationProcessedCount ?? 0,
        jobAuthorityMigrationReplacementCount:
          stored?.jobAuthorityMigrationReplacementCount ?? 0,
        jobAuthorityMigrationCompleteAuthorityCount:
          stored?.jobAuthorityMigrationCompleteAuthorityCount ?? 0,
        jobAuthorityMigrationTerminalHistoryCount:
          stored?.jobAuthorityMigrationTerminalHistoryCount ?? 0,
        jobAuthorityMigrationConflictCount:
          stored?.jobAuthorityMigrationConflictCount ?? 0,
        legacyJobAuthorityMigrationCompletion:
          stored?.legacyJobAuthorityMigrationCompletion ?? null,
        createdAt: stored?.createdAt ?? at,
        updatedAt: at,
      };
      const updated =
        stored === null
          ? yield* insertPopulationEffect(patch)
          : yield* patchPopulationEffect(stored, patch);
      const started = activePopulation(updated);
      if (started === null)
        return yield* Effect.dieMessage(
          "Projection backfill start did not persist active run state.",
        );
      return progressFrom(started);
    }),
);

const resumeImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "resumeProjectionBackfill",
  (args) =>
    Effect.gen(function* () {
      const stored = yield* loadPopulationByRunEffect(args.runKey);
      const population = stored === null ? null : activePopulation(stored);
      if (population === null)
        return yield* new ProjectionBackfillNotFound({ runKey: args.runKey });
      if (population.activeRunGeneration !== args.expectedRunGeneration)
        return yield* new ProjectionBackfillConflict({
          reason: "generation_changed",
          detail: `Expected run generation ${args.expectedRunGeneration}, found ${population.activeRunGeneration}.`,
        });
      if (
        population.activePhase === "publication_subjects" &&
        population.activeStage.startsWith("validate_") &&
        population.validationPopulationGeneration !==
          population.projectionPopulationGeneration
      )
        return yield* resetValidationEffect(population);
      if (
        population.activePhase === "eligibility_fences" &&
        population.activeStage.startsWith("fence_validate_") &&
        population.validationPopulationGeneration !==
          population.projectionPopulationGeneration
      )
        return yield* resetEligibilityFenceValidationEffect(population);
      if (
        population.activePhase === "eligibility_fences" &&
        (population.activeStage === "fence_scan_current" ||
          population.activeStage === "fence_scan_retired" ||
          population.activeStage === "fence_catch_up_current" ||
          population.activeStage === "fence_catch_up_retired")
      )
        return yield* processEligibilityFenceScanPageEffect(
          population,
          args.batchSize,
        );
      if (
        population.activePhase === "eligibility_fences" &&
        (population.activeStage === "fence_validate_current" ||
          population.activeStage === "fence_validate_retired")
      )
        return yield* validateEligibilityFencePageEffect(
          population,
          args.batchSize,
        );
      if (
        population.activePhase === "publication_subjects" &&
        (population.activeStage === "scan_current" ||
          population.activeStage === "scan_retired" ||
          population.activeStage === "catch_up_current" ||
          population.activeStage === "catch_up_retired")
      )
        return yield* processBackfillPageEffect(population, args.batchSize);
      if (
        population.activePhase === "publication_subjects" &&
        (population.activeStage === "validate_current" ||
          population.activeStage === "validate_retired")
      )
        return yield* validateSetPageEffect(population, args.batchSize);
      if (
        population.activePhase === "publication_subjects" &&
        population.activeStage === "validate_subjects"
      )
        return yield* validateSubjectPageEffect(population, args.batchSize);
      return progressFrom(population);
    }),
);

const migrateLegacyPublicationJobAuthorityImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "migrateLegacyPublicationJobAuthority",
  (args) =>
    Effect.gen(function* () {
      const stored = yield* loadPopulationEffect(args);
      const active =
        stored === null ? null : activeJobAuthorityMigration(stored);
      if (
        active !== null &&
        active.jobAuthorityMigrationConfigurationDigest ===
          args.expectedConfigurationDigest
      )
        return jobAuthorityMigrationProgressFrom(active);
      if (
        stored !== null &&
        stored.projectionPopulationGeneration !==
          args.expectedProjectionPopulationGeneration
      )
        return yield* new ProjectionBackfillConflict({
          reason: "generation_changed",
          detail: `Expected projection population generation ${args.expectedProjectionPopulationGeneration}, found ${stored.projectionPopulationGeneration}.`,
        });
      if (active !== null && active.jobAuthorityMigrationStage === "scanning")
        return yield* new ProjectionBackfillConflict({
          reason: "configuration_changed",
          detail:
            "A legacy publication-job authority migration with a different configuration is active.",
        });
      if (
        stored !== null &&
        stored.legacyJobAuthorityMigrationCompletion !== null
      )
        return yield* new ProjectionBackfillConflict({
          reason: "completion_immutable",
          detail:
            "The legacy publication-job authority migration already has an immutable completion receipt.",
        });
      const at = yield* Clock.currentTimeMillis;
      const projectionPopulationGeneration =
        stored?.projectionPopulationGeneration ?? 1;
      const runGeneration =
        (stored?.jobAuthorityMigrationRunGeneration ?? 0) + 1;
      const populationKey =
        stored?.populationKey ??
        keyedDigest("bpop", {
          workspaceId: String(args.workspaceId),
          brainKey: args.brainKey,
        });
      const runKey = keyedDigest("pjam", {
        populationKey,
        configurationDigest: args.expectedConfigurationDigest,
        runGeneration,
      });
      const patch: ProjectionPopulationInsert = {
        schemaVersion: 1,
        organizationKey: stored?.organizationKey ?? args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        populationKey,
        projectionPopulationGeneration,
        subjectBackfillGeneration: stored?.subjectBackfillGeneration ?? 0,
        fenceBackfillGeneration: stored?.fenceBackfillGeneration ?? 0,
        activeRunKey: stored?.activeRunKey ?? null,
        activeRunGeneration: stored?.activeRunGeneration ?? 0,
        activePhase: stored?.activePhase ?? null,
        activeStage: stored?.activeStage ?? null,
        activeCursor: stored?.activeCursor ?? null,
        activeCorpusKey: stored?.activeCorpusKey ?? null,
        activeConnectorScopeKey: stored?.activeConnectorScopeKey ?? null,
        activeConfigurationDigest: stored?.activeConfigurationDigest ?? null,
        scanHighWater: stored?.scanHighWater ?? null,
        catchUpHighWater: stored?.catchUpHighWater ?? null,
        validationPopulationGeneration:
          stored?.validationPopulationGeneration ?? null,
        validationPredecessorDigest:
          stored?.validationPredecessorDigest ?? null,
        validationRestartCount: stored?.validationRestartCount ?? 0,
        scannedSetCount: stored?.scannedSetCount ?? 0,
        backfilledSetCount: stored?.backfilledSetCount ?? 0,
        validatedSetCount: stored?.validatedSetCount ?? 0,
        validatedSubjectCount: stored?.validatedSubjectCount ?? 0,
        validatedEntryCount: stored?.validatedEntryCount ?? 0,
        validatedTokenCount: stored?.validatedTokenCount ?? 0,
        conflictCount: stored?.conflictCount ?? 0,
        capacityCount: stored?.capacityCount ?? 0,
        legacySubjectBackfillCompletion:
          stored?.legacySubjectBackfillCompletion ?? null,
        currentFenceSetCount: stored?.currentFenceSetCount ?? 0,
        retiredFenceSetCount: stored?.retiredFenceSetCount ?? 0,
        fenceBackfilledSetCount: stored?.fenceBackfilledSetCount ?? 0,
        invalidatedFenceSetCount: stored?.invalidatedFenceSetCount ?? 0,
        fenceConflictCount: stored?.fenceConflictCount ?? 0,
        legacyEligibilityFenceBackfillCompletion:
          stored?.legacyEligibilityFenceBackfillCompletion ?? null,
        jobAuthorityMigrationRunKey: runKey,
        jobAuthorityMigrationRunGeneration: runGeneration,
        jobAuthorityMigrationStage: "scanning",
        jobAuthorityMigrationCursor: null,
        jobAuthorityMigrationConfigurationDigest:
          args.expectedConfigurationDigest,
        jobAuthorityMigrationScanHighWater: at,
        jobAuthorityMigrationPredecessorDigest:
          initialJobAuthorityMigrationDigest(),
        jobAuthorityMigrationProcessedCount: 0,
        jobAuthorityMigrationReplacementCount: 0,
        jobAuthorityMigrationCompleteAuthorityCount: 0,
        jobAuthorityMigrationTerminalHistoryCount: 0,
        jobAuthorityMigrationConflictCount: 0,
        legacyJobAuthorityMigrationCompletion: null,
        createdAt: stored?.createdAt ?? at,
        updatedAt: at,
      };
      const updated =
        stored === null
          ? yield* insertPopulationEffect(patch)
          : yield* patchPopulationEffect(stored, patch);
      const started = activeJobAuthorityMigration(updated);
      if (started === null)
        return yield* Effect.dieMessage(
          "Legacy publication-job authority migration start did not persist active run state.",
        );
      return jobAuthorityMigrationProgressFrom(started);
    }),
);

const resumeLegacyPublicationJobAuthorityMigrationImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "resumeLegacyPublicationJobAuthorityMigration",
  (args) =>
    Effect.gen(function* () {
      const stored = yield* loadPopulationByJobAuthorityMigrationRunEffect(
        args.runKey,
      );
      const population =
        stored === null ? null : activeJobAuthorityMigration(stored);
      if (population === null)
        return yield* new ProjectionBackfillNotFound({ runKey: args.runKey });
      if (
        population.jobAuthorityMigrationRunGeneration !==
        args.expectedRunGeneration
      )
        return yield* new ProjectionBackfillConflict({
          reason: "generation_changed",
          detail: `Expected run generation ${args.expectedRunGeneration}, found ${population.jobAuthorityMigrationRunGeneration}.`,
        });
      if (population.jobAuthorityMigrationStage !== "scanning")
        return jobAuthorityMigrationProgressFrom(population);
      return yield* processLegacyPublicationJobAuthorityPageEffect(
        population,
        args.batchSize,
      );
    }),
);

const backfillTranscriptRevisionOrderImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "backfillTranscriptRevisionOrder",
  startTranscriptRevisionOrderBackfillEffect,
);

const resumeTranscriptRevisionOrderBackfillImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "resumeTranscriptRevisionOrderBackfill",
  resumeTranscriptRevisionOrderBackfillEffect,
);

const pausePublicationWorkersImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "pausePublicationWorkers",
  (args) =>
    Effect.gen(function* () {
      const operation = "pause_publication_workers" as const;
      const scope = {
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        scopeKey: args.scopeKey,
      };
      const pauseKey = publicationPauseKey(scope);
      const receipt = yield* loadOperationReceiptEffect(
        args.organizationKey,
        args.operationKey,
      );
      if (receipt !== null) {
        const mismatch = assertReceiptIdentity(receipt, {
          operation,
          workspaceId: args.workspaceId,
          brainKey: args.brainKey,
          scopeKey: args.scopeKey,
          targetKind: "publication_workers",
          targetKey: pauseKey,
        });
        if (mismatch !== null) return yield* mismatch;
        const active = yield* activePublicationLeasesForMutationEffect(
          pauseKey,
          21,
        );
        return {
          operationKey: args.operationKey,
          receiptKey: receipt.receiptKey,
          pauseKey,
          scopeKey: args.scopeKey,
          previousPauseEpoch: receipt.expectedGeneration ?? 0,
          pauseEpoch: receipt.resultGeneration ?? 0,
          state: "paused" as const,
          activeLeaseCount: active.length,
          dryRun: false,
        };
      }
      const { rows } = yield* loadPublicationPauseForMutationEffect(scope);
      if (rows.length > 1)
        return yield* operationConflict(
          operation,
          "integrity_conflict",
          "More than one publication pause row exists for the scope.",
        );
      const current = rows[0];
      if (current !== undefined && !exactScope(current, args))
        return yield* operationConflict(
          operation,
          "scope_mismatch",
          "The publication pause row belongs to another tenant scope.",
        );
      const previousPauseEpoch = current?.pauseEpoch ?? 0;
      const pauseEpoch = previousPauseEpoch + 1;
      const active = yield* activePublicationLeasesForMutationEffect(
        pauseKey,
        21,
      );
      if (args.dryRun)
        return {
          operationKey: args.operationKey,
          receiptKey: null,
          pauseKey,
          scopeKey: args.scopeKey,
          previousPauseEpoch,
          pauseEpoch,
          state: "paused" as const,
          activeLeaseCount: active.length,
          dryRun: true,
        };
      const ctx = yield* MutationCtx;
      const row = {
        schemaVersion: 1 as const,
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        scopeKey: args.scopeKey,
        pauseKey,
        pauseEpoch,
        state: "paused" as const,
        reason: args.reason,
        pausedAt: args.now,
        resumedAt: null,
        updatedAt: args.now,
      };
      if (current === undefined)
        yield* Effect.promise(() =>
          rawDatabase(ctx).insert("brainPublicationPauses", row),
        );
      else
        yield* Effect.promise(() => rawDatabase(ctx).patch(current._id, row));
      const receiptKey = yield* insertOperationReceiptEffect({
        ...scope,
        operationKey: args.operationKey,
        operation,
        targetKind: "publication_workers",
        targetKey: pauseKey,
        expectedGeneration: previousPauseEpoch,
        resultGeneration: pauseEpoch,
        priorState: current?.state ?? "running",
        resultState: "paused",
        reason: args.reason,
        linkedEffectKey: null,
        now: args.now,
      });
      return {
        operationKey: args.operationKey,
        receiptKey,
        pauseKey,
        scopeKey: args.scopeKey,
        previousPauseEpoch,
        pauseEpoch,
        state: "paused" as const,
        activeLeaseCount: active.length,
        dryRun: false,
      };
    }),
);

const resumePublicationWorkersImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "resumePublicationWorkers",
  (args) =>
    Effect.gen(function* () {
      const operation = "resume_publication_workers" as const;
      const scope = {
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        scopeKey: args.scopeKey,
      };
      const pauseKey = publicationPauseKey(scope);
      const receipt = yield* loadOperationReceiptEffect(
        args.organizationKey,
        args.operationKey,
      );
      if (receipt !== null) {
        const mismatch = assertReceiptIdentity(receipt, {
          operation,
          workspaceId: args.workspaceId,
          brainKey: args.brainKey,
          scopeKey: args.scopeKey,
          targetKind: "publication_workers",
          targetKey: pauseKey,
        });
        if (mismatch !== null) return yield* mismatch;
        return {
          operationKey: args.operationKey,
          receiptKey: receipt.receiptKey,
          pauseKey,
          scopeKey: args.scopeKey,
          previousPauseEpoch: receipt.expectedGeneration ?? 0,
          pauseEpoch: receipt.resultGeneration ?? 0,
          state: "running" as const,
          activeLeaseCount: 0,
          dryRun: false,
        };
      }
      const { rows } = yield* loadPublicationPauseForMutationEffect(scope);
      const pause = rows[0];
      if (rows.length !== 1 || pause === undefined)
        return yield* operationConflict(
          operation,
          rows.length > 1 ? "integrity_conflict" : "target_not_found",
          "The exact publication pause row is unavailable.",
        );
      if (!exactScope(pause, args))
        return yield* operationConflict(
          operation,
          "scope_mismatch",
          "The publication pause row belongs to another tenant scope.",
        );
      if (pause.pauseEpoch !== args.expectedPauseEpoch)
        return yield* operationConflict(
          operation,
          "generation_changed",
          `Expected pause epoch ${args.expectedPauseEpoch}, found ${pause.pauseEpoch}.`,
        );
      if (pause.state !== "paused")
        return yield* operationConflict(
          operation,
          "state_changed",
          "The publication worker scope is not paused.",
        );
      const active = yield* activePublicationLeasesForMutationEffect(
        pauseKey,
        1,
      );
      if (active.length > 0)
        return yield* operationConflict(
          operation,
          "active_leases",
          "Publication worker leases must drain before resume.",
        );
      if (args.dryRun)
        return {
          operationKey: args.operationKey,
          receiptKey: null,
          pauseKey,
          scopeKey: args.scopeKey,
          previousPauseEpoch: pause.pauseEpoch,
          pauseEpoch: pause.pauseEpoch,
          state: "running" as const,
          activeLeaseCount: 0,
          dryRun: true,
        };
      const ctx = yield* MutationCtx;
      yield* Effect.promise(() =>
        rawDatabase(ctx).patch(pause._id, {
          state: "running",
          reason: null,
          resumedAt: args.now,
          updatedAt: args.now,
        }),
      );
      const receiptKey = yield* insertOperationReceiptEffect({
        ...scope,
        operationKey: args.operationKey,
        operation,
        targetKind: "publication_workers",
        targetKey: pauseKey,
        expectedGeneration: args.expectedPauseEpoch,
        resultGeneration: pause.pauseEpoch,
        priorState: "paused",
        resultState: "running",
        reason: args.reason,
        linkedEffectKey: null,
        now: args.now,
      });
      return {
        operationKey: args.operationKey,
        receiptKey,
        pauseKey,
        scopeKey: args.scopeKey,
        previousPauseEpoch: pause.pauseEpoch,
        pauseEpoch: pause.pauseEpoch,
        state: "running" as const,
        activeLeaseCount: 0,
        dryRun: false,
      };
    }),
);

const drainPublicationWorkerLeasesImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "drainPublicationWorkerLeases",
  (args) =>
    Effect.gen(function* () {
      const operation = "drain_publication_worker_leases";
      const scope = {
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        scopeKey: args.scopeKey,
      };
      const { pauseKey, rows } =
        yield* loadPublicationPauseForMutationEffect(scope);
      const pause = rows[0];
      if (rows.length !== 1 || pause === undefined)
        return yield* operationConflict(
          operation,
          rows.length > 1 ? "integrity_conflict" : "target_not_found",
          "The exact publication pause row is unavailable.",
        );
      if (!exactScope(pause, args))
        return yield* operationConflict(
          operation,
          "scope_mismatch",
          "The publication pause row belongs to another tenant scope.",
        );
      if (pause.pauseEpoch !== args.expectedPauseEpoch)
        return yield* operationConflict(
          operation,
          "generation_changed",
          `Expected pause epoch ${args.expectedPauseEpoch}, found ${pause.pauseEpoch}.`,
        );
      if (pause.state !== "paused")
        return yield* operationConflict(
          operation,
          "state_changed",
          "Worker leases may be drained only while the scope is paused.",
        );
      const active = yield* activePublicationLeasesForMutationEffect(
        pauseKey,
        args.batchSize + 1,
      );
      const selected = active.slice(0, args.batchSize);
      const hasMore = active.length > args.batchSize;
      if (!args.dryRun) {
        const ctx = yield* MutationCtx;
        for (const lease of selected)
          yield* Effect.promise(() =>
            rawDatabase(ctx).patch(lease._id, {
              state: "abandoned",
              releasedAt: args.now,
              releaseReason: lease.expiresAt <= args.now ? "expired" : "paused",
              updatedAt: args.now,
            }),
          );
      }
      return {
        pauseKey,
        scopeKey: args.scopeKey,
        pauseEpoch: pause.pauseEpoch,
        state: pause.state,
        drainedLeaseCount: selected.length,
        activeLeaseCount: hasMore ? 1 : 0,
        hasMore,
        dryRun: args.dryRun,
      };
    }),
);

const getPublicationWorkerLeaseStatusImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "getPublicationWorkerLeaseStatus",
  (args) =>
    Effect.gen(function* () {
      const operation = "get_publication_worker_lease_status";
      const scope = {
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        scopeKey: args.scopeKey,
      };
      const { pauseKey, rows } = yield* loadPublicationPauseEffect(scope);
      if (rows.length > 1)
        return yield* operationConflict(
          operation,
          "integrity_conflict",
          "More than one publication pause row exists for the scope.",
        );
      const pause = rows[0];
      if (pause !== undefined && !exactScope(pause, args))
        return yield* operationConflict(
          operation,
          "scope_mismatch",
          "The publication pause row belongs to another tenant scope.",
        );
      const active = yield* activePublicationLeasesEffect(pauseKey, 21);
      if (active.length > 20)
        return yield* operationConflict(
          operation,
          "capacity_exceeded",
          "The publication lease population exceeds the bounded status limit.",
        );
      return {
        pauseKey,
        scopeKey: args.scopeKey,
        pauseEpoch: pause?.pauseEpoch ?? 0,
        state: pause?.state ?? ("running" as const),
        activeLeaseCount: active.length,
        earliestLeaseExpiry:
          active.length === 0
            ? null
            : Math.min(...active.map(({ expiresAt }) => expiresAt)),
      };
    }),
);

const repairIngestionObligationImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "repairIngestionObligation",
  (args) =>
    Effect.gen(function* () {
      const operation = "repair_ingestion_obligation" as const;
      const receipt = yield* loadOperationReceiptEffect(
        args.organizationKey,
        args.operationKey,
      );
      if (receipt !== null) {
        const mismatch = assertReceiptIdentity(receipt, {
          operation,
          workspaceId: args.workspaceId,
          brainKey: args.brainKey,
          scopeKey: args.scopeKey,
          targetKind: "ingestion_obligation",
          targetKey: args.ingestionObligationKey,
        });
        if (mismatch !== null) return yield* mismatch;
        return {
          operationKey: args.operationKey,
          receiptKey: receipt.receiptKey,
          targetKind: "ingestion_obligation" as const,
          targetKey: args.ingestionObligationKey,
          mode: receipt.repairMode ?? "retry",
          priorState: receipt.priorState,
          resultState: receipt.resultState,
          repairEffectKey: receipt.linkedEffectKey,
          dryRun: false,
        };
      }
      const ctx = yield* MutationCtx;
      const rows = yield* Effect.promise(() =>
        rawDatabase(ctx)
          .query("ingestionObligations")
          .withIndex("by_ingestion_obligation_key", (query) =>
            query.eq("ingestionObligationKey", args.ingestionObligationKey),
          )
          .take(2),
      );
      const obligation = rows[0];
      if (rows.length !== 1 || obligation === undefined)
        return yield* operationConflict(
          operation,
          rows.length > 1 ? "integrity_conflict" : "target_not_found",
          "The exact ingestion obligation is unavailable.",
        );
      if (
        !exactScope(obligation, args) ||
        obligation.connectorScopeKey !== args.scopeKey
      )
        return yield* operationConflict(
          operation,
          "scope_mismatch",
          "The ingestion obligation belongs to another tenant scope.",
        );
      if (
        obligation.state !== "failed" &&
        obligation.state !== "quarantined" &&
        obligation.state !== "capacity_blocked"
      )
        return yield* operationConflict(
          operation,
          "effect_not_failed",
          `Ingestion obligation state ${obligation.state} is not repairable.`,
        );
      const priorReceipt = yield* existingTargetOperationReceiptEffect({
        targetKind: "ingestion_obligation",
        targetKey: args.ingestionObligationKey,
        operation,
        expectedGeneration: obligation.updatedAt,
      });
      if (priorReceipt !== null)
        return yield* operationConflict(
          operation,
          "effect_already_repaired",
          "This exact ingestion-obligation failure version already has an operation receipt.",
        );
      const resultState = "retry_wait" as const;
      const repairEffectKey = `irep_${sha256Hex(
        JSON.stringify({
          ingestionObligationKey: obligation.ingestionObligationKey,
          failureVersion: obligation.updatedAt,
          mode: args.mode,
        }),
      )}`;
      if (args.dryRun)
        return {
          operationKey: args.operationKey,
          receiptKey: null,
          targetKind: "ingestion_obligation" as const,
          targetKey: args.ingestionObligationKey,
          mode: args.mode,
          priorState: obligation.state,
          resultState,
          repairEffectKey,
          dryRun: true,
        };
      yield* Effect.promise(() =>
        rawDatabase(ctx).insert("ingestionObligationRepairEffects", {
          schemaVersion: 1,
          organizationKey: args.organizationKey,
          workspaceId: args.workspaceId,
          brainKey: args.brainKey,
          scopeKey: args.scopeKey,
          repairEffectKey,
          ingestionObligationKey: obligation.ingestionObligationKey,
          failureVersion: obligation.updatedAt,
          mode: args.mode,
          state: "queued",
          reason: args.reason,
          createdAt: args.now,
          updatedAt: args.now,
        }),
      );
      yield* Effect.promise(() =>
        rawDatabase(ctx).patch(obligation._id, {
          state: resultState,
          terminalAt: null,
          updatedAt: args.now,
        }),
      );
      const receiptKey = yield* insertOperationReceiptEffect({
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        scopeKey: args.scopeKey,
        operationKey: args.operationKey,
        operation,
        targetKind: "ingestion_obligation",
        targetKey: args.ingestionObligationKey,
        expectedGeneration: obligation.updatedAt,
        resultGeneration: args.now,
        priorState: obligation.state,
        resultState,
        reason: args.reason,
        repairMode: args.mode,
        linkedEffectKey: repairEffectKey,
        now: args.now,
      });
      return {
        operationKey: args.operationKey,
        receiptKey,
        targetKind: "ingestion_obligation" as const,
        targetKey: args.ingestionObligationKey,
        mode: args.mode,
        priorState: obligation.state,
        resultState,
        repairEffectKey,
        dryRun: false,
      };
    }),
);

const repairPublicationDeadLetterImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "repairPublicationDeadLetter",
  (args) =>
    Effect.gen(function* () {
      const operation = "repair_publication_dead_letter" as const;
      const receipt = yield* loadOperationReceiptEffect(
        args.organizationKey,
        args.operationKey,
      );
      if (receipt !== null) {
        const mismatch = assertReceiptIdentity(receipt, {
          operation,
          workspaceId: args.workspaceId,
          brainKey: args.brainKey,
          scopeKey: args.scopeKey,
          targetKind: "publication_job",
          targetKey: args.publicationJobKey,
        });
        if (mismatch !== null) return yield* mismatch;
        return {
          operationKey: args.operationKey,
          receiptKey: receipt.receiptKey,
          targetKind: "publication_job" as const,
          targetKey: args.publicationJobKey,
          mode: receipt.repairMode ?? "retry",
          priorState: receipt.priorState,
          resultState: receipt.resultState,
          repairEffectKey: receipt.linkedEffectKey,
          dryRun: false,
        };
      }
      const ctx = yield* MutationCtx;
      const rows = yield* Effect.promise(() =>
        rawDatabase(ctx)
          .query("retrievalPublicationJobs")
          .withIndex("by_job_key", (query) =>
            query.eq("jobKey", args.publicationJobKey),
          )
          .take(2),
      );
      const job = rows[0];
      if (rows.length !== 1 || job === undefined)
        return yield* operationConflict(
          operation,
          rows.length > 1 ? "integrity_conflict" : "target_not_found",
          "The exact publication job is unavailable.",
        );
      if (
        !exactScope(job, args) ||
        publicationScopeKeyForJob(job) !== args.scopeKey
      )
        return yield* operationConflict(
          operation,
          "scope_mismatch",
          "The publication dead letter belongs to another tenant scope.",
        );
      if (job.status !== "dead_letter")
        return yield* operationConflict(
          operation,
          "effect_not_failed",
          `Publication job state ${job.status} is not a dead letter.`,
        );
      if (job.healthFailureActive !== true)
        return yield* operationConflict(
          operation,
          "integrity_conflict",
          "The publication dead letter lacks an exact persisted health-failure attribution marker.",
        );
      const priorReceipt = yield* existingTargetOperationReceiptEffect({
        targetKind: "publication_job",
        targetKey: args.publicationJobKey,
        operation,
        expectedGeneration: job.updatedAt,
      });
      if (priorReceipt !== null)
        return yield* operationConflict(
          operation,
          "effect_already_repaired",
          "This exact publication dead-letter failure version already has an operation receipt.",
        );
      const resultState =
        args.mode === "retry" ? "retry_wait" : "repair_pending";
      if (args.dryRun)
        return {
          operationKey: args.operationKey,
          receiptKey: null,
          targetKind: "publication_job" as const,
          targetKey: args.publicationJobKey,
          mode: args.mode,
          priorState: job.status,
          resultState,
          repairEffectKey: null,
          dryRun: true,
        };
      let repairEffectKey: string | null = null;
      if (args.mode === "retry")
        yield* Effect.promise(() =>
          rawDatabase(ctx).patch(job._id, {
            status: "retry_wait",
            attemptCount: 0,
            nextAttemptAt: args.now,
            lastErrorTag: undefined,
            completedAt: undefined,
            updatedAt: args.now,
          }),
        );
      else {
        repairEffectKey = yield* enqueueAttributedPublicationRepairEffect({
          jobKey: job.jobKey,
          now: args.now,
        });
        if (repairEffectKey === null)
          return yield* operationConflict(
            operation,
            "integrity_conflict",
            "The dead letter lacks the exact authority required for attributed repair.",
          );
      }
      const receiptKey = yield* insertOperationReceiptEffect({
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        scopeKey: args.scopeKey,
        operationKey: args.operationKey,
        operation,
        targetKind: "publication_job",
        targetKey: args.publicationJobKey,
        expectedGeneration: job.updatedAt,
        resultGeneration: args.mode === "retry" ? args.now : job.updatedAt,
        priorState: job.status,
        resultState,
        reason: args.reason,
        repairMode: args.mode,
        linkedEffectKey: repairEffectKey,
        now: args.now,
      });
      return {
        operationKey: args.operationKey,
        receiptKey,
        targetKind: "publication_job" as const,
        targetKey: args.publicationJobKey,
        mode: args.mode,
        priorState: job.status,
        resultState,
        repairEffectKey,
        dryRun: false,
      };
    }),
);

const quarantineIngestionObligationImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "quarantineIngestionObligation",
  (args) =>
    Effect.gen(function* () {
      const operation = "quarantine_ingestion_obligation" as const;
      const receipt = yield* loadOperationReceiptEffect(
        args.organizationKey,
        args.operationKey,
      );
      if (receipt !== null) {
        const mismatch = assertReceiptIdentity(receipt, {
          operation,
          workspaceId: args.workspaceId,
          brainKey: args.brainKey,
          scopeKey: args.scopeKey,
          targetKind: "ingestion_obligation",
          targetKey: args.ingestionObligationKey,
        });
        if (mismatch !== null) return yield* mismatch;
        return {
          operationKey: args.operationKey,
          receiptKey: receipt.receiptKey,
          ingestionObligationKey: args.ingestionObligationKey,
          priorState: receipt.priorState,
          resultState: "quarantined" as const,
          reason: receipt.reason,
          dryRun: false,
        };
      }
      const ctx = yield* MutationCtx;
      const rows = yield* Effect.promise(() =>
        rawDatabase(ctx)
          .query("ingestionObligations")
          .withIndex("by_ingestion_obligation_key", (query) =>
            query.eq("ingestionObligationKey", args.ingestionObligationKey),
          )
          .take(2),
      );
      const obligation = rows[0];
      if (rows.length !== 1 || obligation === undefined)
        return yield* operationConflict(
          operation,
          rows.length > 1 ? "integrity_conflict" : "target_not_found",
          "The exact ingestion obligation is unavailable.",
        );
      if (
        !exactScope(obligation, args) ||
        obligation.connectorScopeKey !== args.scopeKey
      )
        return yield* operationConflict(
          operation,
          "scope_mismatch",
          "The ingestion obligation belongs to another tenant scope.",
        );
      if (
        obligation.state === "complete" ||
        obligation.state === "policy_excluded"
      )
        return yield* operationConflict(
          operation,
          "state_changed",
          `Ingestion obligation state ${obligation.state} is terminal.`,
        );
      if (args.dryRun)
        return {
          operationKey: args.operationKey,
          receiptKey: null,
          ingestionObligationKey: args.ingestionObligationKey,
          priorState: obligation.state,
          resultState: "quarantined" as const,
          reason: args.reason,
          dryRun: true,
        };
      yield* Effect.promise(() =>
        rawDatabase(ctx).patch(obligation._id, {
          state: "quarantined",
          errorTag: args.reason,
          terminalAt: null,
          updatedAt: args.now,
        }),
      );
      const receiptKey = yield* insertOperationReceiptEffect({
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        scopeKey: args.scopeKey,
        operationKey: args.operationKey,
        operation,
        targetKind: "ingestion_obligation",
        targetKey: args.ingestionObligationKey,
        expectedGeneration:
          obligation.runGeneration ?? obligation.connectionGeneration ?? null,
        resultGeneration:
          obligation.runGeneration ?? obligation.connectionGeneration ?? null,
        priorState: obligation.state,
        resultState: "quarantined",
        reason: args.reason,
        linkedEffectKey: args.ingestionObligationKey,
        now: args.now,
      });
      return {
        operationKey: args.operationKey,
        receiptKey,
        ingestionObligationKey: args.ingestionObligationKey,
        priorState: obligation.state,
        resultState: "quarantined" as const,
        reason: args.reason,
        dryRun: false,
      };
    }),
);

const decommissionableObligationStates = [
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
] as const satisfies readonly IngestionObligationDoc["state"][];

const decommissionRequiredScopeImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "decommissionRequiredScope",
  (args) =>
    Effect.gen(function* () {
      const operation = "decommission_required_scope" as const;
      const ctx = yield* MutationCtx;
      const intentRows = yield* Effect.promise(() =>
        rawDatabase(ctx)
          .query("brainRequiredScopeIntents")
          .withIndex("by_required_scope_intent_key", (query) =>
            query.eq("requiredScopeIntentKey", args.requiredScopeIntentKey),
          )
          .take(2),
      );
      const intent = intentRows[0];
      if (intentRows.length !== 1 || intent === undefined)
        return yield* operationConflict(
          operation,
          intentRows.length > 1 ? "integrity_conflict" : "target_not_found",
          "The exact required-scope intent is unavailable.",
        );
      if (
        !exactScope(intent, args) ||
        intent.connectorScopeKey !== args.scopeKey
      )
        return yield* operationConflict(
          operation,
          "scope_mismatch",
          "The required-scope intent belongs to another tenant scope.",
        );
      if (intent.intentGeneration !== args.expectedIntentGeneration)
        return yield* operationConflict(
          operation,
          "generation_changed",
          `Expected intent generation ${args.expectedIntentGeneration}, found ${intent.intentGeneration}.`,
        );
      if (
        intent.controllingConfigurationDigest !==
        args.expectedControllingConfigurationDigest
      )
        return yield* operationConflict(
          operation,
          "configuration_changed",
          "The required-scope controlling configuration digest changed.",
        );

      const receipt = yield* loadOperationReceiptEffect(
        args.organizationKey,
        args.operationKey,
      );
      if (receipt !== null) {
        const mismatch = assertReceiptIdentity(receipt, {
          operation,
          workspaceId: args.workspaceId,
          brainKey: args.brainKey,
          scopeKey: args.scopeKey,
          targetKind: "required_scope_intent",
          targetKey: args.requiredScopeIntentKey,
        });
        if (mismatch !== null) return yield* mismatch;
        if (
          receipt.expectedGeneration !== args.expectedIntentGeneration ||
          receipt.controllingConfigurationDigest !==
            args.expectedControllingConfigurationDigest ||
          receipt.approvedBy !== args.approvedBy
        )
          return yield* operationConflict(
            operation,
            "configuration_changed",
            "The decommission operation key is bound to different approval authority.",
          );
        if (intent.state === "decommissioned")
          return {
            operationKey: args.operationKey,
            receiptKey: receipt.receiptKey,
            requiredScopeIntentKey: args.requiredScopeIntentKey,
            intentGeneration: intent.intentGeneration,
            priorState: receipt.priorState as "required" | "decommissioned",
            resultState: "decommissioned" as const,
            excludedObligationCount: 0,
            hasMore: false,
            dryRun: false,
          };
      }
      if (intent.state !== "required") {
        const priorReceipt = yield* existingTargetOperationReceiptEffect({
          targetKind: "required_scope_intent",
          targetKey: args.requiredScopeIntentKey,
          operation,
          expectedGeneration: intent.intentGeneration,
        });
        return yield* operationConflict(
          operation,
          priorReceipt === null ? "state_changed" : "effect_already_repaired",
          priorReceipt === null
            ? "The required-scope intent is not active."
            : "The required-scope intent already has an immutable decommission receipt.",
        );
      }

      const candidates: IngestionObligationDoc[] = [];
      for (const state of decommissionableObligationStates) {
        if (candidates.length > args.batchSize) break;
        const remaining = args.batchSize + 1 - candidates.length;
        const rows = yield* Effect.promise(() =>
          rawDatabase(ctx)
            .query("ingestionObligations")
            .withIndex("by_required_intent_state", (query) =>
              query
                .eq("requiredScopeIntentKey", args.requiredScopeIntentKey)
                .eq("state", state),
            )
            .take(remaining),
        );
        candidates.push(...rows);
      }
      const selected = candidates.slice(0, args.batchSize);
      const hasMore = candidates.length > args.batchSize;
      const resultState = hasMore
        ? ("required" as const)
        : ("decommissioned" as const);
      if (args.dryRun)
        return {
          operationKey: args.operationKey,
          receiptKey: null,
          requiredScopeIntentKey: args.requiredScopeIntentKey,
          intentGeneration: intent.intentGeneration,
          priorState: intent.state,
          resultState,
          excludedObligationCount: selected.length,
          hasMore,
          dryRun: true,
        };

      const receiptKey =
        receipt?.receiptKey ??
        (yield* insertOperationReceiptEffect({
          organizationKey: args.organizationKey,
          workspaceId: args.workspaceId,
          brainKey: args.brainKey,
          scopeKey: args.scopeKey,
          operationKey: args.operationKey,
          operation,
          targetKind: "required_scope_intent",
          targetKey: args.requiredScopeIntentKey,
          expectedGeneration: args.expectedIntentGeneration,
          resultGeneration: intent.intentGeneration,
          controllingConfigurationDigest:
            args.expectedControllingConfigurationDigest,
          priorState: intent.state,
          resultState: "decommission_authorized",
          reason: args.reason,
          approvedBy: args.approvedBy,
          linkedEffectKey: args.requiredScopeIntentKey,
          now: args.now,
        }));

      for (const obligation of selected) {
        if (
          !exactScope(obligation, args) ||
          obligation.connectorScopeKey !== args.scopeKey
        )
          return yield* operationConflict(
            operation,
            "scope_mismatch",
            "A required-intent obligation belongs to another tenant scope.",
          );
        yield* Effect.promise(() =>
          rawDatabase(ctx).patch(obligation._id, {
            state: "policy_excluded",
            errorTag: null,
            terminalAt: args.now,
            updatedAt: args.now,
          }),
        );
      }

      if (!hasMore) {
        yield* Effect.promise(() =>
          rawDatabase(ctx).patch(intent._id, {
            state: "decommissioned",
            decommissionGeneration: intent.intentGeneration,
            decommissionedAt: args.now,
            updatedAt: args.now,
          }),
        );
      }
      return {
        operationKey: args.operationKey,
        receiptKey,
        requiredScopeIntentKey: args.requiredScopeIntentKey,
        intentGeneration: intent.intentGeneration,
        priorState: intent.state,
        resultState,
        excludedObligationCount: selected.length,
        hasMore,
        dryRun: false,
      };
    }),
);

const PROJECTION_VALIDATION_TTL_MS = 30 * 60 * 1_000;
const MAX_VALIDATION_PUBLICATION_SETS_PER_STATE = 50;
const MAX_VALIDATION_PUBLICATION_ENTRIES = 5_000;
const MAX_VALIDATION_PUBLICATION_TOKENS = RETRIEVAL_TOKEN_CATALOG_POSTING_LIMIT;
const MAX_VALIDATION_JOBS = 200;
const MAX_VALIDATION_ACTIVE_LEASES = 200;
const MAX_VALIDATION_ROWS_PER_OBLIGATION_STATE = 50;
const MAX_VALIDATION_REPAIR_EFFECTS_PER_STATE = 200;
const MAX_VALIDATION_SLACK_TARGET_INTENTS_PER_STATE = 50;

const validationObligationStates = [
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
] as const satisfies readonly IngestionObligationDoc["state"][];

const validationJobStates = [
  "pending",
  "retry_wait",
  "succeeded",
  "superseded",
  "revoked",
  "integrity_failure",
  "dead_letter",
] as const satisfies readonly RetrievalPublicationJobsDoc["status"][];

const validationBlockingJobStates = [
  "pending",
  "retry_wait",
  "integrity_failure",
  "dead_letter",
] as const satisfies readonly RetrievalPublicationJobsDoc["status"][];

const validationBlockingSlackTargetIntentStates = [
  "pending",
  "retry_wait",
] as const;
const validationBlockingProviderTargetIntentStates = [
  "pending",
  "retry_wait",
  "capacity_blocked",
  "integrity_failure",
] as const;

const readinessRejected = (
  operation: ProjectionReadinessRejected["operation"],
  reason: ProjectionReadinessRejected["reason"],
  detail: string,
) => new ProjectionReadinessRejected({ operation, reason, detail });

const serverProjectionBuildMetadata = () => {
  const env = readProcessEnv();
  const deploymentSha =
    env.MAESTRO_BRAIN_DEPLOYMENT_SHA?.trim() ||
    env.BUILDKITE_COMMIT?.trim() ||
    env.GITHUB_SHA?.trim() ||
    "local-development";
  return {
    deploymentSha,
    projectionSchemaVersion: "3" as const,
    projectionManifestVersion: "2" as const,
  };
};

const loadCurrentReadModeEffect = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
}) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const rows = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("brainReadModes")
        .withIndex("by_workspace_brain", (query) =>
          query
            .eq("workspaceId", input.workspaceId)
            .eq("brainKey", input.brainKey),
        )
        .take(2),
    );
    if (rows.length > 1 || rows.some((row) => !exactScope(row, input)))
      return yield* readinessRejected(
        "validate_brain_projection_readiness",
        "integrity_conflict",
        "The Brain read-mode row is duplicated or tenant-inconsistent.",
      );
    const row = rows[0];
    return {
      row: row ?? null,
      mode: row?.mode ?? ("compatibility" as const),
      modeGeneration: row?.modeGeneration ?? 0,
    };
  });

type ProjectionReceiptInsert = Omit<
  BrainProjectionValidationReceiptDoc,
  "_creationTime" | "_id"
>;

const projectionValidationReceiptFacts = (
  receipt: Omit<ProjectionReceiptInsert, "receiptDigest"> &
    Partial<Pick<ProjectionReceiptInsert, "receiptDigest">>,
) => ({
  schemaVersion: receipt.schemaVersion,
  receiptKey: receipt.receiptKey,
  organizationKey: receipt.organizationKey,
  workspaceId: String(receipt.workspaceId),
  brainKey: receipt.brainKey,
  deploymentSha: receipt.deploymentSha,
  projectionSchemaVersion: receipt.projectionSchemaVersion,
  projectionManifestVersion: receipt.projectionManifestVersion,
  validatedMode: receipt.validatedMode,
  validatedModeGeneration: receipt.validatedModeGeneration,
  projectionPopulationGeneration: receipt.projectionPopulationGeneration,
  subjectBackfillGeneration: receipt.subjectBackfillGeneration,
  subjectPopulationDigest: receipt.subjectPopulationDigest,
  subjectCompletionDigest: receipt.subjectCompletionDigest,
  fenceBackfillGeneration: receipt.fenceBackfillGeneration,
  fencePopulationDigest: receipt.fencePopulationDigest,
  fenceCompletionDigest: receipt.fenceCompletionDigest,
  publicationSetKeys: receipt.publicationSetKeys,
  currentPublicationSetCount: receipt.currentPublicationSetCount,
  retiredPublicationSetCount: receipt.retiredPublicationSetCount,
  publicationEntryCount: receipt.publicationEntryCount,
  publicationTokenCount: receipt.publicationTokenCount,
  publicationPopulationDigest: receipt.publicationPopulationDigest,
  requiredScopeCount: receipt.requiredScopeCount,
  requiredScopeManifest: receipt.requiredScopeManifest,
  requiredScopeManifestDigest: receipt.requiredScopeManifestDigest,
  obligationCount: receipt.obligationCount,
  obligationPopulationDigest: receipt.obligationPopulationDigest,
  publicationJobCount: receipt.publicationJobCount,
  publicationJobCounts: receipt.publicationJobCounts,
  publicationJobPopulationDigest: receipt.publicationJobPopulationDigest,
  unresolvedSlackTargetResolutionIntentCount:
    receipt.unresolvedSlackTargetResolutionIntentCount,
  unresolvedSlackTargetResolutionIntentPopulationDigest:
    receipt.unresolvedSlackTargetResolutionIntentPopulationDigest,
  activePublicationLeaseCount: receipt.activePublicationLeaseCount,
  repairEffectCount: receipt.repairEffectCount,
  repairEffectPopulationDigest: receipt.repairEffectPopulationDigest,
  readinessSnapshotDigest: receipt.readinessSnapshotDigest,
  issuedAt: receipt.issuedAt,
  expiresAt: receipt.expiresAt,
});

const canonicalReceiptJson = (value: unknown): string => {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value))
    return `[${value.map(canonicalReceiptJson).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalReceiptJson(record[key])}`)
    .join(",")}}`;
};

export const projectionValidationReceiptDigest = (
  receipt: Omit<ProjectionReceiptInsert, "receiptDigest"> &
    Partial<Pick<ProjectionReceiptInsert, "receiptDigest">>,
): string =>
  `sha256:${sha256Hex(
    canonicalReceiptJson(projectionValidationReceiptFacts(receipt)),
  )}`;

const loadProjectionValidationReceiptEffect = (receiptKey: string) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const rows = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("brainProjectionValidationReceipts")
        .withIndex("by_receipt_key", (query) =>
          query.eq("receiptKey", receiptKey),
        )
        .take(2),
    );
    if (rows.length > 1)
      return yield* readinessRejected(
        "switch_brain_read_mode",
        "integrity_conflict",
        "More than one projection-validation receipt owns the receipt key.",
      );
    return rows[0] ?? null;
  });

const collectProjectionReadinessSnapshotEffect = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const operation = "validate_brain_projection_readiness" as const;
    const mode = yield* loadCurrentReadModeEffect(input);
    if (mode.mode === "projection")
      return yield* readinessRejected(
        operation,
        "mode_changed",
        "Projection validation requires compatibility or disabled mode; found projection.",
      );
    const populationBefore = yield* loadPopulationEffect(input).pipe(
      Effect.mapError((error) =>
        readinessRejected(operation, "integrity_conflict", error.detail),
      ),
    );
    if (populationBefore === null)
      return yield* readinessRejected(
        operation,
        "not_ready",
        "The Brain has no projection-population fence.",
      );
    const subjectCompletion = populationBefore.legacySubjectBackfillCompletion;
    const fenceCompletion =
      populationBefore.legacyEligibilityFenceBackfillCompletion;
    if (
      subjectCompletion === null ||
      fenceCompletion === null ||
      populationBefore.subjectBackfillGeneration < 1 ||
      populationBefore.fenceBackfillGeneration < 1 ||
      subjectCompletion.subjectBackfillGeneration !==
        populationBefore.subjectBackfillGeneration ||
      fenceCompletion.fenceBackfillGeneration !==
        populationBefore.fenceBackfillGeneration ||
      populationBefore.conflictCount !== 0 ||
      populationBefore.fenceConflictCount !== 0 ||
      populationBefore.capacityCount !== 0
    )
      return yield* readinessRejected(
        operation,
        "not_ready",
        "Projection subject/fence backfill completion is absent or stale.",
      );

    const mutationCtx = yield* MutationCtx;
    const status = yield* evaluateBrainRolloutStatusEffect(input).pipe(
      Effect.provideService(QueryCtx, mutationCtx),
      Effect.mapError((error) =>
        readinessRejected(
          operation,
          error._tag === "RolloutStatusCapacityExceeded"
            ? "capacity_exceeded"
            : "integrity_conflict",
          error._tag === "RolloutStatusCapacityExceeded"
            ? `Rollout status exceeded ${error.resource} capacity ${error.limit}.`
            : error.detail,
        ),
      ),
    );
    if (!status.promotionReady)
      return yield* readinessRejected(
        operation,
        "not_ready",
        `Rollout status is blocked: ${status.scopes
          .flatMap(({ blockers }) => blockers)
          .join(",")}.`,
      );

    const reader = yield* DatabaseReader;
    const unresolvedProviderTargetResolutionIntentFacts: Array<{
      readonly targetResolutionIntentKey: string;
      readonly connectorScopeKey: string;
      readonly connectionGeneration: number;
      readonly status:
        "pending" | "retry_wait" | "capacity_blocked" | "integrity_failure";
      readonly attemptCount: number;
      readonly nextAttemptAt: number;
      readonly updatedAt: number;
    }> = [];
    for (const scope of status.scopes) {
      for (const intentStatus of validationBlockingProviderTargetIntentStates) {
        const rows = yield* reader
          .table("providerTargetResolutionIntents")
          .index("by_scope_status_due_intent", (query) =>
            query
              .eq("organizationKey", input.organizationKey)
              .eq("connectorScopeKey", scope.connectorScopeKey)
              .eq(
                "connectionGeneration",
                scope.configuration.connectionGeneration,
              )
              .eq("status", intentStatus),
          )
          .take(MAX_VALIDATION_SLACK_TARGET_INTENTS_PER_STATE + 1)
          .pipe(Effect.orDie);
        if (rows.length > MAX_VALIDATION_SLACK_TARGET_INTENTS_PER_STATE)
          return yield* readinessRejected(
            operation,
            "capacity_exceeded",
            `Scope ${scope.connectorScopeKey} exceeds provider target-resolution validation capacity.`,
          );
        if (
          rows.some(
            (row) =>
              row.organizationKey !== input.organizationKey ||
              row.connectorScopeKey !== scope.connectorScopeKey ||
              row.connectionGeneration !==
                scope.configuration.connectionGeneration ||
              row.status !== intentStatus,
          )
        )
          return yield* readinessRejected(
            operation,
            "integrity_conflict",
            `Scope ${scope.connectorScopeKey} owns a cross-scope provider target-resolution intent.`,
          );
        unresolvedProviderTargetResolutionIntentFacts.push(
          ...rows.map((row) => ({
            targetResolutionIntentKey: row.targetResolutionIntentKey,
            connectorScopeKey: row.connectorScopeKey,
            connectionGeneration: row.connectionGeneration,
            status: row.status as
              | "pending"
              | "retry_wait"
              | "capacity_blocked"
              | "integrity_failure",
            attemptCount: row.attemptCount,
            nextAttemptAt: row.nextAttemptAt,
            updatedAt: row.updatedAt,
          })),
        );
      }
    }
    unresolvedProviderTargetResolutionIntentFacts.sort((left, right) =>
      left.targetResolutionIntentKey.localeCompare(
        right.targetResolutionIntentKey,
      ),
    );
    if (unresolvedProviderTargetResolutionIntentFacts.length !== 0)
      return yield* readinessRejected(
        operation,
        "not_ready",
        "A provider target-resolution intent remains unresolved.",
      );
    const unresolvedSlackTargetResolutionIntentFacts: Array<{
      readonly receiptId: string;
      readonly channelKey: string;
      readonly sourceRevisionKey: string;
      readonly status: "pending" | "retry_wait";
      readonly attemptCount: number;
      readonly nextAttemptAt: number;
      readonly updatedAt: number;
    }> = [];
    for (const scope of status.scopes.filter(
      ({ providerKind }) => providerKind === "slack",
    )) {
      for (const intentStatus of validationBlockingSlackTargetIntentStates) {
        const rows = yield* reader
          .table("slackPublicationTargetIntents")
          .index("by_organization_channel_status", (query) =>
            query
              .eq("organizationKey", input.organizationKey)
              .eq("channelKey", scope.connectorScopeKey)
              .eq("status", intentStatus),
          )
          .take(MAX_VALIDATION_SLACK_TARGET_INTENTS_PER_STATE + 1)
          .pipe(Effect.orDie);
        if (rows.length > MAX_VALIDATION_SLACK_TARGET_INTENTS_PER_STATE)
          return yield* readinessRejected(
            operation,
            "capacity_exceeded",
            `Slack scope ${scope.connectorScopeKey} exceeds target-resolution intent validation capacity.`,
          );
        if (
          rows.some(
            (row) =>
              row.organizationKey !== input.organizationKey ||
              row.channelKey !== scope.connectorScopeKey ||
              row.status !== intentStatus,
          )
        )
          return yield* readinessRejected(
            operation,
            "integrity_conflict",
            `Slack scope ${scope.connectorScopeKey} owns a cross-scope target-resolution intent.`,
          );
        unresolvedSlackTargetResolutionIntentFacts.push(
          ...rows.map((row) => ({
            receiptId: String(row.receiptId),
            channelKey: row.channelKey,
            sourceRevisionKey: row.sourceRevisionKey,
            status: row.status as "pending" | "retry_wait",
            attemptCount: row.attemptCount,
            nextAttemptAt: row.nextAttemptAt,
            updatedAt: row.updatedAt,
          })),
        );
      }
    }
    unresolvedSlackTargetResolutionIntentFacts.sort((left, right) =>
      left.receiptId.localeCompare(right.receiptId),
    );
    if (unresolvedSlackTargetResolutionIntentFacts.length !== 0)
      return yield* readinessRejected(
        operation,
        "not_ready",
        "A Slack publication target-resolution intent remains pending or retryable.",
      );
    const publicationPages = yield* Effect.all(
      (["current", "retired"] as const).map((state) =>
        reader
          .table("retrievalPublicationSets")
          .index("by_workspace_brain_state_publication_set", (query) =>
            query
              .eq("workspaceId", input.workspaceId)
              .eq("brainKey", input.brainKey)
              .eq("state", state),
          )
          .take(MAX_VALIDATION_PUBLICATION_SETS_PER_STATE + 1)
          .pipe(Effect.orDie),
      ),
    );
    if (
      publicationPages.some(
        (rows) => rows.length > MAX_VALIDATION_PUBLICATION_SETS_PER_STATE,
      )
    )
      return yield* readinessRejected(
        operation,
        "capacity_exceeded",
        "The retained publication population exceeds the atomic validation capacity.",
      );
    const publicationSets = publicationPages
      .flat()
      .filter(isRetainedPublicationSet)
      .sort((left, right) =>
        left.publicationSetKey.localeCompare(right.publicationSetKey),
      );
    if (
      publicationSets.length === 0 ||
      publicationSets.some((set) => !exactScope(set, input))
    )
      return yield* readinessRejected(
        operation,
        "integrity_conflict",
        "The retained publication population is empty or tenant-inconsistent.",
      );

    let publicationEntryCount = 0;
    let publicationTokenCount = 0;
    const currentPublicationTokens: RetrievalTokensDoc[] = [];
    const publicationFacts: Array<{
      readonly publicationSetKey: string;
      readonly state: "current" | "retired";
      readonly setDigest: string;
      readonly fenceManifestDigest: string | null;
      readonly citationInvalidationDigest: string | null;
    }> = [];
    for (const set of publicationSets) {
      if (hasValidCitationInvalidationReceipt(set)) {
        publicationFacts.push({
          publicationSetKey: set.publicationSetKey,
          state: set.state,
          setDigest: digest({
            publicationSetKey: set.publicationSetKey,
            publicationGeneration: set.publicationGeneration,
            state: set.state,
            citationInvalidationReceipt: set.citationInvalidationReceipt,
          }),
          fenceManifestDigest: null,
          citationInvalidationDigest:
            set.citationInvalidationReceipt?.receiptDigest ?? null,
        });
        continue;
      }
      const integrity = yield* validatePublicationSetIntegrityEffect(set, {
        entryLimit: Math.min(
          MAX_PUBLICATION_ENTRY_ROWS,
          MAX_VALIDATION_PUBLICATION_ENTRIES - publicationEntryCount,
        ),
        tokenLimit: Math.min(
          MAX_PUBLICATION_TOKEN_ROWS,
          MAX_VALIDATION_PUBLICATION_TOKENS - publicationTokenCount,
        ),
      });
      if (integrity.kind === "capacity")
        return yield* readinessRejected(
          operation,
          "capacity_exceeded",
          `Publication ${set.publicationSetKey} exceeds retained-history, entry, or token capacity.`,
        );
      if (integrity.report.issues.length > 0)
        return yield* readinessRejected(
          operation,
          "integrity_conflict",
          `Publication ${set.publicationSetKey} failed integrity: ${integrity.report.issues
            .map(({ code }) => code)
            .join(",")}.`,
        );
      const manifest = yield* resolveRequiredEligibilityManifestEffect(
        set,
        input.now,
        false,
      );
      if (
        manifest.kind !== "resolved" ||
        set.eligibilityFences === undefined ||
        !sameFenceManifest(set.eligibilityFences, manifest.refs)
      )
        return yield* readinessRejected(
          operation,
          "integrity_conflict",
          `Publication ${set.publicationSetKey} has an incomplete or stale required eligibility manifest.`,
        );
      publicationEntryCount += integrity.report.entryCount;
      publicationTokenCount += integrity.report.tokenCount;
      if (set.state === "current")
        currentPublicationTokens.push(...integrity.tokens);
      publicationFacts.push({
        publicationSetKey: set.publicationSetKey,
        state: set.state,
        setDigest: integrity.report.setDigest,
        fenceManifestDigest: manifest.digest,
        citationInvalidationDigest: null,
      });
    }

    if (
      currentPublicationTokens.some(
        (token) =>
          token.organizationKey !== input.organizationKey ||
          token.workspaceId !== input.workspaceId ||
          token.brainKey !== input.brainKey ||
          token.tokenizerVersion !== 1 ||
          token.publicationState !== "current",
      )
    )
      return yield* readinessRejected(
        operation,
        "integrity_conflict",
        "The current retrieval-token population is unclassified or tenant-inconsistent.",
      );
    const catalogRows = yield* reader
      .table("retrievalTokenCatalog")
      .index("by_workspace_brain_token", (query) =>
        query
          .eq("workspaceId", input.workspaceId)
          .eq("brainKey", input.brainKey),
      )
      .take(MAX_VALIDATION_PUBLICATION_TOKENS + 1)
      .pipe(Effect.orDie);
    if (catalogRows.length > MAX_VALIDATION_PUBLICATION_TOKENS)
      return yield* readinessRejected(
        operation,
        "capacity_exceeded",
        "The retrieval-token catalog exceeds atomic validation capacity.",
      );
    const postingsByToken = new Map<string, RetrievalTokensDoc[]>();
    for (const posting of currentPublicationTokens)
      postingsByToken.set(posting.token, [
        ...(postingsByToken.get(posting.token) ?? []),
        posting,
      ]);
    const catalogByToken = new Map<string, (typeof catalogRows)[number]>();
    for (const catalog of catalogRows) {
      if (
        catalogByToken.has(catalog.token) ||
        catalog.organizationKey !== input.organizationKey ||
        catalog.workspaceId !== input.workspaceId ||
        catalog.brainKey !== input.brainKey ||
        catalog.tokenizerVersion !== 1 ||
        !retrievalTokenCatalogIsConsistent(catalog)
      )
        return yield* readinessRejected(
          operation,
          "integrity_conflict",
          `Retrieval-token catalog ${catalog.token} is duplicate, corrupt, or tenant-inconsistent.`,
        );
      catalogByToken.set(catalog.token, catalog);
    }
    if (
      catalogByToken.size !== postingsByToken.size ||
      [...catalogByToken.keys()].some((token) => !postingsByToken.has(token))
    )
      return yield* readinessRejected(
        operation,
        "integrity_conflict",
        "The retrieval-token catalog has missing or orphan token rows.",
      );
    const catalogFacts = [];
    for (const [token, postings] of [...postingsByToken].sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const catalog = catalogByToken.get(token);
      const projection = retrievalTokenCatalogProjection(postings);
      if (
        catalog === undefined ||
        catalog.expectedPostingCount !== projection.expectedPostingCount ||
        catalog.expectedPostingDigest !== projection.expectedPostingDigest
      )
        return yield* readinessRejected(
          operation,
          "integrity_conflict",
          `Retrieval-token catalog ${token} does not match current postings.`,
        );
      catalogFacts.push({
        token,
        expectedPostingCount: catalog.expectedPostingCount,
        expectedPostingDigest: catalog.expectedPostingDigest,
      });
    }

    const requiredScopeManifest = yield* Effect.forEach(
      [...status.scopes].sort((left, right) =>
        left.requiredScopeIntentKey.localeCompare(right.requiredScopeIntentKey),
      ),
      (scope) =>
        Effect.gen(function* () {
          const healthRows = yield* reader
            .table("brainCorpusHealth")
            .index("by_workspace_brain_corpus_scope", (query) =>
              query
                .eq("workspaceId", input.workspaceId)
                .eq("brainKey", input.brainKey)
                .eq("corpusKey", scope.corpusKey)
                .eq("connectorScopeKey", scope.connectorScopeKey),
            )
            .take(2)
            .pipe(Effect.orDie);
          const health = healthRows[0];
          if (
            healthRows.length !== 1 ||
            health === undefined ||
            !exactScope(health, input) ||
            scope.reconciliation.runKey === null ||
            scope.reconciliation.runGeneration === null ||
            scope.reconciliation.ledgerHighWater === null ||
            scope.reconciliation.completionDigest === null ||
            scope.health.lastObservedAt === null ||
            scope.health.lastPublishedAt === null ||
            scope.health.lastReconciledAt === null
          )
            return yield* readinessRejected(
              operation,
              "integrity_conflict",
              `Required scope ${scope.requiredScopeIntentKey} lacks an exact health or reconciliation fence.`,
            );
          return {
            requiredScopeIntentKey: scope.requiredScopeIntentKey,
            intentGeneration: scope.intentGeneration,
            corpusKey: scope.corpusKey,
            providerKind: scope.providerKind,
            connectorScopeKey: scope.connectorScopeKey,
            connectionKey: scope.configuration.connectionKey,
            connectionGeneration: scope.configuration.connectionGeneration,
            allowlistGeneration: scope.configuration.allowlistGeneration,
            controllingConfigurationDigest:
              scope.configuration.controllingConfigurationDigest,
            reconciliationRunKey: scope.reconciliation.runKey,
            reconciliationRunGeneration: scope.reconciliation.runGeneration,
            reconciliationProviderHighWater:
              scope.reconciliation.providerHighWater,
            reconciliationLedgerHighWater: scope.reconciliation.ledgerHighWater,
            reconciliationCompletionDigest:
              scope.reconciliation.completionDigest,
            rebuildRunKey: scope.rebuild.runKey,
            rebuildRunGeneration: scope.rebuild.runGeneration,
            rebuildLedgerHighWater: scope.rebuild.ledgerHighWater,
            rebuildCatchupHighWater: scope.rebuild.catchupHighWater,
            rebuildCompletionDigest: scope.rebuild.completionDigest,
            healthUpdatedAt: health.updatedAt,
            lastObservedAt: scope.health.lastObservedAt,
            lastPublishedAt: scope.health.lastPublishedAt,
            lastReconciledAt: scope.health.lastReconciledAt,
            obligationCounts: scope.obligations.counts.map(
              ({ state, count }) => ({ state, count }),
            ),
            publicationJobCounts: scope.publication.counts.map(
              ({ state, count }) => ({ state, count }),
            ),
          };
        }),
      { concurrency: 1 },
    );

    const obligationFacts: Array<{
      readonly ingestionObligationKey: string;
      readonly requiredScopeIntentKey: string;
      readonly state: IngestionObligationDoc["state"];
      readonly runGeneration: number | null;
      readonly ledgerSequence: number;
      readonly updatedAt: number;
      readonly publicationJobKeys: readonly string[];
    }> = [];
    for (const scope of requiredScopeManifest) {
      for (const state of validationObligationStates) {
        const rows = yield* reader
          .table("ingestionObligations")
          .index("by_required_intent_state", (query) =>
            query
              .eq("requiredScopeIntentKey", scope.requiredScopeIntentKey)
              .eq("state", state),
          )
          .take(MAX_VALIDATION_ROWS_PER_OBLIGATION_STATE + 1)
          .pipe(Effect.orDie);
        if (rows.length > MAX_VALIDATION_ROWS_PER_OBLIGATION_STATE)
          return yield* readinessRejected(
            operation,
            "capacity_exceeded",
            `Required scope ${scope.requiredScopeIntentKey} exceeds obligation validation capacity.`,
          );
        if (
          rows.some(
            (row) =>
              !exactScope(row, input) ||
              row.requiredScopeIntentKey !== scope.requiredScopeIntentKey ||
              row.connectorScopeKey !== scope.connectorScopeKey ||
              row.connectionKey !== scope.connectionKey ||
              row.connectionGeneration !== scope.connectionGeneration ||
              row.allowlistGeneration !== scope.allowlistGeneration,
          )
        )
          return yield* readinessRejected(
            operation,
            "integrity_conflict",
            `Required scope ${scope.requiredScopeIntentKey} owns a cross-scope obligation.`,
          );
        obligationFacts.push(
          ...rows.map((row) => ({
            ingestionObligationKey: row.ingestionObligationKey,
            requiredScopeIntentKey: scope.requiredScopeIntentKey,
            state: row.state,
            runGeneration: row.runGeneration ?? null,
            ledgerSequence: row.ledgerSequence,
            updatedAt: row.updatedAt,
            publicationJobKeys: [...row.publicationJobKeys].sort(),
          })),
        );
      }
    }
    obligationFacts.sort((left, right) =>
      left.ingestionObligationKey.localeCompare(right.ingestionObligationKey),
    );

    const jobPages = yield* Effect.all(
      validationBlockingJobStates.map((status) =>
        reader
          .table("retrievalPublicationJobs")
          .index("by_organization_workspace_brain_status", (query) =>
            query
              .eq("organizationKey", input.organizationKey)
              .eq("workspaceId", input.workspaceId)
              .eq("brainKey", input.brainKey)
              .eq("status", status),
          )
          .take(MAX_VALIDATION_JOBS + 1),
      ),
    ).pipe(Effect.orDie);
    const jobs = jobPages
      .flatMap((rows) => rows)
      .filter((job) => exactScope(job, input));
    if (
      jobPages.some((rows) => rows.length > MAX_VALIDATION_JOBS) ||
      jobs.length > MAX_VALIDATION_JOBS
    )
      return yield* readinessRejected(
        operation,
        "capacity_exceeded",
        "The publication-job population exceeds atomic validation capacity.",
      );
    const ctx = yield* MutationCtx;
    const activePublicationLeases = yield* Effect.promise(() =>
      rawDatabase(ctx)
        .query("brainPublicationWorkerLeases")
        .withIndex("by_organization_workspace_brain_state", (query) =>
          query
            .eq("organizationKey", input.organizationKey)
            .eq("workspaceId", input.workspaceId)
            .eq("brainKey", input.brainKey)
            .eq("state", "active"),
        )
        .take(MAX_VALIDATION_ACTIVE_LEASES + 1),
    );
    if (activePublicationLeases.length > MAX_VALIDATION_ACTIVE_LEASES)
      return yield* readinessRejected(
        operation,
        "capacity_exceeded",
        "The active publication-lease population exceeds atomic validation capacity.",
      );
    if (activePublicationLeases.some((lease) => !exactScope(lease, input)))
      return yield* readinessRejected(
        operation,
        "integrity_conflict",
        "The active publication-lease population contains a cross-tenant row.",
      );
    if (activePublicationLeases.length !== 0)
      return yield* readinessRejected(
        operation,
        "not_ready",
        "Publication worker leases must be fully drained.",
      );
    if (jobs.length !== 0)
      return yield* readinessRejected(
        operation,
        "not_ready",
        "A publication job remains pending, retryable, failed, or dead-lettered.",
      );
    const publicationJobCounts = validationJobStates.map((state) => ({
      state,
      count: jobs.filter((job) => job.status === state).length,
    }));
    const publicationJobFacts = jobs
      .map((job) => ({
        jobKey: job.jobKey,
        status: job.status,
        requestGeneration: job.requestGeneration,
        authorityDigest: job.authorityDigest ?? null,
        attemptCount: job.attemptCount,
        nextAttemptAt: job.nextAttemptAt,
        updatedAt: job.updatedAt,
      }))
      .sort((left, right) => left.jobKey.localeCompare(right.jobKey));

    const repairStates = ["queued", "running", "succeeded", "failed"] as const;
    const repairEffects: IngestionObligationRepairEffectDoc[] = [];
    for (const state of repairStates) {
      const rows = yield* Effect.promise(() =>
        rawDatabase(ctx)
          .query("ingestionObligationRepairEffects")
          .withIndex("by_organization_workspace_brain_state_updated", (query) =>
            query
              .eq("organizationKey", input.organizationKey)
              .eq("workspaceId", input.workspaceId)
              .eq("brainKey", input.brainKey)
              .eq("state", state),
          )
          .take(MAX_VALIDATION_REPAIR_EFFECTS_PER_STATE + 1),
      );
      if (rows.length > MAX_VALIDATION_REPAIR_EFFECTS_PER_STATE)
        return yield* readinessRejected(
          operation,
          "capacity_exceeded",
          "The repair-effect population exceeds bounded validation capacity.",
        );
      if (rows.some((row) => !exactScope(row, input)))
        return yield* readinessRejected(
          operation,
          "integrity_conflict",
          "The repair-effect population contains a cross-tenant row.",
        );
      repairEffects.push(...rows);
    }
    if (repairEffects.some(({ state }) => state !== "succeeded"))
      return yield* readinessRejected(
        operation,
        "not_ready",
        "An ingestion repair effect remains queued, running, or failed.",
      );
    const repairEffectFacts = repairEffects
      .map((effect) => ({
        repairEffectKey: effect.repairEffectKey,
        ingestionObligationKey: effect.ingestionObligationKey,
        failureVersion: effect.failureVersion,
        state: effect.state,
        updatedAt: effect.updatedAt,
      }))
      .sort((left, right) =>
        left.repairEffectKey.localeCompare(right.repairEffectKey),
      );

    const populationAfter = yield* loadPopulationEffect(input).pipe(
      Effect.mapError((error) =>
        readinessRejected(operation, "integrity_conflict", error.detail),
      ),
    );
    if (
      populationAfter === null ||
      populationAfter.projectionPopulationGeneration !==
        populationBefore.projectionPopulationGeneration
    )
      return yield* readinessRejected(
        operation,
        "population_changed",
        "The projection population advanced during readiness validation.",
      );

    const publicationPopulationDigest = digest({
      kind: "projection_validation_publications",
      sets: publicationFacts,
      catalog: catalogFacts,
    });
    const requiredScopeManifestDigest = digest({
      kind: "projection_validation_required_scopes",
      scopes: requiredScopeManifest,
    });
    const obligationPopulationDigest = digest({
      kind: "projection_validation_obligations",
      obligations: obligationFacts,
    });
    const publicationJobPopulationDigest = digest({
      kind: "projection_validation_jobs",
      jobs: publicationJobFacts,
    });
    const unresolvedSlackTargetResolutionIntentPopulationDigest = digest({
      kind: "projection_validation_slack_target_resolution_intents",
      intents: [
        ...unresolvedProviderTargetResolutionIntentFacts,
        ...unresolvedSlackTargetResolutionIntentFacts,
      ],
    });
    const repairEffectPopulationDigest = digest({
      kind: "projection_validation_repairs",
      repairs: repairEffectFacts,
    });
    const snapshot = {
      validatedMode: mode.mode,
      validatedModeGeneration: mode.modeGeneration,
      projectionPopulationGeneration:
        populationBefore.projectionPopulationGeneration,
      subjectBackfillGeneration: populationBefore.subjectBackfillGeneration,
      subjectPopulationDigest: subjectCompletion.populationDigest,
      subjectCompletionDigest: subjectCompletion.completionDigest,
      fenceBackfillGeneration: populationBefore.fenceBackfillGeneration,
      fencePopulationDigest: fenceCompletion.populationDigest,
      fenceCompletionDigest: fenceCompletion.completionDigest,
      publicationSetKeys: publicationFacts.map(
        ({ publicationSetKey }) => publicationSetKey,
      ),
      currentPublicationSetCount: publicationSets.filter(
        ({ state }) => state === "current",
      ).length,
      retiredPublicationSetCount: publicationSets.filter(
        ({ state }) => state === "retired",
      ).length,
      publicationEntryCount,
      publicationTokenCount,
      publicationPopulationDigest,
      requiredScopeCount: requiredScopeManifest.length,
      requiredScopeManifest,
      requiredScopeManifestDigest,
      obligationCount: obligationFacts.length,
      obligationPopulationDigest,
      publicationJobCount: jobs.length,
      publicationJobCounts,
      publicationJobPopulationDigest,
      unresolvedSlackTargetResolutionIntentCount: 0 as const,
      unresolvedSlackTargetResolutionIntentPopulationDigest,
      activePublicationLeaseCount: 0 as const,
      repairEffectCount: repairEffects.length,
      repairEffectPopulationDigest,
    };
    return {
      ...snapshot,
      readinessSnapshotDigest: digest({
        kind: "projection_validation_snapshot",
        snapshot,
      }),
    };
  });

const validateBrainProjectionReadinessImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "validateBrainProjectionReadiness",
  (args) =>
    Effect.gen(function* () {
      const issuedAt = yield* Clock.currentTimeMillis;
      const expiresAt = issuedAt + PROJECTION_VALIDATION_TTL_MS;
      const metadata = serverProjectionBuildMetadata();
      const snapshot = yield* collectProjectionReadinessSnapshotEffect({
        ...args,
        now: issuedAt,
      });
      const receiptKey = `bpvr_${sha256Hex(
        JSON.stringify({
          organizationKey: args.organizationKey,
          workspaceId: String(args.workspaceId),
          brainKey: args.brainKey,
          deploymentSha: metadata.deploymentSha,
          readinessSnapshotDigest: snapshot.readinessSnapshotDigest,
          issuedAt,
          expiresAt,
        }),
      )}`;
      const withoutDigest = {
        schemaVersion: 1 as const,
        receiptKey,
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        ...metadata,
        ...snapshot,
        issuedAt,
        expiresAt,
        consumedAt: null,
        consumedModeGeneration: null,
      };
      const receiptDigest = projectionValidationReceiptDigest(withoutDigest);
      const ctx = yield* MutationCtx;
      const existing = yield* Effect.promise(() =>
        rawDatabase(ctx)
          .query("brainProjectionValidationReceipts")
          .withIndex("by_receipt_key", (query) =>
            query.eq("receiptKey", receiptKey),
          )
          .take(2),
      );
      if (existing.length !== 0)
        return yield* readinessRejected(
          "validate_brain_projection_readiness",
          "integrity_conflict",
          "The deterministic projection-validation receipt key already exists.",
        );
      yield* Effect.promise(() =>
        rawDatabase(ctx).insert("brainProjectionValidationReceipts", {
          ...withoutDigest,
          receiptDigest,
        }),
      );
      return {
        receiptKey,
        ...metadata,
        validatedMode: snapshot.validatedMode,
        validatedModeGeneration: snapshot.validatedModeGeneration,
        projectionPopulationGeneration: snapshot.projectionPopulationGeneration,
        publicationPopulationDigest: snapshot.publicationPopulationDigest,
        requiredScopeManifestDigest: snapshot.requiredScopeManifestDigest,
        issuedAt,
        expiresAt,
        receiptDigest,
      };
    }),
);

const switchBrainReadModeImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "switchBrainReadMode",
  (args) =>
    Effect.gen(function* () {
      const operation = "switch_brain_read_mode" as const;
      const receipt = yield* loadProjectionValidationReceiptEffect(
        args.receiptKey,
      );
      if (receipt === null)
        return yield* readinessRejected(
          operation,
          "receipt_not_found",
          "The projection-validation receipt does not exist.",
        );
      if (
        receipt.organizationKey !== args.organizationKey ||
        receipt.workspaceId !== args.workspaceId ||
        receipt.brainKey !== args.brainKey
      )
        return yield* readinessRejected(
          operation,
          "receipt_scope_mismatch",
          "The receipt is bound to a different organization, workspace, or Brain.",
        );
      if (receipt.receiptDigest !== projectionValidationReceiptDigest(receipt))
        return yield* readinessRejected(
          operation,
          "receipt_tampered",
          "The immutable projection-validation receipt facts do not match its digest.",
        );
      if (receipt.consumedAt !== null)
        return yield* readinessRejected(
          operation,
          "receipt_consumed",
          "The projection-validation receipt has already been consumed.",
        );
      const consumedAt = yield* Clock.currentTimeMillis;
      if (consumedAt >= receipt.expiresAt)
        return yield* readinessRejected(
          operation,
          "receipt_expired",
          "The projection-validation receipt has expired.",
        );
      const metadata = serverProjectionBuildMetadata();
      if (
        receipt.deploymentSha !== metadata.deploymentSha ||
        receipt.projectionSchemaVersion !== metadata.projectionSchemaVersion ||
        receipt.projectionManifestVersion !== metadata.projectionManifestVersion
      )
        return yield* readinessRejected(
          operation,
          "deployment_changed",
          "Deployment SHA, projection schema, or manifest version changed after validation.",
        );
      const live = yield* collectProjectionReadinessSnapshotEffect({
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        now: consumedAt,
      }).pipe(
        Effect.mapError((error) =>
          readinessRejected(
            operation,
            error.reason === "mode_changed" ? "mode_changed" : "state_changed",
            error.detail,
          ),
        ),
      );
      if (live.readinessSnapshotDigest !== receipt.readinessSnapshotDigest)
        return yield* readinessRejected(
          operation,
          "state_changed",
          "A validated population, generation, count, digest, or high-water changed.",
        );
      const mode = yield* loadCurrentReadModeEffect(args).pipe(
        Effect.mapError((error) =>
          readinessRejected(operation, error.reason, error.detail),
        ),
      );
      if (
        mode.mode !== receipt.validatedMode ||
        mode.modeGeneration !== receipt.validatedModeGeneration
      )
        return yield* readinessRejected(
          operation,
          "mode_changed",
          "The Brain read mode no longer matches the validated CAS fence.",
        );
      const modeGeneration = mode.modeGeneration + 1;
      const ctx = yield* MutationCtx;
      const modeRow = mode.row;
      if (modeRow === null)
        yield* Effect.promise(() =>
          rawDatabase(ctx).insert("brainReadModes", {
            schemaVersion: 1,
            organizationKey: args.organizationKey,
            workspaceId: args.workspaceId,
            brainKey: args.brainKey,
            mode: "projection",
            modeGeneration,
            updatedAt: consumedAt,
          }),
        );
      else
        yield* Effect.promise(() =>
          rawDatabase(ctx).patch(modeRow._id, {
            mode: "projection",
            modeGeneration,
            updatedAt: consumedAt,
          }),
        );
      yield* Effect.promise(() =>
        rawDatabase(ctx).patch(receipt._id, {
          consumedAt,
          consumedModeGeneration: modeGeneration,
        }),
      );
      return {
        receiptKey: receipt.receiptKey,
        previousMode: mode.mode,
        mode: "projection" as const,
        previousModeGeneration: mode.modeGeneration,
        modeGeneration,
        consumedAt,
      };
    }),
);

const rollbackBrainReadModeImpl = FunctionImpl.make(
  databaseSchema,
  rolloutOperations,
  "rollbackBrainReadMode",
  (args) =>
    Effect.gen(function* () {
      const operation = "rollback_brain_read_mode" as const;
      const ctx = yield* MutationCtx;
      const rows = yield* Effect.promise(() =>
        rawDatabase(ctx)
          .query("brainReadModes")
          .withIndex("by_workspace_brain", (query) =>
            query
              .eq("workspaceId", args.workspaceId)
              .eq("brainKey", args.brainKey),
          )
          .take(2),
      );
      const mode = rows[0];
      if (rows.length !== 1 || mode === undefined || !exactScope(mode, args))
        return yield* readinessRejected(
          operation,
          rows.length > 1 ? "integrity_conflict" : "state_changed",
          "The exact Brain read-mode row is unavailable.",
        );
      if (mode.modeGeneration !== args.expectedModeGeneration)
        return yield* readinessRejected(
          operation,
          "mode_changed",
          `Expected mode generation ${args.expectedModeGeneration}, found ${mode.modeGeneration}.`,
        );
      const rolledBackAt = yield* Clock.currentTimeMillis;
      const modeGeneration = mode.modeGeneration + 1;
      yield* Effect.promise(() =>
        rawDatabase(ctx).patch(mode._id, {
          mode: "disabled",
          modeGeneration,
          updatedAt: rolledBackAt,
        }),
      );
      return {
        previousMode: mode.mode,
        mode: "disabled" as const,
        previousModeGeneration: mode.modeGeneration,
        modeGeneration,
        compatibilityEquivalent: false as const,
        reason: args.reason,
        rolledBackAt,
      };
    }),
);

export default GroupImpl.make(databaseSchema, rolloutOperations).pipe(
  Layer.provide(startImpl),
  Layer.provide(resumeImpl),
  Layer.provide(migrateLegacyPublicationJobAuthorityImpl),
  Layer.provide(resumeLegacyPublicationJobAuthorityMigrationImpl),
  Layer.provide(backfillTranscriptRevisionOrderImpl),
  Layer.provide(resumeTranscriptRevisionOrderBackfillImpl),
  Layer.provide(pausePublicationWorkersImpl),
  Layer.provide(resumePublicationWorkersImpl),
  Layer.provide(drainPublicationWorkerLeasesImpl),
  Layer.provide(getPublicationWorkerLeaseStatusImpl),
  Layer.provide(repairIngestionObligationImpl),
  Layer.provide(repairPublicationDeadLetterImpl),
  Layer.provide(quarantineIngestionObligationImpl),
  Layer.provide(decommissionRequiredScopeImpl),
  Layer.provide(validateBrainProjectionReadinessImpl),
  Layer.provide(switchBrainReadModeImpl),
  Layer.provide(rollbackBrainReadModeImpl),
  GroupImpl.finalize,
);
