import { sha256Hex } from "../shared/sha256";
import type { GenericId } from "convex/values";
import type { RetrievalEligibilityFenceRef } from "./retrievalPublication";

export type RetrievalPublicationFenceSnapshot = RetrievalEligibilityFenceRef & {
  readonly eligible: boolean;
  readonly controllerKey: string;
};

export type RetrievalPublicationAuthorityContext = {
  readonly version: 1;
  readonly publicationSubjectKey?: string;
  readonly subjectIncarnationKey?: string;
  readonly connectorScopeKey?: string;
  readonly configuration: {
    readonly requestGeneration: number;
    readonly policyGeneration?: number;
    readonly routeGeneration?: number;
    readonly lifecycleGeneration?: number;
    readonly connectionGeneration?: number;
  };
  readonly eligibilityFences: readonly RetrievalPublicationFenceSnapshot[];
  readonly observationFence: {
    readonly kind: "revision" | "rebuild";
    readonly key: string;
    readonly generation?: number;
  };
  readonly targetResolutionIntentKey?: GenericId<"slackPublicationTargetIntents">;
  readonly targetResolutionGeneration?: number;
  readonly providerTargetResolutionIntentId?: GenericId<"providerTargetResolutionIntents">;
  readonly providerTargetResolutionGeneration?: number;
  readonly repairOfJobKey?: string;
  readonly supersedesJobKey?: string;
};

export type RetrievalPublicationAuthorityEnvelope =
  RetrievalPublicationAuthorityContext & {
    readonly authorityDigest: string;
    readonly stableEffectKey: string;
    readonly capturedAt: number;
  };

export type RetrievalPublicationEffectClass =
  | "direct_publication"
  | "rebuild_batch"
  | "attributed_repair"
  | "migration_replacement";

export type RetrievalPublicationJobInput = {
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
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
  readonly ingestionObligationKey?: string;
  readonly providerTargetResolutionIntentId?: GenericId<"providerTargetResolutionIntents">;
  readonly providerTargetResolutionGeneration?: number;
  readonly requestGeneration: number;
  readonly effectClass?: RetrievalPublicationEffectClass;
  readonly operation?: "publish" | "cleanup";
  readonly rebuildRunKey?: string;
  readonly rebuildRunGeneration?: number;
  readonly rebuildLedgerHighWater?: number;
  readonly rebuildPauseEpoch?: number;
  readonly rebuildPredecessorDigest?: string;
  readonly parentRebuildJobKey?: string;
  readonly page?: {
    readonly authority: "authoritative" | "derived" | "advisory";
    readonly authorityPolicyKey: string;
    readonly policyGeneration: number;
  };
  readonly rebuild?: {
    readonly phase?: "scan" | "catch_up" | "set_difference" | "close";
    readonly phaseHighWater?: number;
    readonly afterSourceKey?: string;
    readonly limit: number;
    readonly discoveredCount?: number;
    readonly publishedCount?: number;
  };
  readonly authorityContext?: RetrievalPublicationAuthorityContext;
};

const canonicalFenceSnapshots = (
  snapshots: readonly RetrievalPublicationFenceSnapshot[],
) =>
  [...snapshots]
    .map((snapshot) => ({ ...snapshot }))
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.fenceKey.localeCompare(right.fenceKey),
    );

const canonicalRebuild = (rebuild: RetrievalPublicationJobInput["rebuild"]) =>
  rebuild === undefined
    ? null
    : {
        limit: rebuild.limit,
        phase: rebuild.phase ?? null,
        phaseHighWater: rebuild.phaseHighWater ?? null,
        afterSourceKey: rebuild.afterSourceKey ?? null,
        discoveredCount: rebuild.discoveredCount ?? null,
        publishedCount: rebuild.publishedCount ?? null,
      };

export const retrievalPublicationEffectClass = (
  input: Pick<RetrievalPublicationJobInput, "effectClass" | "originKind">,
): RetrievalPublicationEffectClass =>
  input.effectClass ??
  (input.originKind.endsWith("_rebuild")
    ? "rebuild_batch"
    : "direct_publication");

export const retrievalPublicationAuthorityDigest = (
  context: RetrievalPublicationAuthorityContext,
) =>
  `raud_${sha256Hex(
    JSON.stringify({
      ...context,
      eligibilityFences: canonicalFenceSnapshots(context.eligibilityFences),
    }),
  )}`;

export const retrievalPublicationSubjectIncarnationKey = (input: {
  readonly publicationSubjectKey: string;
  readonly lifecycleFenceKey: string;
  readonly lifecycleGeneration: number;
}) =>
  `rinc_${sha256Hex(
    JSON.stringify({
      publicationSubjectKey: input.publicationSubjectKey,
      lifecycleFenceKey: input.lifecycleFenceKey,
      lifecycleGeneration: input.lifecycleGeneration,
    }),
  )}`;

