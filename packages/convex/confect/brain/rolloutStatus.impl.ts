import { FunctionSpec } from "@confect/core";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import type {
  BrainProjectionPopulationDoc,
  BrainRequiredScopeIntentsDoc,
  IngestionObligationsDoc,
  ProviderTargetResolutionIntentsDoc,
  RetrievalPublicationJobsDoc,
  RetrievalRebuildRunsDoc,
  SlackPublicationTargetIntentsDoc,
} from "../_generated/docs";
import { DatabaseReader, QueryCtx } from "../_generated/services";
import { sha256Hex } from "../shared/sha256";
import {
  connectorAllowlistFenceIdentity,
  connectorScopeFenceIdentity,
  connectionFenceIdentity,
} from "./retrievalEligibility";
import { retrievalEligibilityFenceKey } from "./retrievalPublication";
import {
  loadPublicationPauseEffect,
  publicationScopeKeyForJob,
} from "./publicationWorkerControl";
import rolloutStatus, {
  RolloutStatusCapacityExceeded,
  RolloutStatusIntegrityConflict,
  getBrainRolloutStatus,
} from "./rolloutStatus.spec";

const MAX_REQUIRED_SCOPES = 10;
const MAX_ROWS_PER_STATE = 50;
const MAX_SCOPED_JOBS = 200;
const MAX_REBUILD_RUNS_PER_STATE = 40;
const MAX_DEAD_LETTERS = 20;
const MAX_TARGET_RESOLUTION_INTENTS_PER_STATE = 50;
const RUNBOOK_LINK = "docs/template/operations-runbook.md#incident" as const;

const obligationStates = [
  "captured",
  "normalization_pending",
  "quarantined",
  "target_resolution_pending",
  "capacity_blocked",
  "publication_pending",
  "retry_wait",
  "removal_pending",
  "drain_pending",
  "complete",
  "policy_excluded",
  "failed",
] as const satisfies readonly IngestionObligationsDoc["state"][];

const jobStates = [
  "pending",
  "retry_wait",
  "succeeded",
  "superseded",
  "revoked",
  "integrity_failure",
  "dead_letter",
] as const satisfies readonly RetrievalPublicationJobsDoc["status"][];

const unresolvedRebuildStates = [
  "running",
  "closing",
  "blocked",
] as const satisfies readonly RetrievalRebuildRunsDoc["status"][];

const successfulObligationStateValues = [
  "complete",
  "policy_excluded",
] as const satisfies readonly IngestionObligationsDoc["state"][];
const successfulObligationStates = new Set<IngestionObligationsDoc["state"]>(
  successfulObligationStateValues,
);
const unresolvedObligationStates = [
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
] as const satisfies readonly IngestionObligationsDoc["state"][];
const unresolvedJobStateValues = [
  "pending",
  "retry_wait",
  "integrity_failure",
  "dead_letter",
] as const satisfies readonly RetrievalPublicationJobsDoc["status"][];
const unresolvedJobStates = new Set<RetrievalPublicationJobsDoc["status"]>(
  unresolvedJobStateValues,
);
const unresolvedSlackTargetIntentStates = [
  "pending",
  "retry_wait",
] as const satisfies readonly SlackPublicationTargetIntentsDoc["status"][];
const unresolvedProviderTargetIntentStates = [
  "pending",
  "retry_wait",
  "capacity_blocked",
  "integrity_failure",
] as const satisfies readonly ProviderTargetResolutionIntentsDoc["status"][];

const exactBrainScope = (
  row: {
    readonly organizationKey: string;
    readonly workspaceId?: unknown | undefined;
    readonly brainKey?: string | undefined;
  },
  input: {
    readonly organizationKey: string;
    readonly workspaceId: unknown;
    readonly brainKey: string;
  },
) =>
  row.organizationKey === input.organizationKey &&
  row.workspaceId === input.workspaceId &&
  row.brainKey === input.brainKey;

const freshnessFor = (
  observedAt: number | null,
  thresholdMs: number | null,
  now: number,
) =>
  observedAt === null || thresholdMs === null
    ? ("unknown" as const)
    : now - observedAt <= thresholdMs
      ? ("current" as const)
      : ("stale" as const);

const worstFreshness = (
  statuses: readonly ("current" | "stale" | "unknown")[],
) =>
  statuses.length === 0 || statuses.includes("unknown")
    ? ("unknown" as const)
    : statuses.includes("stale")
      ? ("stale" as const)
      : ("current" as const);

const coverageRank = {
  complete: 0,
  partial: 1,
  unknown: 2,
  unavailable: 3,
} as const;

const worstCoverage = (
  statuses: readonly ("complete" | "partial" | "unavailable" | "unknown")[],
) =>
  statuses.length === 0
    ? ("unavailable" as const)
    : statuses.reduce<"complete" | "partial" | "unavailable" | "unknown">(
        (worst, status) =>
          coverageRank[status] > coverageRank[worst] ? status : worst,
        "complete",
      );

