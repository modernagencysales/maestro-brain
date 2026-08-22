import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { DatabaseWriter, MutationCtx } from "../_generated/server";
import { ingestSlackEvent } from "../../confect/slack/ingress";
import {
  retrievalPublicationAuthorityDigest,
  retrievalPublicationJobKey,
  retrievalPublicationJobRow,
  retrievalPublicationSubjectIncarnationKey,
  type RetrievalPublicationFenceSnapshot,
} from "../../confect/brain/retrievalPublicationJob";
import {
  retrievalEligibilityFenceKey,
  retrievalPublicationSubjectKey,
  type RetrievalEligibilityFenceKind,
} from "../../confect/brain/retrievalPublication";
import {
  providerTargetResolutionAuthorityDigest,
  providerTargetResolutionIntentKey,
  providerTargetResolutionPopulationDigest,
  type LiveCaptureTargetResolutionAuthority,
  type ProviderTargetResolutionTarget,
} from "../../confect/brain/providerTargetResolution";
import { sha256Hex } from "../../confect/shared/sha256";
const MAX_ACTIVE_POLICIES_PER_CHANNEL = 1;
const MAX_ACTIVE_WORKSPACES_PER_ORGANIZATION = 26;
const args = {
  organizationKey: v.string(),
  connectionKey: v.string(),
  connectionGeneration: v.number(),
  teamId: v.string(),
  appId: v.string(),
  botUserId: v.string(),
  channelKey: v.string(),
  externalChannelId: v.string(),
  connectionStatus: v.string(),
  channelMembershipStatus: v.string(),
  signingSecret: v.string(),
  timestamp: v.string(),
  nowMillis: v.number(),
  signature: v.string(),
  providerEventId: v.string(),
  transportDeliveryId: v.string(),
  rawBody: v.string(),
  payload: v.any(),
  receivedAt: v.number(),
  routing: v.object({
    policyEpoch: v.number(),
    assemblyStage: v.literal("assembly_pending"),
    effectKey: v.string(),
  }),
};
type IngressInput = Readonly<{
  organizationKey: string;
  connectionKey: string;
  connectionGeneration: number;
  channelKey: string;
  externalChannelId: string;
  providerEventId: string;
  transportDeliveryId: string;
  payload: unknown;
}>;
type IngressDb = Pick<DatabaseWriter, "query" | "insert" | "patch">;
type SlackArtifactFenceInput = {
  readonly organizationKey: string;
  readonly sourceKey: string;
  readonly lifecycle: { readonly state: string };
  readonly updatedAt: number;
};
type FenceIdentity = {
  readonly organizationKey: string;
  readonly kind: RetrievalEligibilityFenceKind;
  readonly controllerKey: string;
};
const stableKey = (prefix: string, value: unknown): string =>
  `${prefix}_${sha256Hex(JSON.stringify(value))}`;

const liveSlackParentAuthority = (input: {
  readonly receiptId: Id<"providerEventReceipts">;
  readonly organizationKey: string;
  readonly channelKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly observationDigest: string;
  readonly capturedAt: number;
}): LiveCaptureTargetResolutionAuthority => {
  const ingestionObligationKey = stableKey("iobl", {
    authorityKind: "live_capture",
    providerKind: "slack",
    receiptId: input.receiptId,
    connectionKey: input.connectionKey,
    connectionGeneration: input.connectionGeneration,
    sourceRevisionKey: input.sourceRevisionKey,
  });
  return {
    authorityKind: "live_capture",
    targetResolutionIntentKey: providerTargetResolutionIntentKey({
      ingestionObligationKey,
    }),
    ingestionObligationKey,
    organizationKey: input.organizationKey,
    corpusKey: "slack",
    providerKind: "slack",
    connectorScopeKey: input.channelKey,
    connectionKey: input.connectionKey,
    connectionGeneration: input.connectionGeneration,
    membershipKey: input.sourceKey,
    originKind: "slack",
    originKey: input.sourceKey,
    originRevisionKey: input.sourceRevisionKey,
    observationDigest: input.observationDigest,
    resolutionGeneration: 1,
    captureKey: `slack-receipt:${String(input.receiptId)}`,
    capturedAt: input.capturedAt,
  };
};

