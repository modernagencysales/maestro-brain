import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { DatabaseWriter, MutationCtx } from "../_generated/server";
import { ingestSlackEvent } from "../../confect/slack/ingress";
import {
  retrievalPublicationJobKey,
  retrievalPublicationJobRow,
} from "../../confect/brain/retrievalPublicationJob";
import {
  retrievalEligibilityFenceKey,
  type RetrievalEligibilityFenceKind,
} from "../../confect/brain/retrievalPublication";
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
  if (intent.status === "succeeded")
    return {
      status: "succeeded" as const,
      targetCount: intent.targetCount,
    };
  const attemptCount = intent.attemptCount + 1;
  const organization = await ctx.db
    .query("organizations")
    .withIndex("by_agency_key", (q) =>
      q.eq("agencyKey", receipt.organizationKey),
    )
    .unique();
  if (organization === null) {
    await ctx.db.patch(intent._id, {
      status: "succeeded",
      attemptCount,
      nextAttemptAt: now,
      lastErrorTag: null,
      targetCount: 0,
      completedAt: now,
      updatedAt: now,
    });
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
      receiptId,
      attemptCount,
      "SlackActivePolicyCapacityExceeded",
      now,
    );
  if (workspaces.length > MAX_ACTIVE_WORKSPACES_PER_ORGANIZATION)
    return await retryResolution(
      ctx,
      intent._id,
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
  let targetCount = 0;
  for (const workspace of workspaces) {
    if (
      workspace.brainKey === undefined ||
      !targetGenerations.has(workspace.brainKey)
    )
      continue;
    const jobInput = {
      organizationKey: receipt.organizationKey,
      workspaceId: String(workspace._id),
      brainKey: workspace.brainKey,
      originKind: "slack" as const,
      sourceKey: receipt.sourceKey,
      sourceRevisionKey: receipt.sourceRevisionKey,
      requestGeneration: targetGenerations.get(workspace.brainKey) ?? 1,
    };
    const jobKey = retrievalPublicationJobKey(jobInput);
    const existing = await ctx.db
      .query("retrievalPublicationJobs")
      .withIndex("by_job_key", (q) => q.eq("jobKey", jobKey))
      .unique();
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
    targetCount += 1;
  }
  await ctx.db.patch(intent._id, {
    status: "succeeded",
    attemptCount,
    nextAttemptAt: now,
    lastErrorTag: null,
    targetCount,
    completedAt: now,
    updatedAt: now,
  });
  return { status: "succeeded" as const, targetCount };
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
    if (receipt === null) throw new Error("SlackCaptureReceiptMissing");
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
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: i.receivedAt,
        lastErrorTag: null,
        targetCount: 0,
        completedAt: null,
        createdAt: i.receivedAt,
        updatedAt: i.receivedAt,
      });
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
    const due = [...pending, ...retryWait]
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
