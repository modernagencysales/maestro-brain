import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { ingestSlackEvent } from "../../confect/slack/ingress";
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
const receiptFor = async (db: any, i: any) =>
  await db
    .query("providerEventReceipts")
    .withIndex("by_connection_generation_transport_delivery", (q: any) =>
      q
        .eq("organizationKey", i.organizationKey)
        .eq("connectionKey", i.connectionKey)
        .eq("connectionGeneration", i.connectionGeneration)
        .eq("transport", "live")
        .eq("transportDeliveryId", i.transportDeliveryId),
    )
    .unique();
const replayFor = async (db: any, i: any) => {
  const r = await db
    .query("providerEventReceipts")
    .withIndex("by_received_at", (q: any) =>
      q.eq("organizationKey", i.organizationKey),
    )
    .collect();
  return (
    r.find(
      (x: any) =>
        x.connectionKey === i.connectionKey &&
        x.connectionGeneration === i.connectionGeneration &&
        x.providerEventId === i.providerEventId,
    ) ?? null
  );
};
const artifactFor = async (db: any, i: any) => {
  const e = i.payload?.event,
    t = e?.ts ?? e?.deleted_ts ?? "";
  return await db
    .query("sourceArtifacts")
    .withIndex("by_channel_provider_object", (q: any) =>
      q
        .eq("channelKey", i.channelKey)
        .eq("providerObjectId", `${i.externalChannelId}:${String(t)}`),
    )
    .unique();
};
export const receiveSlackEvent = internalMutationGeneric({
  args,
  returns: v.object({ outcome: v.string() }),
  handler: async (ctx, i) =>
    await ingestSlackEvent(
      {
        findReceipt: (d) =>
          receiptFor(ctx.db, { ...i, transportDeliveryId: d }),
        findReplay: () => replayFor(ctx.db, i),
        findArtifact: () => artifactFor(ctx.db, i),
        insert: (t, r) => ctx.db.insert(t as any, r as any),
        patchArtifact: (e, r) => ctx.db.patch((e as any)._id, r as any),
      },
      i,
    ),
});