export const retrievalPublicationAuthorityEnvelope = (
  input: Omit<RetrievalPublicationJobInput, "authorityContext">,
  context: RetrievalPublicationAuthorityContext,
  now: number,
): RetrievalPublicationAuthorityEnvelope => {
  const authorityDigest = retrievalPublicationAuthorityDigest(context);
  return {
    ...context,
    eligibilityFences: canonicalFenceSnapshots(context.eligibilityFences),
    authorityDigest,
    stableEffectKey: `rfx_${sha256Hex(
      JSON.stringify({
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        originKind: input.originKind,
        effectClass: retrievalPublicationEffectClass(input),
        operation: input.operation ?? "publish",
        sourceKey: input.sourceKey,
        sourceRevisionKey: input.sourceRevisionKey,
        ingestionObligationKey: input.ingestionObligationKey ?? null,
        providerTargetResolutionIntentId:
          input.providerTargetResolutionIntentId ?? null,
        providerTargetResolutionGeneration:
          input.providerTargetResolutionGeneration ?? null,
        requestGeneration: input.requestGeneration,
        rebuildRunKey: input.rebuildRunKey ?? null,
        rebuildRunGeneration: input.rebuildRunGeneration ?? null,
        rebuildLedgerHighWater: input.rebuildLedgerHighWater ?? null,
        rebuildPauseEpoch: input.rebuildPauseEpoch ?? null,
        rebuildPredecessorDigest: input.rebuildPredecessorDigest ?? null,
        parentRebuildJobKey: input.parentRebuildJobKey ?? null,
        page: input.page ?? null,
        rebuild: canonicalRebuild(input.rebuild),
        authorityDigest,
      }),
    )}`,
    capturedAt: now,
  };
};

export const retrievalPublicationJobKey = (
  input: RetrievalPublicationJobInput,
) =>
  `rjob_${sha256Hex(
    JSON.stringify({
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      originKind: input.originKind,
      effectClass: retrievalPublicationEffectClass(input),
      operation: input.operation ?? "publish",
      sourceKey: input.sourceKey,
      sourceRevisionKey: input.sourceRevisionKey,
      ingestionObligationKey: input.ingestionObligationKey ?? null,
      providerTargetResolutionIntentId:
        input.providerTargetResolutionIntentId ?? null,
      providerTargetResolutionGeneration:
        input.providerTargetResolutionGeneration ?? null,
      requestGeneration: input.requestGeneration,
      rebuildRunKey: input.rebuildRunKey ?? null,
      rebuildRunGeneration: input.rebuildRunGeneration ?? null,
      rebuildLedgerHighWater: input.rebuildLedgerHighWater ?? null,
      rebuildPauseEpoch: input.rebuildPauseEpoch ?? null,
      rebuildPredecessorDigest: input.rebuildPredecessorDigest ?? null,
      parentRebuildJobKey: input.parentRebuildJobKey ?? null,
      page: input.page ?? null,
      rebuild: canonicalRebuild(input.rebuild),
      authorityDigest:
        input.authorityContext === undefined
          ? null
          : retrievalPublicationAuthorityDigest(input.authorityContext),
    }),
  )}`;

export const retrievalPublicationJobRow = (
  input: RetrievalPublicationJobInput,
  now: number,
) => {
  const identity: Omit<RetrievalPublicationJobInput, "authorityContext"> =
    input;
  return {
    schemaVersion: 1 as const,
    organizationKey: input.organizationKey,
    workspaceId: input.workspaceId,
    brainKey: input.brainKey,
    jobKey: retrievalPublicationJobKey(input),
    originKind: input.originKind,
    effectClass: retrievalPublicationEffectClass(input),
    operation: input.operation ?? "publish",
    sourceKey: input.sourceKey,
    sourceRevisionKey: input.sourceRevisionKey,
    ...(input.ingestionObligationKey === undefined
      ? {}
      : { ingestionObligationKey: input.ingestionObligationKey }),
    requestGeneration: input.requestGeneration,
    ...(input.rebuildRunKey === undefined
      ? {}
      : { rebuildRunKey: input.rebuildRunKey }),
    ...(input.rebuildRunGeneration === undefined
      ? {}
      : { rebuildRunGeneration: input.rebuildRunGeneration }),
    ...(input.rebuildLedgerHighWater === undefined
      ? {}
      : { rebuildLedgerHighWater: input.rebuildLedgerHighWater }),
    ...(input.rebuildPauseEpoch === undefined
      ? {}
      : { rebuildPauseEpoch: input.rebuildPauseEpoch }),
    ...(input.rebuildPredecessorDigest === undefined
      ? {}
      : { rebuildPredecessorDigest: input.rebuildPredecessorDigest }),
    ...(input.parentRebuildJobKey === undefined
      ? {}
      : { parentRebuildJobKey: input.parentRebuildJobKey }),
    ...(input.page === undefined ? {} : { page: input.page }),
    ...(input.rebuild === undefined ? {} : { rebuild: input.rebuild }),
    ...(input.authorityContext?.targetResolutionIntentKey === undefined
      ? {}
      : {
          targetResolutionIntentKey:
            input.authorityContext.targetResolutionIntentKey,
        }),
    ...(input.authorityContext?.providerTargetResolutionIntentId === undefined
      ? {}
      : {
          providerTargetResolutionIntentId:
            input.authorityContext.providerTargetResolutionIntentId,
          providerTargetResolutionGeneration:
            input.authorityContext.providerTargetResolutionGeneration,
        }),
    ...(input.authorityContext === undefined
      ? {}
      : (() => {
          const authorityEnvelope = retrievalPublicationAuthorityEnvelope(
            identity,
            input.authorityContext,
            now,
          );
          return {
            authorityDigest: authorityEnvelope.authorityDigest,
            authorityEnvelope: {
              ...authorityEnvelope,
              eligibilityFences: authorityEnvelope.eligibilityFences.map(
                (fence) => ({ ...fence }),
              ),
            },
          };
        })()),
    status: "pending" as const,
    attemptCount: 0,
    maxAttempts: 5,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
};