const progressSlackLiveParentObligation = async (
  ctx: MutationCtx,
  providerIntentId: Id<"providerTargetResolutionIntents">,
  now: number,
) => {
  const intent = await ctx.db.get(providerIntentId);
  if (intent === null || intent.authorityKind !== "live_capture")
    throw new Error("SlackProviderTargetResolutionIntentMissing");
  const parentRows = await ctx.db
    .query("ingestionObligations")
    .withIndex("by_ingestion_obligation_key", (query) =>
      query.eq("ingestionObligationKey", intent.ingestionObligationKey),
    )
    .take(2);
  if (parentRows.length > 1)
    throw new Error("SlackLiveParentObligationConflict");
  const parent = parentRows[0];
  if (
    parent !== undefined &&
    (parent.authorityKind !== "live_capture" ||
      parent.parentIngestionObligationKey !== undefined ||
      parent.workspaceId !== undefined ||
      parent.brainKey !== undefined ||
      parent.allowlistGeneration !== undefined ||
      parent.requiredScopeIntentKey !== undefined ||
      parent.organizationKey !== intent.organizationKey ||
      parent.corpusKey !== "slack" ||
      parent.providerKind !== "slack" ||
      parent.connectorScopeKey !== intent.connectorScopeKey ||
      parent.connectionKey !== intent.connectionKey ||
      parent.connectionGeneration !== intent.connectionGeneration ||
      parent.originKind !== "slack" ||
      parent.originKey !== intent.originKey ||
      parent.originRevisionKey !== intent.originRevisionKey ||
      parent.targetResolutionIntentId !== intent._id ||
      parent.targetResolutionIntentKey !== intent.targetResolutionIntentKey)
  )
    throw new Error("SlackLiveParentObligationAuthorityConflict");

  let state:
    | "target_resolution_pending"
    | "retry_wait"
    | "capacity_blocked"
    | "drain_pending"
    | "complete"
    | "policy_excluded"
    | "failed";
  let errorTag = intent.lastErrorTag;
  if (intent.status === "pending") state = "target_resolution_pending";
  else if (intent.status === "retry_wait")
    state = /CapacityExceeded$/.test(intent.lastErrorTag ?? "")
      ? "capacity_blocked"
      : "retry_wait";
  else if (intent.status === "capacity_blocked") state = "capacity_blocked";
  else if (intent.status === "policy_excluded" || intent.status === "stale") {
    state = "policy_excluded";
    errorTag = null;
  } else if (intent.status === "integrity_failure") {
    state = "failed";
    errorTag ??= "SlackTargetResolutionIntegrityFailure";
  } else {
    const expectedChildKeys = intent.targets.flatMap((target) =>
      target.childIngestionObligationKey === undefined
        ? []
        : [target.childIngestionObligationKey],
    );
    const children = await ctx.db
      .query("ingestionObligations")
      .withIndex("by_parent_obligation_state", (query) =>
        query.eq("parentIngestionObligationKey", intent.ingestionObligationKey),
      )
      .take(101);
    const exactChildPopulation =
      children.length <= 100 &&
      intent.targetCount > 0 &&
      expectedChildKeys.length === intent.targetCount &&
      new Set(expectedChildKeys).size === intent.targetCount &&
      children.length === intent.targetCount &&
      children.every(
        (child) =>
          child.authorityKind === "live_capture" &&
          child.targetResolutionIntentId === intent._id &&
          expectedChildKeys.includes(child.ingestionObligationKey),
      );
    if (!exactChildPopulation) {
      state = children.length > 100 ? "failed" : "drain_pending";
      errorTag =
        children.length > 100
          ? "SlackLiveChildPopulationCapacityExceeded"
          : null;
    } else if (
      children.some(
        (child) => child.state === "failed" || child.state === "quarantined",
      )
    ) {
      state = "failed";
      errorTag = "SlackLiveChildFailed";
    } else if (
      children.every(
        (child) =>
          child.state === "complete" || child.state === "policy_excluded",
      )
    ) {
      state = "complete";
      errorTag = null;
    } else {
      state = "drain_pending";
      errorTag = null;
    }
  }
  const terminal =
    state === "complete" || state === "policy_excluded" || state === "failed";
  const row = {
    schemaVersion: 1 as const,
    authorityKind: "live_capture" as const,
    organizationKey: intent.organizationKey,
    corpusKey: "slack" as const,
    providerKind: "slack" as const,
    connectorScopeKey: intent.connectorScopeKey,
    connectionKey: intent.connectionKey,
    connectionGeneration: intent.connectionGeneration,
    ingestionObligationKey: intent.ingestionObligationKey,
    cause: "observation" as const,
    membershipKey: intent.membershipKey,
    originKind: "slack" as const,
    originKey: intent.originKey,
    originRevisionKey: intent.originRevisionKey,
    ledgerSequence: intent.capturedAt ?? now,
    state,
    targetResolutionIntentId: intent._id,
    targetResolutionIntentKey: intent.targetResolutionIntentKey,
    publicationJobKeys: [] as string[],
    errorTag,
    terminalAt: terminal ? now : null,
    createdAt: intent.createdAt,
    updatedAt: now,
  };
  if (parent === undefined) await ctx.db.insert("ingestionObligations", row);
  else if (
    parent.state !== state ||
    parent.errorTag !== errorTag ||
    (terminal ? parent.terminalAt === null : parent.terminalAt !== null)
  )
    await ctx.db.patch(parent._id, {
      state,
      errorTag,
      terminalAt: terminal ? now : null,
      updatedAt: now,
    });
};

