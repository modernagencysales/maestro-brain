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
import * as Layer from "effect/Layer";

import type {
  RetrievalPublicationJobsDoc,
  RetrievalPublicationSetsDoc,
  RetrievalPublicationSubjectsDoc,
} from "../_generated/docs";
import databaseSchema from "../_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationCtx,
} from "../_generated/services";
import { sha256Hex } from "../shared/sha256";
import type brainProjectionPopulationSource from "../tables/brainProjectionPopulation";
import type connectorAllowlistGenerationsSource from "../tables/connectorAllowlistGenerations";
import type connectorScopesSource from "../tables/connectorScopes";
import type documentSourceObjectsSource from "../tables/documentSourceObjects";
import type documentSourceRevisionsSource from "../tables/documentSourceRevisions";
import type retrievalPublicationSetsSource from "../tables/retrievalPublicationSets";
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
import { migrateLegacyPublicationJobEffect } from "./retrievalPublication.impl";
import {
  resumeTranscriptRevisionOrderBackfillEffect,
  startTranscriptRevisionOrderBackfillEffect,
} from "./transcriptRevisionOrderMigration";
import rolloutOperations, {
  ProjectionBackfillCapacityExceeded,
  ProjectionBackfillConflict,
  ProjectionBackfillNotFound,
} from "./rolloutOperations.spec";

type BrainProjectionPopulationTable = ReturnType<
  typeof brainProjectionPopulationSource<"brainProjectionPopulation">
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
type RetrievalPublicationSetsTable = ReturnType<
  typeof retrievalPublicationSetsSource<"retrievalPublicationSets">
>;
type ProjectionConfectDataModel = DataModel.FromTables<
  | DatabaseSchema.Tables<typeof databaseSchema>
  | BrainProjectionPopulationTable
  | ConnectorScopesTable
  | ConnectorAllowlistGenerationsTable
  | DocumentSourceObjectsTable
  | DocumentSourceRevisionsTable
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
    const resolved = yield* Effect.all(
      rows.map(({ identity, eligible }) =>
        ensureEligibilityFenceEffect({ identity, eligible, now }),
      ),
    );
    const refs = canonicalFenceRefs(resolved.map(({ ref }) => ref));
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
          .take(MAX_PUBLICATION_TOKEN_ROWS + 1)
          .pipe(Effect.orDie),
        publicationOriginPresentEffect(set),
      ]);
    if (
      historyRows.length > MAX_PUBLICATION_HISTORY_ROWS ||
      entries.length > MAX_PUBLICATION_ENTRY_ROWS ||
      tokens.length > MAX_PUBLICATION_TOKEN_ROWS
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
    const report = inspectPublicationIntegrity({
      expectedPublicationSubjectKey: expectedSubjectKey,
      originPresent,
      set: prospectiveSet,
      subjects: subjects.length === 0 ? [prospectiveSubject] : subjects,
      subjectHistory: history,
      entries: prospectiveEntries,
      tokens,
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
      )
    )
      return { kind: "conflict" };

    let wrote = false;
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
    const rows = yield* loadSetPageEffect(population, state, batchSize);
    const page = rows.slice(0, batchSize);
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
    const exhausted = rows.length <= batchSize;
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

export default GroupImpl.make(databaseSchema, rolloutOperations).pipe(
  Layer.provide(startImpl),
  Layer.provide(resumeImpl),
  Layer.provide(migrateLegacyPublicationJobAuthorityImpl),
  Layer.provide(resumeLegacyPublicationJobAuthorityMigrationImpl),
  Layer.provide(backfillTranscriptRevisionOrderImpl),
  Layer.provide(resumeTranscriptRevisionOrderBackfillImpl),
  GroupImpl.finalize,
);