const alertKey = (input: {
  readonly kind: string;
  readonly requiredScopeIntentKey: string;
  readonly intentGeneration: number;
}): string => `ralt_${sha256Hex(JSON.stringify(input))}`;

const projectionStatus = (row: BrainProjectionPopulationDoc | undefined) => {
  if (row === undefined)
    return {
      present: false,
      projectionPopulationGeneration: 0,
      subjectBackfillGeneration: 0,
      subjectPopulationDigest: null,
      subjectCompletionDigest: null,
      subjectValidated: false,
      fenceBackfillGeneration: 0,
      fencePopulationDigest: null,
      fenceCompletionDigest: null,
      fenceValidated: false,
      conflictCount: 0,
      capacityCount: 0,
    } as const;
  const subject = row.legacySubjectBackfillCompletion;
  const fence = row.legacyEligibilityFenceBackfillCompletion;
  return {
    present: true,
    projectionPopulationGeneration: row.projectionPopulationGeneration,
    subjectBackfillGeneration: row.subjectBackfillGeneration,
    subjectPopulationDigest: subject?.populationDigest ?? null,
    subjectCompletionDigest: subject?.completionDigest ?? null,
    subjectValidated:
      subject !== null &&
      subject.subjectBackfillGeneration === row.subjectBackfillGeneration &&
      row.conflictCount === 0 &&
      row.capacityCount === 0,
    fenceBackfillGeneration: row.fenceBackfillGeneration,
    fencePopulationDigest: fence?.populationDigest ?? null,
    fenceCompletionDigest: fence?.completionDigest ?? null,
    fenceValidated:
      fence !== null &&
      fence.fenceBackfillGeneration === row.fenceBackfillGeneration &&
      row.fenceConflictCount === 0,
    conflictCount: row.conflictCount + row.fenceConflictCount,
    capacityCount: row.capacityCount,
  } as const;
};

const jobBelongsToScope = (
  job: RetrievalPublicationJobsDoc,
  intent: BrainRequiredScopeIntentsDoc,
) => {
  const scopeKey = publicationScopeKeyForJob(job);
  return (
    scopeKey === intent.connectorScopeKey ||
    (job.authorityEnvelope?.connectorScopeKey === undefined &&
      scopeKey === intent.corpusKey)
  );
};

const rebuildBelongsToScope = (
  run: RetrievalRebuildRunsDoc,
  intent: BrainRequiredScopeIntentsDoc,
) =>
  run.connectorScopeKey === intent.connectorScopeKey ||
  run.scopeValue === intent.connectorScopeKey;

const latestRun = <Run extends { readonly runGeneration: number }>(
  rows: readonly Run[],
): Run | undefined =>
  rows.reduce<Run | undefined>(
    (latest, row) =>
      latest === undefined || row.runGeneration > latest.runGeneration
        ? row
        : latest,
    undefined,
  );

export interface BrainRolloutStatusInput {
  readonly organizationKey: string;
  readonly workspaceId: BrainRequiredScopeIntentsDoc["workspaceId"];
  readonly brainKey: string;
  readonly now: number;
}

export const evaluateBrainRolloutStatusEffect = (
  args: BrainRolloutStatusInput,
): Effect.Effect<
  FunctionSpec.Returns<typeof getBrainRolloutStatus>,
  FunctionSpec.Error<typeof getBrainRolloutStatus>,
  DatabaseReader | QueryCtx