const ensureSlackRequiredScope = async (
  ctx: MutationCtx,
  input: {
    readonly organizationKey: string;
    readonly workspaceId: Id<"workspaces">;
    readonly brainKey: string;
    readonly connectorScopeKey: string;
    readonly connectionKey: string;
    readonly connectionGeneration: number;
    readonly policyGeneration: number;
    readonly controllingConfigurationDigest: string;
    readonly now: number;
  },
) => {
  const allowlistGeneration = input.policyGeneration;
  const allowlistGenerationKey = stableKey("calg", {
    connectorScopeKey: input.connectorScopeKey,
    connectionGeneration: input.connectionGeneration,
    allowlistGeneration,
    controllingConfigurationDigest: input.controllingConfigurationDigest,
  });
  const allowlists = await ctx.db
    .query("connectorAllowlistGenerations")
    .withIndex("by_scope_generation", (query) =>
      query
        .eq("connectorScopeKey", input.connectorScopeKey)
        .eq("allowlistGeneration", allowlistGeneration),
    )
    .take(2);
  if (allowlists.length > 1) throw new Error("SlackAllowlistConflict");
  const allowlist = allowlists[0];
  if (
    allowlist !== undefined &&
    (allowlist.organizationKey !== input.organizationKey ||
      allowlist.allowlistGenerationKey !== allowlistGenerationKey ||
      allowlist.connectionKey !== input.connectionKey ||
      allowlist.connectionGeneration !== input.connectionGeneration ||
      allowlist.configurationDigest !== input.controllingConfigurationDigest)
  )
    throw new Error("SlackAllowlistAuthorityConflict");
  if (allowlist === undefined)
    await ctx.db.insert("connectorAllowlistGenerations", {
      schemaVersion: 1,
      organizationKey: input.organizationKey,
      connectorScopeKey: input.connectorScopeKey,
      allowlistGenerationKey,
      connectionKey: input.connectionKey,
      connectionGeneration: input.connectionGeneration,
      allowlistGeneration,
      configurationDigest: input.controllingConfigurationDigest,
      memberCount: 0,
      state: "current",
      createdAt: input.now,
      supersededAt: null,
    });

  const scopes = await ctx.db
    .query("connectorScopes")
    .withIndex("by_connector_scope_key", (query) =>
      query.eq("connectorScopeKey", input.connectorScopeKey),
    )
    .take(2);
  if (scopes.length > 1) throw new Error("SlackConnectorScopeConflict");
  const scope = scopes[0];
  if (
    scope !== undefined &&
    (scope.organizationKey !== input.organizationKey ||
      scope.providerKind !== "slack" ||
      scope.providerContainerKey !== input.connectorScopeKey ||
      scope.connectionKey !== input.connectionKey)
  )
    throw new Error("SlackConnectorScopeAuthorityConflict");
  if (scope === undefined)
    await ctx.db.insert("connectorScopes", {
      schemaVersion: 1,
      organizationKey: input.organizationKey,
      connectorScopeKey: input.connectorScopeKey,
      providerKind: "slack",
      providerContainerKey: input.connectorScopeKey,
      connectionKey: input.connectionKey,
      currentConnectionGeneration: input.connectionGeneration,
      currentAllowlistGeneration: allowlistGeneration,
      scopeGeneration: 1,
      state: "active",
      createdAt: input.now,
      updatedAt: input.now,
    });
  else if (
    scope.state !== "active" ||
    scope.currentConnectionGeneration !== input.connectionGeneration ||
    scope.currentAllowlistGeneration !== allowlistGeneration
  )
    await ctx.db.patch(scope._id, {
      currentConnectionGeneration: input.connectionGeneration,
      currentAllowlistGeneration: allowlistGeneration,
      scopeGeneration: scope.scopeGeneration + 1,
      state: "active",
      updatedAt: input.now,
    });

  const requiredScopeIntentKey = stableKey("brsi", {
    workspaceId: input.workspaceId,
    brainKey: input.brainKey,
    corpusKey: "slack",
    providerKind: "slack",
    connectorScopeKey: input.connectorScopeKey,
  });
  const intents = await ctx.db
    .query("brainRequiredScopeIntents")
    .withIndex("by_required_scope_intent_key", (query) =>
      query.eq("requiredScopeIntentKey", requiredScopeIntentKey),
    )
    .take(2);
  if (intents.length > 1) throw new Error("SlackRequiredScopeConflict");
  const existing = intents[0];
  const intentGeneration =
    existing !== undefined &&
    existing.organizationKey === input.organizationKey &&
    existing.workspaceId === input.workspaceId &&
    existing.brainKey === input.brainKey &&
    existing.corpusKey === "slack" &&
    existing.providerKind === "slack" &&
    existing.connectorScopeKey === input.connectorScopeKey &&
    existing.connectionKey === input.connectionKey &&
    existing.connectionGeneration === input.connectionGeneration &&
    existing.allowlistGeneration === allowlistGeneration &&
    existing.controllingConfigurationDigest ===
      input.controllingConfigurationDigest &&
    existing.state === "required"
      ? existing.intentGeneration
      : (existing?.intentGeneration ?? 0) + 1;
  const required = {
    schemaVersion: 1 as const,
    organizationKey: input.organizationKey,
    workspaceId: input.workspaceId,
    brainKey: input.brainKey,
    corpusKey: "slack" as const,
    providerKind: "slack" as const,
    connectorScopeKey: input.connectorScopeKey,
    connectionKey: input.connectionKey,
    connectionGeneration: input.connectionGeneration,
    allowlistGeneration,
    requiredScopeIntentKey,
    intentGeneration,
    controllingConfigurationDigest: input.controllingConfigurationDigest,
    state: "required" as const,
    decommissionGeneration: null,
    activatedAt:
      existing?.state === "required" ? existing.activatedAt : input.now,
    decommissionedAt: null,
    updatedAt: input.now,
  };
  if (existing === undefined)
    await ctx.db.insert("brainRequiredScopeIntents", required);
  else if (intentGeneration !== existing.intentGeneration)
    await ctx.db.patch(existing._id, required);
  return { requiredScopeIntentKey, allowlistGeneration };
};
const ensureFenceSnapshot = async (
  db: IngressDb,
  input: {
    readonly identity: FenceIdentity;
    readonly eligible: boolean;
    readonly now: number;
  },
): Promise<RetrievalPublicationFenceSnapshot> => {
  const fenceKey = retrievalEligibilityFenceKey(input.identity);
  const rows = await db
    .query("retrievalEligibilityFences")
    .withIndex("by_organization_fence", (query) =>
      query
        .eq("organizationKey", input.identity.organizationKey)
        .eq("fenceKey", fenceKey),
    )
    .take(2);
  if (rows.length > 1) throw new Error("SlackEligibilityFenceConflict");
  const stored = rows[0];
  if (stored === undefined) {
    await db.insert("retrievalEligibilityFences", {
      schemaVersion: 1,
      organizationKey: input.identity.organizationKey,
      fenceKey,
      kind: input.identity.kind,
      controllerKey: input.identity.controllerKey,
      eligibilityGeneration: 1,
      eligible: input.eligible,
      updatedAt: input.now,
    });
    return {
      kind: input.identity.kind,
      fenceKey,
      eligibilityGeneration: 1,
      eligible: input.eligible,
      controllerKey: input.identity.controllerKey,
    };
  }
  if (
    stored.kind !== input.identity.kind ||
    stored.controllerKey !== input.identity.controllerKey
  )
    throw new Error("SlackEligibilityFenceControllerMismatch");
  return {
    kind: stored.kind,
    fenceKey: stored.fenceKey,
    eligibilityGeneration: stored.eligibilityGeneration,
    eligible: stored.eligible,
    controllerKey: stored.controllerKey,
  };
};
const transitionSlackArtifactFence = async (
  db: IngressDb,
  artifact: SlackArtifactFenceInput,
) => {
  const kind: RetrievalEligibilityFenceKind = "lifecycle";
  const controllerKey = `slack-source:${artifact.organizationKey}:${artifact.sourceKey}`;
  const fenceKey = retrievalEligibilityFenceKey({
    organizationKey: artifact.organizationKey,
    kind,
    controllerKey,
  });
  const rows = await db
    .query("retrievalEligibilityFences")
    .withIndex("by_organization_fence", (query) =>
      query
        .eq("organizationKey", artifact.organizationKey)
        .eq("fenceKey", fenceKey),
    )
    .take(2);
  if (rows.length > 1) throw new Error("SlackEligibilityFenceConflict");
  const eligible = artifact.lifecycle.state === "active";
  const stored = rows[0];
  if (stored === undefined) {
    await db.insert("retrievalEligibilityFences", {
      schemaVersion: 1,
      organizationKey: artifact.organizationKey,
      fenceKey,
      kind,
      controllerKey,
      eligibilityGeneration: 1,
      eligible,
      updatedAt: artifact.updatedAt,
    });
    return;
  }
  if (stored.eligible === eligible) return;
  await db.patch(stored._id, {
    eligibilityGeneration: stored.eligibilityGeneration + 1,
    eligible,
    updatedAt: artifact.updatedAt,
  });
};
const runPublicationJob = makeFunctionReference<
  "mutation",
  {
    jobKey: string;
    caller: {
      kind: "system";
      name: string;
      surface: "internal";
    };
    now: number;
  },
  unknown
