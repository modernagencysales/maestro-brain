import { internalMutationGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { DatabaseWriter } from "../_generated/server";
import { ingestSlackEvent } from "../../confect/slack/ingress";
import {
  retrievalPublicationJobKey,
  retrievalPublicationJobRow,
} from "../../confect/brain/retrievalPublicationJob";
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
  const r = await db
    .query("providerEventReceipts")
    .withIndex("by_received_at", (q) =>
      q.eq("organizationKey", i.organizationKey),
    )
    .collect();
  return (
    r.find((x) => {
      const receipt = x as Record<string, unknown>;
      return (
        receipt.connectionKey === i.connectionKey &&
        receipt.connectionGeneration === i.connectionGeneration &&
        receipt.providerEventId === i.providerEventId
      );
    }) ?? null
  );
};
const artifactFor = async (db: IngressDb, i: IngressInput) => {
  const payload = i.payload as {
    event?: { ts?: unknown; deleted_ts?: unknown };
  };
  const e = payload.event,
    t = e?.ts ?? e?.deleted_ts ?? "";
  return await db
    .query("sourceArtifacts")
    .withIndex("by_channel_provider_object", (q) =>
      q
        .eq("channelKey", i.channelKey)
        .eq("providerObjectId", `${i.externalChannelId}:${String(t)}`),
    )
    .unique();
};
export const receiveSlackEvent = internalMutationGeneric({
  args,
  returns: v.object({
    outcome: v.string(),
    sourceKey: v.optional(v.string()),
    sourceRevisionKey: v.optional(v.string()),
  }),
  handler: async (ctx, i) => {
    const result = await ingestSlackEvent(
      {
        findReceipt: (d) =>
          receiptFor(ctx.db, { ...i, transportDeliveryId: d }),
        findReplay: () => replayFor(ctx.db, i),
        findArtifact: () => artifactFor(ctx.db, i),
        insert: (t, r) => ctx.db.insert(t as never, r as never),
        patchArtifact: (e, r) =>
          ctx.db.patch(
            (e as { readonly _id: string })._id as never,
            r as never,
          ),
      },
      i,
    );
    if (result.sourceRevisionKey === undefined) return result;
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_agency_key", (q) => q.eq("agencyKey", i.organizationKey))
      .unique();
    if (organization === null) return result;
    const [policies, workspaces] = await Promise.all([
      ctx.db
        .query("channelRoutingPolicies")
        .withIndex("by_channel_active", (q) => q.eq("channelKey", i.channelKey))
        .take(10),
      ctx.db
        .query("workspaces")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organization._id),
        )
        .take(26),
    ]);
    const targetGenerations = new Map<string, number>();
    for (const policy of policies) {
      if (!policy.active || policy.mode === "capture_only") continue;
      for (const targetBrainKey of policy.targetBrainKeys)
        targetGenerations.set(
          targetBrainKey,
          Math.max(
            policy.policyEpoch,
            targetGenerations.get(targetBrainKey) ?? 0,
          ),
        );
    }
    for (const workspace of workspaces) {
      if (
        workspace.status !== "active" ||
        workspace.brainKey === undefined ||
        !targetGenerations.has(workspace.brainKey)
      )
        continue;
      const jobInput = {
        organizationKey: i.organizationKey,
        workspaceId: String(workspace._id),
        brainKey: workspace.brainKey,
        originKind: "slack" as const,
        sourceKey: result.sourceKey ?? result.sourceRevisionKey,
        sourceRevisionKey: result.sourceRevisionKey,
        requestGeneration: targetGenerations.get(workspace.brainKey) ?? 1,
      };
      const jobKey = retrievalPublicationJobKey(jobInput);
      const existing = await ctx.db
        .query("retrievalPublicationJobs")
        .withIndex("by_job_key", (q) => q.eq("jobKey", jobKey))
        .unique();
      if (existing === null)
        await ctx.db.insert("retrievalPublicationJobs", {
          ...retrievalPublicationJobRow(jobInput, i.receivedAt),
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
            name: "slack-ingress",
            surface: "internal",
          },
          now: i.receivedAt,
        });
    }
    return result;
  },
});