> =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const requiredIntents = yield* reader
      .table("brainRequiredScopeIntents")
      .index("by_workspace_brain_state", (query) =>
        query
          .eq("workspaceId", args.workspaceId)
          .eq("brainKey", args.brainKey)
          .eq("state", "required"),
      )
      .take(MAX_REQUIRED_SCOPES + 1)
      .pipe(Effect.orDie);
    if (requiredIntents.length > MAX_REQUIRED_SCOPES)
      return yield* new RolloutStatusCapacityExceeded({
        resource: "required_scopes",
        limit: MAX_REQUIRED_SCOPES,
        observedAtLeast: requiredIntents.length,
      });
    if (
      requiredIntents.some((intent) => !exactBrainScope(intent, args)) ||
      new Set(
        requiredIntents.map(
          ({ requiredScopeIntentKey }) => requiredScopeIntentKey,
        ),
      ).size !== requiredIntents.length ||
      new Set(requiredIntents.map(({ connectorScopeKey }) => connectorScopeKey))
        .size !== requiredIntents.length
    )
      return yield* new RolloutStatusIntegrityConflict({
        resource: "required_scope_intent",
        detail:
          "Required scope intents contain a cross-tenant or duplicate scoped identity.",
      });

    const populationRows = yield* reader
      .table("brainProjectionPopulation")
      .index("by_workspace_brain", (query) =>
        query.eq("workspaceId", args.workspaceId).eq("brainKey", args.brainKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (
      populationRows.length > 1 ||
      populationRows.some((row) => !exactBrainScope(row, args))
    )
      return yield* new RolloutStatusIntegrityConflict({
        resource: "projection_population",
        detail:
          "The Brain projection population is duplicated or tenant-inconsistent.",
      });
    const projection = projectionStatus(populationRows[0]);
    const projectionValid =
      projection.present &&
      projection.subjectValidated &&
      projection.fenceValidated &&
      projection.conflictCount === 0 &&
      projection.capacityCount === 0;

    const jobPages = yield* Effect.all(
      unresolvedJobStateValues.map((status) =>
        reader
          .table("retrievalPublicationJobs")
          .index("by_organization_workspace_brain_status", (query) =>
            query
              .eq("organizationKey", args.organizationKey)
              .eq("workspaceId", args.workspaceId)
              .eq("brainKey", args.brainKey)
              .eq("status", status),
          )
          .take(MAX_SCOPED_JOBS + 1),
      ),
    ).pipe(Effect.orDie);
    const scopedJobs = jobPages
      .flatMap((rows) => rows)
      .filter((row) => exactBrainScope(row, args));
    const jobsTruncated =
      jobPages.some((rows) => rows.length > MAX_SCOPED_JOBS) ||
      scopedJobs.length > MAX_SCOPED_JOBS;
    const jobs = scopedJobs.slice(0, MAX_SCOPED_JOBS);

    const rebuildPages = yield* Effect.all(
      unresolvedRebuildStates.map((status) =>
        reader
          .table("retrievalRebuildRuns")
          .index("by_workspace_brain_status", (query) =>
            query
              .eq("workspaceId", args.workspaceId)
              .eq("brainKey", args.brainKey)
              .eq("status", status),
          )
          .take(MAX_REBUILD_RUNS_PER_STATE + 1),
      ),
    ).pipe(Effect.orDie);
    const rebuildsTruncated = rebuildPages.some(
      (rows) => rows.length > MAX_REBUILD_RUNS_PER_STATE,
    );
    const rebuilds = rebuildPages
      .flatMap((rows) => rows.slice(0, MAX_REBUILD_RUNS_PER_STATE))
      .filter((row) => exactBrainScope(row, args));

    const scopeResults = yield* Effect.all(
      requiredIntents.map((intent) =>
        Effect.gen(function* () {
          const [
            connectorRows,
            allowlistRows,
            healthRows,
            reconciliationRows,
            cursorRows,
            pauseResult,
          ] = yield* Effect.all([
            reader
              .table("connectorScopes")
              .index("by_connector_scope_key", (query) =>
                query.eq("connectorScopeKey", intent.connectorScopeKey),
              )
              .take(2),
            reader
              .table("connectorAllowlistGenerations")
              .index("by_scope_generation", (query) =>
                query
                  .eq("connectorScopeKey", intent.connectorScopeKey)
                  .eq("allowlistGeneration", intent.allowlistGeneration),
              )
              .take(2),
            reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope", (query) =>
                query
                  .eq("workspaceId", intent.workspaceId)
                  .eq("brainKey", intent.brainKey)
                  .eq("corpusKey", intent.corpusKey)
                  .eq("connectorScopeKey", intent.connectorScopeKey),
              )
              .take(2),
            reader
              .table("connectorReconciliationRuns")
              .index(
                "by_scope_run_generation",
                (query) =>
                  query.eq("connectorScopeKey", intent.connectorScopeKey),
                "desc",
              )
              .take(1),
            reader
              .table("connectorIncrementalCursors")
              .index("by_scope_tuple", (query) =>
                query
                  .eq("connectorScopeKey", intent.connectorScopeKey)
                  .eq("connectionGeneration", intent.connectionGeneration)
                  .eq("allowlistGeneration", intent.allowlistGeneration),
              )
              .take(2),
            loadPublicationPauseEffect({
              organizationKey: intent.organizationKey,
              workspaceId: intent.workspaceId,
              brainKey: intent.brainKey,
              scopeKey: intent.connectorScopeKey,
            }),
          ]).pipe(Effect.orDie);

          const storedConnector = connectorRows[0];
          const storedAllowlist = allowlistRows[0];
          const storedHealth = healthRows[0];
          const storedCursor = cursorRows[0];
          const storedPause = pauseResult.rows[0];
          const connectorIntegrity =
            connectorRows.length !== 1 ||
            storedConnector === undefined ||
            storedConnector.organizationKey !== intent.organizationKey;
          const allowlistIntegrity =
            allowlistRows.length !== 1 ||
            storedAllowlist === undefined ||
            storedAllowlist.organizationKey !== intent.organizationKey;
          const healthIntegrity =
            healthRows.length > 1 ||
            (storedHealth !== undefined &&
              !exactBrainScope(storedHealth, intent));
          const cursorIntegrity =
            cursorRows.length > 1 ||
            (storedCursor !== undefined &&
              !exactBrainScope(storedCursor, intent));
          const pauseIntegrity =
            pauseResult.rows.length > 1 ||
            (storedPause !== undefined &&
              (!exactBrainScope(storedPause, intent) ||
                storedPause.scopeKey !== intent.connectorScopeKey));
          const connector = connectorIntegrity ? undefined : storedConnector;
          const allowlist = allowlistIntegrity ? undefined : storedAllowlist;
          const health = healthIntegrity ? undefined : storedHealth;
          const cursor = cursorIntegrity ? undefined : storedCursor;
          const pause = pauseIntegrity ? undefined : storedPause;

          const identities = [
            connectionFenceIdentity({
              organizationKey: intent.organizationKey,
              connectionKey: intent.connectionKey,
            }),
            connectorScopeFenceIdentity({
              organizationKey: intent.organizationKey,
              connectorScopeKey: intent.connectorScopeKey,
            }),
            connectorAllowlistFenceIdentity({
              organizationKey: intent.organizationKey,
              connectorScopeKey: intent.connectorScopeKey,
            }),
          ];
          const fenceRows = yield* Effect.all(
            identities.map((identity) =>
              reader
                .table("retrievalEligibilityFences")
                .index("by_organization_fence", (query) =>
                  query
                    .eq("organizationKey", identity.organizationKey)
                    .eq("fenceKey", retrievalEligibilityFenceKey(identity)),
                )
                .take(2),
            ),
          ).pipe(Effect.orDie);
          let eligibilityIntegrityCount = Number(
            connectorIntegrity ||
              allowlistIntegrity ||
              healthIntegrity ||
              cursorIntegrity ||
              pauseIntegrity,
          );
          let ineligible = connector?.state === "revoked";
          for (const [index, rows] of fenceRows.entries()) {
            const identity = identities[index];
            const fence = rows[0];
            if (
              rows.length !== 1 ||
              fence === undefined ||
              identity === undefined ||
              fence.kind !== identity.kind ||
              fence.controllerKey !== identity.controllerKey
            )
              eligibilityIntegrityCount += 1;
            else if (!fence.eligible) ineligible = true;
          }

          const tupleMatches =
            !connectorIntegrity &&
            !allowlistIntegrity &&
            connector?.state === "active" &&
            connector.connectionKey === intent.connectionKey &&
            connector.currentConnectionGeneration ===
              intent.connectionGeneration &&
            connector.currentAllowlistGeneration ===
              intent.allowlistGeneration &&
            allowlist?.state === "current" &&
            allowlist.connectionKey === intent.connectionKey &&
            allowlist.connectionGeneration === intent.connectionGeneration &&
            allowlist.configurationDigest ===
              intent.controllingConfigurationDigest;
          if (!tupleMatches && !connectorIntegrity && !allowlistIntegrity)
            eligibilityIntegrityCount += 1;

          const exactReconciliationRows = reconciliationRows.filter(
            (row) =>
              exactBrainScope(row, intent) &&
              row.corpusKey === intent.corpusKey &&
              row.providerKind === intent.providerKind &&
              row.connectionKey === intent.connectionKey &&
              row.connectionGeneration === intent.connectionGeneration &&
              row.allowlistGeneration === intent.allowlistGeneration,
          );
          const reconciliation = latestRun(exactReconciliationRows);
          const reconciliationReceiptComplete =
            reconciliation?.status === "complete" &&
            reconciliation.completionReceipt !== null &&
            reconciliation.completedAt !== null &&
            reconciliation.blockingObligationCount === 0 &&
            reconciliation.completionReceipt.blockingObligationCount === 0 &&
            reconciliation.completionReceipt.ledgerHighWater ===
              reconciliation.ledgerHighWater;

          const obligationPages = yield* Effect.all([
            ...unresolvedObligationStates.map((state) =>
              reader
                .table("ingestionObligations")
                .index("by_required_intent_state", (query) =>
                  query
                    .eq("requiredScopeIntentKey", intent.requiredScopeIntentKey)
                    .eq("state", state),
                )
                .take(MAX_ROWS_PER_STATE + 1)
                .pipe(Effect.map((rows) => ({ state, rows }))),
            ),
            ...(reconciliation === undefined
              ? []
              : successfulObligationStateValues.map((state) =>
                  reader
                    .table("ingestionObligations")
                    .index("by_run_state_ledger_sequence", (query) =>
                      query
                        .eq(
                          "reconciliationRunKey",
                          reconciliation.reconciliationRunKey,
                        )
                        .eq("state", state),
                    )
                    .take(MAX_ROWS_PER_STATE + 1)
                    .pipe(Effect.map((rows) => ({ state, rows }))),
                )),
          ]).pipe(Effect.orDie);
          let obligationIntegrity = false;
          const obligationCounts = obligationStates.map((state) => {
            const rows =
              obligationPages.find((page) => page.state === state)?.rows ?? [];
            const exact = rows
              .slice(0, MAX_ROWS_PER_STATE)
              .filter(
                (row) =>
                  exactBrainScope(row, intent) &&
                  row.requiredScopeIntentKey ===
                    intent.requiredScopeIntentKey &&
                  row.connectorScopeKey === intent.connectorScopeKey &&
                  row.connectionKey === intent.connectionKey &&
                  row.connectionGeneration === intent.connectionGeneration &&
                  row.allowlistGeneration === intent.allowlistGeneration,
              );
            if (exact.length !== Math.min(rows.length, MAX_ROWS_PER_STATE))
              obligationIntegrity = true;
            return {
              state,
              count: exact.length,
              truncated: rows.length > MAX_ROWS_PER_STATE,
              rows: exact,
            };
          });
          if (obligationIntegrity) eligibilityIntegrityCount += 1;
          const currentRunObligations = obligationCounts.flatMap(({ rows }) =>
            reconciliation === undefined
              ? []
              : rows.filter(
                  ({ reconciliationRunKey }) =>
                    reconciliationRunKey ===
                    reconciliation.reconciliationRunKey,
                ),
          );
          const currentRunObservationCount = currentRunObligations.filter(
            ({ cause }) => cause === "observation",
          ).length;
          const currentRunRemovalCount = currentRunObligations.filter(
            ({ cause }) => cause === "removal",
          ).length;
          const successfulObligationCount = currentRunObligations.filter(
            ({ state }) => successfulObligationStates.has(state),
          ).length;
          const obligationsTruncated = obligationCounts.some(
            ({ truncated }) => truncated,
          );
          const obligationManifestMatches =
            !obligationsTruncated &&
            reconciliation !== undefined &&
            reconciliation.obligationCount === currentRunObservationCount &&
            reconciliation.removalRequiredCount === currentRunRemovalCount &&
            reconciliation.completionReceipt !== null &&
            reconciliation.completionReceipt.successfulObligationCount ===
              successfulObligationCount;
          if (!obligationManifestMatches) eligibilityIntegrityCount += 1;
          const reconciliationComplete =
            reconciliationReceiptComplete && obligationManifestMatches;
          const nonterminalObligations = obligationCounts.flatMap((entry) =>
            successfulObligationStates.has(entry.state) ? [] : entry.rows,
          );
          const oldestNonterminalAt = nonterminalObligations.reduce<
            number | null
          >(
            (oldest, row) =>
              oldest === null || row.createdAt < oldest
                ? row.createdAt
                : oldest,
            null,
          );
          const capacityCount =
            obligationCounts.find(({ state }) => state === "capacity_blocked")
              ?.count ?? 0;
          const quarantineCount =
            obligationCounts.find(({ state }) => state === "quarantined")
              ?.count ?? 0;

          const providerTargetIntentPages = yield* Effect.all(
            unresolvedProviderTargetIntentStates.map((state) =>
              reader
                .table("providerTargetResolutionIntents")
                .index("by_scope_status_due_intent", (query) =>
                  query
                    .eq("organizationKey", intent.organizationKey)
                    .eq("connectorScopeKey", intent.connectorScopeKey)
                    .eq("connectionGeneration", intent.connectionGeneration)
                    .eq("status", state),
                )
                .take(MAX_TARGET_RESOLUTION_INTENTS_PER_STATE + 1)
                .pipe(Effect.map((rows) => ({ state, rows }))),
            ),
          ).pipe(Effect.orDie);
          const legacySlackTargetIntentPages =
            intent.providerKind === "slack"
              ? yield* Effect.all(
                  unresolvedSlackTargetIntentStates.map((state) =>
                    reader
                      .table("slackPublicationTargetIntents")
                      .index("by_organization_channel_status", (query) =>
                        query
                          .eq("organizationKey", intent.organizationKey)
                          .eq("channelKey", intent.connectorScopeKey)
                          .eq("status", state),
                      )
                      .take(MAX_TARGET_RESOLUTION_INTENTS_PER_STATE + 1)
                      .pipe(
                        Effect.map((rows) => ({
                          state,
                          rows: rows.filter(
                            (row) =>
                              row.providerTargetResolutionIntentId ===
                              undefined,
                          ),
                          sourceTruncated:
                            rows.length >
                            MAX_TARGET_RESOLUTION_INTENTS_PER_STATE,
                        })),
                      ),
                  ),
                ).pipe(Effect.orDie)
              : [];
          const targetResolutionCounts =
            unresolvedProviderTargetIntentStates.map((state) => {
              const providerRows =
                providerTargetIntentPages.find((page) => page.state === state)
                  ?.rows ?? [];
              const legacyPage = legacySlackTargetIntentPages.find(
                (page) => page.state === state,
              );
              const rows = [...providerRows, ...(legacyPage?.rows ?? [])].slice(
                0,
                MAX_TARGET_RESOLUTION_INTENTS_PER_STATE,
              );
              return {
                state,
                count: rows.length,
                truncated:
                  providerRows.length >
                    MAX_TARGET_RESOLUTION_INTENTS_PER_STATE ||
                  legacyPage?.sourceTruncated === true ||
                  providerRows.length + (legacyPage?.rows.length ?? 0) >
                    MAX_TARGET_RESOLUTION_INTENTS_PER_STATE,
                rows,
              };
            });
          const unresolvedTargetIntents = targetResolutionCounts.flatMap(
            ({ rows }) => rows,
          );
          const targetResolutionTruncated = targetResolutionCounts.some(
            ({ truncated }) => truncated,
          );
          const oldestUnresolvedTargetIntentAt = unresolvedTargetIntents.reduce<
            number | null
          >(
            (oldest, row) =>
              oldest === null || row.createdAt < oldest
                ? row.createdAt
                : oldest,
            null,
          );

          const scopeJobs = jobs.filter((job) =>
            jobBelongsToScope(job, intent),
          );
          const jobCounts = jobStates.map((state) => ({
            state,
            count: scopeJobs.filter((job) => job.status === state).length,
            truncated: jobsTruncated,
          }));
          const unresolvedJobs = scopeJobs.filter((job) =>
            unresolvedJobStates.has(job.status),
          );
          const deadLetterJobs = scopeJobs.filter(
            (job) => job.status === "dead_letter",
          );
          const eligibilityJobFailures = scopeJobs.filter(
            (job) =>
              job.status === "integrity_failure" &&
              /eligibility|authority.*fence/i.test(job.lastErrorTag ?? ""),
          ).length;
          eligibilityIntegrityCount += eligibilityJobFailures;
          const publicationJobIntegrityFailures = scopeJobs.filter(
            (job) =>
              job.status === "integrity_failure" &&
              !/eligibility|authority.*fence/i.test(job.lastErrorTag ?? ""),
          ).length;
          const publicationIntegrityCount = Math.max(
            publicationJobIntegrityFailures,
            health?.degradedReason?.toLowerCase().includes("integrity")
              ? health.failedCount
              : 0,
          );

          const matchingRebuilds = rebuilds.filter((run) =>
            rebuildBelongsToScope(run, intent),
          );
          const rebuild = latestRun(matchingRebuilds);
          const rebuildIncomplete =
            rebuild !== undefined &&
            (rebuild.status !== "complete" ||
              rebuild.completionReceipt === undefined ||
              rebuild.blockingChildCount > 0);

          const freshnessThresholdMs = health?.freshnessThresholdMs ?? null;
          const freshness = freshnessFor(
            health?.lastObservedAt ?? null,
            freshnessThresholdMs,
            args.now,
          );
          const coverageStatus = health?.coverageStatus ?? "unavailable";
          const healthMatchesTuple =
            health !== undefined &&
            health.connectionGeneration === intent.connectionGeneration &&
            health.reconciliationGeneration === reconciliation?.runGeneration;
          const cursorStalled =
            cursor !== undefined &&
            !cursor.traversalComplete &&
            freshnessThresholdMs !== null &&
            args.now - cursor.updatedAt > freshnessThresholdMs;
          const paused = pauseIntegrity || pause?.state === "paused";
          const boundedScanOverflow =
            jobsTruncated ||
            rebuildsTruncated ||
            obligationsTruncated ||
            targetResolutionTruncated;

          const blockers = new Set<
            | "missing_health"
            | "freshness_stale"
            | "freshness_unknown"
            | "coverage_incomplete"
            | "configuration_mismatch"
            | "scope_revoked"
            | "eligibility_ineligible"
            | "eligibility_integrity_failure"
            | "reconciliation_incomplete"
            | "obligations_nonterminal"
            | "publication_jobs_unresolved"
            | "target_resolution_intents_unresolved"
            | "dead_letter"
            | "quarantine"
            | "cursor_stalled"
            | "workers_paused"
            | "capacity_failure"
            | "publication_integrity_failure"
            | "projection_population_invalid"
            | "bounded_scan_overflow"
          >();
          if (health === undefined) blockers.add("missing_health");
          if (freshness === "stale") blockers.add("freshness_stale");
          if (freshness === "unknown") blockers.add("freshness_unknown");
          if (coverageStatus !== "complete" || !healthMatchesTuple)
            blockers.add("coverage_incomplete");
          if (!tupleMatches) blockers.add("configuration_mismatch");
          if (connector?.state === "revoked") blockers.add("scope_revoked");
          if (ineligible) blockers.add("eligibility_ineligible");
          if (eligibilityIntegrityCount > 0)
            blockers.add("eligibility_integrity_failure");
          if (!reconciliationComplete)
            blockers.add("reconciliation_incomplete");
          if (nonterminalObligations.length > 0)
            blockers.add("obligations_nonterminal");
          if (unresolvedJobs.length > 0 || rebuildIncomplete)
            blockers.add("publication_jobs_unresolved");
          if (unresolvedTargetIntents.length > 0)
            blockers.add("target_resolution_intents_unresolved");
          if (deadLetterJobs.length > 0) blockers.add("dead_letter");
          if (quarantineCount > 0) blockers.add("quarantine");
          if (cursorStalled) blockers.add("cursor_stalled");
          if (paused) blockers.add("workers_paused");
          if (capacityCount > 0 || projection.capacityCount > 0)
            blockers.add("capacity_failure");
          if (publicationIntegrityCount > 0)
            blockers.add("publication_integrity_failure");
          if (!projectionValid) blockers.add("projection_population_invalid");
          if (boundedScanOverflow) blockers.add("bounded_scan_overflow");

          const commonAlert = {
            dri: "workspace_owner" as const,
            connectorScopeKey: intent.connectorScopeKey,
            requiredScopeIntentKey: intent.requiredScopeIntentKey,
            intentGeneration: intent.intentGeneration,
            connectionGeneration: intent.connectionGeneration,
            allowlistGeneration: intent.allowlistGeneration,
            reconciliationRunKey: reconciliation?.reconciliationRunKey ?? null,
            runbookLink: RUNBOOK_LINK,
          };
          const alerts: Array<{
            alertKey: string;
            kind:
              | "freshness_breach"
              | "reconciliation_breach"
              | "oldest_obligation_breach"
              | "dead_letter"
              | "quarantine"
              | "stalled_cursor"
              | "integrity_failure"
              | "retrieval_capacity_overflow"
              | "bounded_scan_overflow";
            severity: "warning" | "critical";
            dri: "workspace_owner";
            connectorScopeKey: string;
            requiredScopeIntentKey: string;
            intentGeneration: number;
            connectionGeneration: number;
            allowlistGeneration: number;
            reconciliationRunKey: string | null;
            count: number;
            oldestAt: number | null;
            entityKeys: string[];
            runbookLink: typeof RUNBOOK_LINK;
          }> = [];
          const addAlert = (
            kind: (typeof alerts)[number]["kind"],
            severity: "warning" | "critical",
            count: number,
            oldestAt: number | null,
            entityKeys: readonly string[],
          ) =>
            alerts.push({
              ...commonAlert,
              alertKey: alertKey({
                kind,
                requiredScopeIntentKey: intent.requiredScopeIntentKey,
                intentGeneration: intent.intentGeneration,
              }),
              kind,
              severity,
              count,
              oldestAt,
              entityKeys: [...entityKeys].slice(0, 20),
            });
          if (freshness !== "current")
            addAlert(
              "freshness_breach",
              "warning",
              1,
              health?.lastObservedAt ?? null,
              [],
            );
          if (!reconciliationComplete)
            addAlert(
              "reconciliation_breach",
              "critical",
              reconciliation?.blockingObligationCount ?? 1,
              reconciliation?.openedAt ?? null,
              reconciliation === undefined
                ? []
                : [reconciliation.reconciliationRunKey],
            );
          if (
            oldestNonterminalAt !== null &&
            freshnessThresholdMs !== null &&
            args.now - oldestNonterminalAt > freshnessThresholdMs
          )
            addAlert(
              "oldest_obligation_breach",
              "warning",
              nonterminalObligations.length,
              oldestNonterminalAt,
              nonterminalObligations.map(
                ({ ingestionObligationKey }) => ingestionObligationKey,
              ),
            );
          if (deadLetterJobs.length > 0)
            addAlert(
              "dead_letter",
              "critical",
              deadLetterJobs.length,
              Math.min(...deadLetterJobs.map(({ createdAt }) => createdAt)),
              deadLetterJobs.map(({ jobKey }) => jobKey),
            );
          if (quarantineCount > 0)
            addAlert(
              "quarantine",
              "critical",
              quarantineCount,
              Math.min(
                ...nonterminalObligations
                  .filter(({ state }) => state === "quarantined")
                  .map(({ createdAt }) => createdAt),
              ),
              nonterminalObligations
                .filter(({ state }) => state === "quarantined")
                .map(({ ingestionObligationKey }) => ingestionObligationKey),
            );
          if (cursorStalled)
            addAlert(
              "stalled_cursor",
              "warning",
              1,
              cursor?.updatedAt ?? null,
              cursor === undefined ? [] : [cursor.cursorKey],
            );
          if (publicationIntegrityCount > 0 || eligibilityIntegrityCount > 0)
            addAlert(
              "integrity_failure",
              "critical",
              publicationIntegrityCount + eligibilityIntegrityCount,
              null,
              scopeJobs
                .filter(({ status }) => status === "integrity_failure")
                .map(({ jobKey }) => jobKey),
            );
          if (capacityCount > 0 || projection.capacityCount > 0)
            addAlert(
              "retrieval_capacity_overflow",
              "critical",
              capacityCount + projection.capacityCount,
              null,
              nonterminalObligations
                .filter(({ state }) => state === "capacity_blocked")
                .map(({ ingestionObligationKey }) => ingestionObligationKey),
            );
          if (boundedScanOverflow)
            addAlert("bounded_scan_overflow", "critical", 1, null, []);

          return {
            status: {
              requiredScopeIntentKey: intent.requiredScopeIntentKey,
              intentGeneration: intent.intentGeneration,
              corpusKey: intent.corpusKey,
              providerKind: intent.providerKind,
              connectorScopeKey: intent.connectorScopeKey,
              configuration: {
                connectionKey: intent.connectionKey,
                connectionGeneration: intent.connectionGeneration,
                allowlistGeneration: intent.allowlistGeneration,
                controllingConfigurationDigest:
                  intent.controllingConfigurationDigest,
                connectorState:
                  connector === undefined || connectorIntegrity
                    ? ("missing" as const)
                    : connector.state,
                allowlistState:
                  allowlist === undefined || allowlistIntegrity
                    ? ("missing" as const)
                    : allowlist.state,
                tupleMatches,
              },
              eligibility: {
                status:
                  eligibilityIntegrityCount > 0
                    ? ("integrity_failure" as const)
                    : ineligible
                      ? ("ineligible" as const)
                      : ("eligible" as const),
                failureCount: eligibilityIntegrityCount,
              },
              reconciliation: {
                runKey: reconciliation?.reconciliationRunKey ?? null,
                runGeneration: reconciliation?.runGeneration ?? null,
                status: reconciliation?.status ?? null,
                providerHighWater: reconciliation?.providerHighWater ?? null,
                ledgerHighWater: reconciliation?.ledgerHighWater ?? null,
                completedAt: reconciliation?.completedAt ?? null,
                completionDigest:
                  reconciliation?.completionReceipt?.receiptDigest ?? null,
                blockingObligationCount:
                  reconciliation?.blockingObligationCount ?? 0,
                truncated: false,
              },
              rebuild: {
                runKey: rebuild?.rebuildRunKey ?? null,
                runGeneration: rebuild?.runGeneration ?? null,
                status: rebuild?.status ?? null,
                ledgerHighWater: rebuild?.ledgerHighWater ?? null,
                catchupHighWater: rebuild?.catchupHighWater ?? null,
                completionDigest:
                  rebuild?.completionReceipt?.receiptDigest ?? null,
                blockingChildCount: rebuild?.blockingChildCount ?? 0,
                truncated: rebuildsTruncated,
              },
              health: {
                rowPresent: health !== undefined,
                lastObservedAt: health?.lastObservedAt ?? null,
                lastPublishedAt: health?.lastPublishedAt ?? null,
                lastReconciledAt: health?.lastReconciledAt ?? null,
                freshnessThresholdMs,
                failedCount: health?.failedCount ?? 0,
                degradedReason: health?.degradedReason ?? null,
              },
              freshness,
              coverageStatus,
              readiness:
                blockers.size === 0 ? ("ready" as const) : ("blocked" as const),
              obligations: {
                counts: obligationCounts.map(({ state, count, truncated }) => ({
                  state,
                  count,
                  truncated,
                })),
                nonterminalCount: nonterminalObligations.length,
                oldestNonterminalAt,
                truncated: obligationsTruncated,
              },
              publication: {
                counts: jobCounts,
                unresolvedCount: unresolvedJobs.length,
                deadLetters: deadLetterJobs
                  .slice(0, MAX_DEAD_LETTERS)
                  .map((job) => ({
                    jobKey: job.jobKey,
                    effectClass: job.effectClass ?? null,
                    attemptCount: job.attemptCount,
                    lastErrorTag: job.lastErrorTag ?? null,
                    repairOfJobKey:
                      job.authorityEnvelope?.repairOfJobKey ?? null,
                  })),
                truncated:
                  jobsTruncated || deadLetterJobs.length > MAX_DEAD_LETTERS,
              },
              targetResolution: {
                counts: targetResolutionCounts.map(
                  ({ state, count, truncated }) => ({
                    state,
                    count,
                    truncated,
                  }),
                ),
                unresolvedCount: unresolvedTargetIntents.length,
                oldestUnresolvedAt: oldestUnresolvedTargetIntentAt,
                truncated: targetResolutionTruncated,
              },
              workers: {
                pauseEpoch: pause?.pauseEpoch ?? 0,
                state: paused ? ("paused" as const) : ("running" as const),
              },
              failures: {
                capacityCount,
                publicationIntegrityCount,
                eligibilityIntegrityCount,
              },
              blockers: [...blockers],
            },
            alerts,
          };
        }),
      ),
      { concurrency: 1 },
    );
    const scopes = scopeResults.map(({ status }) => status);
    const alerts = scopeResults.flatMap(({ alerts }) => alerts);
    const freshness = worstFreshness(scopes.map((scope) => scope.freshness));
    const coverageStatus = worstCoverage(
      scopes.map((scope) => scope.coverageStatus),
    );
    const promotionReady =
      projectionValid &&
      scopes.length > 0 &&
      scopes.every(({ readiness }) => readiness === "ready");
    return {
      statusVersion: 1 as const,
      organizationKey: args.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      evaluatedAt: args.now,
      freshness,
      coverageStatus,
      readiness: promotionReady ? ("ready" as const) : ("blocked" as const),
      promotionReady,
      projection,
      scopes,
      alerts,
    };
  });

const getBrainRolloutStatusImpl = FunctionImpl.make(
  databaseSchema,
  rolloutStatus,
  "getBrainRolloutStatus",
  evaluateBrainRolloutStatusEffect,
);

export default GroupImpl.make(databaseSchema, rolloutStatus).pipe(
  Layer.provide(getBrainRolloutStatusImpl),
  GroupImpl.finalize,
);