>("brain/retrievalPublication:runPublicationJob");
const resolveSlackPublicationTargetsRef = makeFunctionReference<
  "mutation",
  { receiptId: string; now: number },
  unknown
>("slack/ingress:resolveSlackPublicationTargets");
const receiptFor = async (db: IngressDb, i: IngressInput) =>
  await db
    .query("providerEventReceipts")
    .withIndex("by_connection_generation_transport_delivery", (q) =>
      q
        .eq("organizationKey", i.organizationKey)
        .eq("connectionKey", i.connectionKey)
        .eq("connectionGeneration", i.connectionGeneration)
        .eq("transport", "live")
        .eq("transportDeliveryId", i.transportDeliveryId),
    )
    .unique();
const replayFor = async (db: IngressDb, i: IngressInput) => {
  return await db
    .query("providerEventReceipts")
    .withIndex("by_connection_generation_provider_event", (q) =>
      q
        .eq("organizationKey", i.organizationKey)
        .eq("connectionKey", i.connectionKey)
        .eq("connectionGeneration", i.connectionGeneration)
        .eq("providerEventId", i.providerEventId),
    )
    .first();
};
const artifactFor = async (
  db: IngressDb,
  i: IngressInput,
  providerObjectId: string,
) => {
  return await db
    .query("sourceArtifacts")
    .withIndex("by_org_connection_generation_channel_provider_object", (q) =>
      q
        .eq("organizationKey", i.organizationKey)
        .eq("connectionKey", i.connectionKey)
        .eq("connectionGeneration", i.connectionGeneration)
        .eq("channelKey", i.channelKey)
        .eq("providerObjectId", providerObjectId),
    )
    .unique();
};
const retryResolution = async (
  ctx: MutationCtx,
  intentId: Id<"slackPublicationTargetIntents">,
  providerIntentId: Id<"providerTargetResolutionIntents">,
  receiptId: Id<"providerEventReceipts">,
  attemptCount: number,
  errorTag: string,
  now: number,
) => {
  const delay = Math.min(60_000, 1_000 * 2 ** Math.max(0, attemptCount - 1));
  await ctx.db.patch(intentId, {
    status: "retry_wait",
    attemptCount,
    nextAttemptAt: now + delay,
    lastErrorTag: errorTag,
    targetCount: 0,
    updatedAt: now,
  });
  const providerIntent = await ctx.db.get(providerIntentId);
  if (providerIntent === null)
    throw new Error("SlackProviderTargetResolutionIntentMissing");
  await ctx.db.patch(providerIntentId, {
    status: "retry_wait",
    attemptCount: providerIntent.attemptCount + 1,
    nextAttemptAt: now + delay,
    lastErrorTag: errorTag,
    targetCount: 0,
    targetDigest: null,
    targets: [],
    completedAt: null,
    updatedAt: now,
  });
  await progressSlackLiveParentObligation(ctx, providerIntentId, now);
  await ctx.scheduler.runAfter(delay, resolveSlackPublicationTargetsRef, {
    receiptId,
    now: now + delay,
  });
  return { status: "retry_wait" as const, targetCount: 0, errorTag };
};
const resolveTargets = async (
  ctx: MutationCtx,
  receiptId: Id<"providerEventReceipts">,
  now: number,
) => {
  const receipt = await ctx.db.get(receiptId);
  if (receipt === null || receipt.sourceRevisionKey === null)
    return { status: "succeeded" as const, targetCount: 0 };
  const intent = await ctx.db
    .query("slackPublicationTargetIntents")
    .withIndex("by_receipt_id", (q) => q.eq("receiptId", receiptId))
    .unique();
  if (intent === null) throw new Error("SlackPublicationTargetIntentMissing");
  if (intent.providerTargetResolutionIntentId === undefined)
    throw new Error("SlackProviderTargetResolutionIntentMissing");
  const providerIntent = await ctx.db.get(
    intent.providerTargetResolutionIntentId,
  );
  if (
    providerIntent === null ||
    providerIntent.authorityKind !== "live_capture" ||
    providerIntent.providerKind !== "slack" ||
    providerIntent.organizationKey !== receipt.organizationKey ||
    providerIntent.connectorScopeKey !== receipt.channelKey ||
    providerIntent.connectionKey !== receipt.connectionKey ||
    providerIntent.connectionGeneration !== receipt.connectionGeneration ||
    providerIntent.originKind !== "slack" ||
    providerIntent.originKey !== receipt.sourceKey ||
    providerIntent.originRevisionKey !== receipt.sourceRevisionKey
  )
    throw new Error("SlackProviderTargetResolutionAuthorityConflict");
  const legacySucceededIntent =
    intent.status === "succeeded" &&
    (intent.resolutionGeneration === undefined ||
      intent.targetDigest === undefined ||
      intent.targets === undefined);
  if (
    legacySucceededIntent &&
    (providerIntent.status === "succeeded" ||
      providerIntent.status === "policy_excluded")
  ) {
    const legacyTargets = providerIntent.targets.map((target) => ({
      workspaceId: target.workspaceId,
      brainKey: target.brainKey,
      jobKey: target.jobKey,
    }));
    const targetDigest = `sha256:${sha256Hex(
      JSON.stringify(
        legacyTargets
          .map(
            (target) =>
              `${String(target.workspaceId)}:${target.brainKey}:${target.jobKey}`,
          )
          .sort(),
      ),
    )}`;
    await ctx.db.patch(intent._id, {
      resolutionGeneration: intent.resolutionGeneration ?? 1,
      linkageVersion: 1,
      targetCount: legacyTargets.length,
      targetDigest,
      targets: legacyTargets,
      updatedAt: now,
    });
    await progressSlackLiveParentObligation(ctx, providerIntent._id, now);
    return { status: "succeeded" as const, targetCount: legacyTargets.length };
  }
  if (intent.status === "succeeded" && !legacySucceededIntent) {
    await progressSlackLiveParentObligation(ctx, providerIntent._id, now);
    return {
      status: "succeeded" as const,
      targetCount: intent.targetCount,
    };
  }
  const resolutionGeneration = legacySucceededIntent
    ? (intent.resolutionGeneration ?? 0) + 1
    : (intent.resolutionGeneration ?? 1);
  const attemptCount = intent.attemptCount + 1;
  const organization = await ctx.db
    .query("organizations")
    .withIndex("by_agency_key", (q) =>
      q.eq("agencyKey", receipt.organizationKey),
    )
    .unique();
  if (organization === null) {
    const targetDigest = `sha256:${sha256Hex(JSON.stringify([]))}`;
    await ctx.db.patch(intent._id, {
      status: "succeeded",
      attemptCount,
      nextAttemptAt: now,
      lastErrorTag: null,
      resolutionGeneration,
      linkageVersion: 1,
      targetCount: 0,
      targetDigest,
      targets: [],
      completedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(providerIntent._id, {
      status: "policy_excluded",
      attemptCount: providerIntent.attemptCount + 1,
      nextAttemptAt: now,
      lastErrorTag: null,
      targetCount: 0,
      targetDigest: providerTargetResolutionPopulationDigest([]),
      targets: [],
      completedAt: now,
      updatedAt: now,
    });
    await progressSlackLiveParentObligation(ctx, providerIntent._id, now);
    return { status: "succeeded" as const, targetCount: 0 };
  }
  const [policies, workspaces] = await Promise.all([
    ctx.db
      .query("channelRoutingPolicies")
      .withIndex("by_channel_active", (q) =>
        q.eq("channelKey", receipt.channelKey).eq("active", true),
      )
      .take(MAX_ACTIVE_POLICIES_PER_CHANNEL + 1),
    ctx.db
      .query("workspaces")
      .withIndex("by_organization_status", (q) =>
        q.eq("organizationId", organization._id).eq("status", "active"),
      )
      .take(MAX_ACTIVE_WORKSPACES_PER_ORGANIZATION + 1),
  ]);
  if (policies.length > MAX_ACTIVE_POLICIES_PER_CHANNEL)
    return await retryResolution(
      ctx,
      intent._id,
      providerIntent._id,
      receiptId,
      attemptCount,
      "SlackActivePolicyCapacityExceeded",
      now,
    );
  if (workspaces.length > MAX_ACTIVE_WORKSPACES_PER_ORGANIZATION)
    return await retryResolution(
      ctx,
      intent._id,
      providerIntent._id,
      receiptId,
      attemptCount,
      "SlackActiveWorkspaceCapacityExceeded",
      now,
    );
  const targetGenerations = new Map<string, number>();
  for (const policy of policies) {
    if (policy.mode === "capture_only") continue;
    for (const targetBrainKey of policy.targetBrainKeys)
      targetGenerations.set(
        targetBrainKey,
        Math.max(
          policy.policyEpoch,
          targetGenerations.get(targetBrainKey) ?? 0,
        ),
      );
  }
  const [revision, artifact, connection] = await Promise.all([
    ctx.db
      .query("sourceRevisions")
      .withIndex("by_source_revision_key", (q) =>
        q
          .eq("organizationKey", receipt.organizationKey)
          .eq("sourceRevisionKey", receipt.sourceRevisionKey ?? ""),
      )
      .unique(),
    ctx.db
      .query("sourceArtifacts")
      .withIndex("by_org_source_key", (q) =>
        q
          .eq("organizationKey", receipt.organizationKey)
          .eq("sourceKey", receipt.sourceKey),
      )
      .unique(),
    ctx.db
      .query("providerConnections")
      .withIndex("by_connection_key", (q) =>
        q.eq("connectionKey", receipt.connectionKey),
      )
      .unique(),
  ]);
  if (revision === null || artifact === null || connection === null)
    return await retryResolution(
      ctx,
      intent._id,
      providerIntent._id,
      receiptId,
      attemptCount,
      "SlackPublicationAuthorityUnavailable",
      now,
    );
  const lifecycleFence = await ensureFenceSnapshot(ctx.db, {
    identity: {
      organizationKey: receipt.organizationKey,
      kind: "lifecycle",
      controllerKey: `slack-source:${receipt.organizationKey}:${receipt.sourceKey}`,
    },
    eligible:
      !revision.tombstone &&
      revision.lifecycle.state === "active" &&
      artifact.lifecycle.state === "active",
    now,
  });
  const connectionFence = await ensureFenceSnapshot(ctx.db, {
    identity: {
      organizationKey: receipt.organizationKey,
      kind: "connection",
      controllerKey: `connection:${receipt.connectionKey}`,
    },
    eligible:
      connection.status === "active" &&
      connection.connectionGeneration === receipt.connectionGeneration,
    now,
  });
  const providerTargets: Array<
    ProviderTargetResolutionTarget & {
      workspaceId: Id<"workspaces">;
      childIngestionObligationKey: string;
    }
  > = [];
  const controllingConfigurationDigest = `sha256:${sha256Hex(
    JSON.stringify({
      authorityKind: "live_capture",
      providerKind: "slack",
      organizationKey: receipt.organizationKey,
      connectorScopeKey: receipt.channelKey,
      connectionKey: receipt.connectionKey,
      connectionGeneration: receipt.connectionGeneration,
      policies: policies.map((policy) => ({
        policyEpoch: policy.policyEpoch,
        mode: policy.mode,
        targetBrainKeys: [...policy.targetBrainKeys].sort(),
      })),
    }),
  )}`;
  const legacyTargets: Array<{
    workspaceId: Id<"workspaces">;
    brainKey: string;
    jobKey: string;
  }> = [];
  for (const workspace of workspaces) {
    if (
      workspace.brainKey === undefined ||
      !targetGenerations.has(workspace.brainKey)
    )
      continue;
    const policyGeneration = targetGenerations.get(workspace.brainKey) ?? 1;
    const requiredScope = await ensureSlackRequiredScope(ctx, {
      organizationKey: receipt.organizationKey,
      workspaceId: workspace._id,
      brainKey: workspace.brainKey,
      connectorScopeKey: receipt.channelKey,
      connectionKey: receipt.connectionKey,
      connectionGeneration: receipt.connectionGeneration,
      policyGeneration,
      controllingConfigurationDigest,
      now,
    });
    const childIngestionObligationKey = stableKey("iobl", {
      authorityKind: "live_capture",
      parentIngestionObligationKey: providerIntent.ingestionObligationKey,
      workspaceId: workspace._id,
      brainKey: workspace.brainKey,
      resolutionGeneration: providerIntent.resolutionGeneration,
    });
    const policyFence = await ensureFenceSnapshot(ctx.db, {
      identity: {
        organizationKey: receipt.organizationKey,
        kind: "policy",
        controllerKey: `slack-policy:${receipt.channelKey}:${workspace.brainKey}`,
      },
      eligible: true,
      now,
    });
    const publicationSubjectKey = retrievalPublicationSubjectKey({
      workspaceId: String(workspace._id),
      brainKey: workspace.brainKey,
      corpusKey: "slack",
      originTable: "sourceRevisions",
      kind: "slack",
      sourceKey: receipt.sourceKey,
      connectorScopeKey: receipt.channelKey,
    });
    const jobInput = {
      organizationKey: receipt.organizationKey,
      workspaceId: String(workspace._id),
      brainKey: workspace.brainKey,
      originKind: "slack" as const,
      sourceKey: receipt.sourceKey,
      sourceRevisionKey: receipt.sourceRevisionKey,
      ingestionObligationKey: childIngestionObligationKey,
      providerTargetResolutionIntentId: providerIntent._id,
      providerTargetResolutionGeneration: providerIntent.resolutionGeneration,
      requestGeneration: policyGeneration,
      authorityContext: {
        version: 1 as const,
        publicationSubjectKey,
        subjectIncarnationKey: retrievalPublicationSubjectIncarnationKey({
          publicationSubjectKey,
          lifecycleFenceKey: lifecycleFence.fenceKey,
          lifecycleGeneration: lifecycleFence.eligibilityGeneration,
        }),
        connectorScopeKey: receipt.channelKey,
        configuration: {
          requestGeneration: policyGeneration,
          policyGeneration,
          routeGeneration: policyGeneration,
          lifecycleGeneration: artifact.lifecycle.generation,
          connectionGeneration: receipt.connectionGeneration,
        },
        eligibilityFences: [
          { ...lifecycleFence },
          { ...policyFence },
          { ...connectionFence },
        ],
        observationFence: {
          kind: "revision" as const,
          key: receipt.sourceRevisionKey,
        },
        targetResolutionIntentKey: intent._id,
        targetResolutionGeneration: resolutionGeneration,
        providerTargetResolutionIntentId: providerIntent._id,
        providerTargetResolutionGeneration: providerIntent.resolutionGeneration,
      },
    };
    const jobKey = retrievalPublicationJobKey(jobInput);
    const authorityDigest = retrievalPublicationAuthorityDigest(
      jobInput.authorityContext,
    );
    const existing = await ctx.db
      .query("retrievalPublicationJobs")
      .withIndex("by_job_key", (q) => q.eq("jobKey", jobKey))
      .unique();
    if (
      existing !== null &&
      (existing.organizationKey !== receipt.organizationKey ||
        existing.workspaceId !== workspace._id ||
        existing.brainKey !== workspace.brainKey ||
        existing.originKind !== "slack" ||
        existing.effectClass !== "direct_publication" ||
        existing.sourceKey !== receipt.sourceKey ||
        existing.sourceRevisionKey !== receipt.sourceRevisionKey ||
        existing.ingestionObligationKey !== childIngestionObligationKey ||
        existing.providerTargetResolutionIntentId !== providerIntent._id ||
        existing.providerTargetResolutionGeneration !==
          providerIntent.resolutionGeneration ||
        existing.targetResolutionIntentKey !== intent._id ||
        existing.authorityEnvelope?.targetResolutionIntentKey !== intent._id ||
        existing.authorityEnvelope?.targetResolutionGeneration !==
          resolutionGeneration)
    )
      throw new Error("SlackPublicationChildLinkageConflict");
    const children = await ctx.db
      .query("ingestionObligations")
      .withIndex("by_ingestion_obligation_key", (query) =>
        query.eq("ingestionObligationKey", childIngestionObligationKey),
      )
      .take(2);
    if (children.length > 1)
      throw new Error("SlackIngestionObligationConflict");
    const child = children[0];
    if (
      child !== undefined &&
      (child.authorityKind !== "live_capture" ||
        child.parentIngestionObligationKey !==
          providerIntent.ingestionObligationKey ||
        child.organizationKey !== receipt.organizationKey ||
        child.workspaceId !== workspace._id ||
        child.brainKey !== workspace.brainKey ||
        child.requiredScopeIntentKey !== requiredScope.requiredScopeIntentKey ||
        child.originRevisionKey !== receipt.sourceRevisionKey ||
        child.targetResolutionIntentId !== providerIntent._id ||
        child.publicationJobKeys.length !== 1 ||
        child.publicationJobKeys[0] !== jobKey)
    )
      throw new Error("SlackIngestionObligationAuthorityConflict");
    if (child === undefined)
      await ctx.db.insert("ingestionObligations", {
        schemaVersion: 1,
        authorityKind: "live_capture",
        parentIngestionObligationKey: providerIntent.ingestionObligationKey,
        organizationKey: receipt.organizationKey,
        workspaceId: workspace._id,
        brainKey: workspace.brainKey,
        corpusKey: "slack",
        providerKind: "slack",
        connectorScopeKey: receipt.channelKey,
        connectionKey: receipt.connectionKey,
        connectionGeneration: receipt.connectionGeneration,
        allowlistGeneration: requiredScope.allowlistGeneration,
        ingestionObligationKey: childIngestionObligationKey,
        requiredScopeIntentKey: requiredScope.requiredScopeIntentKey,
        cause: "observation",
        membershipKey: providerIntent.membershipKey,
        originKind: "slack",
        originKey: receipt.sourceKey,
        originRevisionKey: receipt.sourceRevisionKey,
        ledgerSequence: providerIntent.capturedAt ?? now,
        state: "publication_pending",
        targetResolutionIntentId: providerIntent._id,
        targetResolutionIntentKey: providerIntent.targetResolutionIntentKey,
        publicationJobKeys: [jobKey],
        errorTag: null,
        terminalAt: null,
        createdAt: now,
        updatedAt: now,
      });
    if (existing === null)
      await ctx.db.insert("retrievalPublicationJobs", {
        ...retrievalPublicationJobRow(jobInput, now),
        workspaceId: workspace._id,
      });
    if (
      existing === null ||
      existing.status === "pending" ||
      existing.status === "retry_wait"
    )
      await ctx.scheduler.runAfter(0, runPublicationJob, {
        jobKey,
        caller: {
          kind: "system",
          name: "slack-ingress-target-resolution",
          surface: "internal",
        },
        now,
      });
    legacyTargets.push({
      workspaceId: workspace._id,
      brainKey: workspace.brainKey,
      jobKey,
    });
    providerTargets.push({
      workspaceId: workspace._id,
      brainKey: workspace.brainKey,
      jobKey,
      authorityDigest,
      childIngestionObligationKey,
    });
  }
  const targetDigest = `sha256:${sha256Hex(
    JSON.stringify(
      legacyTargets
        .map(
          (target) =>
            `${String(target.workspaceId)}:${target.brainKey}:${target.jobKey}`,
        )
        .sort(),
    ),
  )}`;
  await ctx.db.patch(intent._id, {
    status: "succeeded",
    attemptCount,
    nextAttemptAt: now,
    lastErrorTag: null,
    resolutionGeneration,
    linkageVersion: 1,
    targetCount: legacyTargets.length,
    targetDigest,
    targets: legacyTargets,
    completedAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(providerIntent._id, {
    status: providerTargets.length === 0 ? "policy_excluded" : "succeeded",
    attemptCount: providerIntent.attemptCount + 1,
    nextAttemptAt: now,
    lastErrorTag: null,
    targetCount: providerTargets.length,
    targetDigest: providerTargetResolutionPopulationDigest(providerTargets),
    targets: providerTargets,
    completedAt: now,
    updatedAt: now,
  });
  await progressSlackLiveParentObligation(ctx, providerIntent._id, now);
  return {
    status: "succeeded" as const,
    targetCount: legacyTargets.length,
  };
};
export const receiveSlackEvent = internalMutation({
  args,
  returns: v.object({
    outcome: v.string(),
    sourceKey: v.optional(v.string()),
    sourceRevisionKey: v.optional(v.string()),
    publicationResolution: v.optional(
      v.object({
        status: v.string(),
        errorTag: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, i) => {
    const result = await ingestSlackEvent(
      {
        findReceipt: (d) =>
          receiptFor(ctx.db, { ...i, transportDeliveryId: d }),
        findReplay: () => replayFor(ctx.db, i),
        findArtifact: (_channelKey, providerObjectId) =>
          artifactFor(ctx.db, i, providerObjectId),
        insert: async (t, r) => {
          if (t === "sourceArtifacts")
            await transitionSlackArtifactFence(
              ctx.db,
              r as SlackArtifactFenceInput,
            );
          return await ctx.db.insert(t as never, r as never);
        },
        patchArtifact: async (e, r) => {
          await transitionSlackArtifactFence(
            ctx.db,
            r as SlackArtifactFenceInput,
          );
          await ctx.db.patch(
            (e as { readonly _id: string })._id as never,
            r as never,
          );
        },
      },
      i,
    );
    if (result.sourceRevisionKey === undefined) return result;
    const receipt = await receiptFor(ctx.db, i);
    if (receipt === null || receipt.sourceKey === null)
      throw new Error("SlackCaptureReceiptMissing");
    const revision = await ctx.db
      .query("sourceRevisions")
      .withIndex("by_source_revision_key", (query) =>
        query
          .eq("organizationKey", receipt.organizationKey)
          .eq("sourceRevisionKey", result.sourceRevisionKey ?? ""),
      )
      .unique();
    if (
      revision === null ||
      revision.sourceKey !== receipt.sourceKey ||
      revision.connectionKey !== receipt.connectionKey ||
      revision.connectionGeneration !== receipt.connectionGeneration
    )
      throw new Error("SlackCaptureRevisionAuthorityMissing");
    const providerAuthority = liveSlackParentAuthority({
      receiptId: receipt._id,
      organizationKey: receipt.organizationKey,
      channelKey: receipt.channelKey,
      connectionKey: receipt.connectionKey,
      connectionGeneration: receipt.connectionGeneration,
      sourceKey: receipt.sourceKey,
      sourceRevisionKey: result.sourceRevisionKey,
      observationDigest: revision.contentHash,
      capturedAt: receipt.receivedAt,
    });
    const providerRows = await ctx.db
      .query("providerTargetResolutionIntents")
      .withIndex("by_target_resolution_intent_key", (query) =>
        query.eq(
          "targetResolutionIntentKey",
          providerAuthority.targetResolutionIntentKey,
        ),
      )
      .take(2);
    if (providerRows.length > 1)
      throw new Error("SlackProviderTargetResolutionConflict");
    const existingProvider = providerRows[0];
    if (
      existingProvider !== undefined &&
      (existingProvider.authorityKind !== "live_capture" ||
        existingProvider.authorityDigest !==
          providerTargetResolutionAuthorityDigest(providerAuthority))
    )
      throw new Error("SlackProviderTargetResolutionAuthorityConflict");
    const providerTargetResolutionIntentId =
      existingProvider?._id ??
      (await ctx.db.insert("providerTargetResolutionIntents", {
        schemaVersion: 1,
        ...providerAuthority,
        authorityDigest:
          providerTargetResolutionAuthorityDigest(providerAuthority),
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: i.receivedAt,
        lastErrorTag: null,
        targetCount: 0,
        targetDigest: null,
        targets: [],
        completedAt: null,
        createdAt: i.receivedAt,
        updatedAt: i.receivedAt,
      }));
    await progressSlackLiveParentObligation(
      ctx,
      providerTargetResolutionIntentId,
      i.receivedAt,
    );
    const existingIntent = await ctx.db
      .query("slackPublicationTargetIntents")
      .withIndex("by_receipt_id", (q) => q.eq("receiptId", receipt._id))
      .unique();
    if (existingIntent === null)
      await ctx.db.insert("slackPublicationTargetIntents", {
        schemaVersion: 1,
        receiptId: receipt._id,
        organizationKey: receipt.organizationKey,
        channelKey: receipt.channelKey,
        sourceRevisionKey: result.sourceRevisionKey,
        providerTargetResolutionIntentId,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: i.receivedAt,
        lastErrorTag: null,
        resolutionGeneration: 1,
        targetCount: 0,
        completedAt: null,
        createdAt: i.receivedAt,
        updatedAt: i.receivedAt,
      });
    else if (existingIntent.providerTargetResolutionIntentId === undefined)
      await ctx.db.patch(existingIntent._id, {
        providerTargetResolutionIntentId,
        updatedAt: i.receivedAt,
      });
    else if (
      existingIntent.providerTargetResolutionIntentId !==
      providerTargetResolutionIntentId
    )
      throw new Error("SlackProviderTargetResolutionLinkageConflict");
    await ctx.scheduler.runAfter(0, resolveSlackPublicationTargetsRef, {
      receiptId: receipt._id,
      now: i.receivedAt,
    });
    return { ...result, publicationResolution: { status: "pending" } };
  },
});
export const resolveSlackPublicationTargets = internalMutation({
  args: { receiptId: v.id("providerEventReceipts"), now: v.number() },
  returns: v.object({
    status: v.string(),
    targetCount: v.number(),
    errorTag: v.optional(v.string()),
  }),
  handler: async (ctx, input) =>
    await resolveTargets(ctx, input.receiptId, input.now),
});
export const sweepSlackPublicationTargets = internalMutation({
  args: { limit: v.number(), now: v.optional(v.number()) },
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx, input) => {
    const now = input.now ?? Date.now();
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
    const [pending, retryWait] = await Promise.all([
      ctx.db
        .query("slackPublicationTargetIntents")
        .withIndex("by_status_due", (q) =>
          q.eq("status", "pending").lte("nextAttemptAt", now),
        )
        .take(limit),
      ctx.db
        .query("slackPublicationTargetIntents")
        .withIndex("by_status_due", (q) =>
          q.eq("status", "retry_wait").lte("nextAttemptAt", now),
        )
        .take(limit),
    ]);
    const legacySucceeded = await ctx.db
      .query("slackPublicationTargetIntents")
      .withIndex("by_status_linkage_version", (q) =>
        q.eq("status", "succeeded").eq("linkageVersion", undefined),
      )
      .take(limit);
    const due = [...pending, ...retryWait, ...legacySucceeded]
      .sort(
        (left, right) =>
          left.nextAttemptAt - right.nextAttemptAt ||
          String(left._id).localeCompare(String(right._id)),
      )
      .slice(0, limit);
    for (const intent of due)
      await ctx.scheduler.runAfter(0, resolveSlackPublicationTargetsRef, {
        receiptId: intent.receiptId,
        now,
      });
    return { scheduled: due.length };
  },
});
