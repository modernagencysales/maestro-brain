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
const receiptFor = async (db: any, input: any) =>
  await db
    .query("providerEventReceipts")
    .withIndex("by_connection_generation_transport_delivery", (q: any) =>
      q
        .eq("organizationKey", input.organizationKey)
        .eq("connectionKey", input.connectionKey)
        .eq("connectionGeneration", input.connectionGeneration)
        .eq("transport", "live")
        .eq("transportDeliveryId", input.transportDeliveryId),
    )
    .unique();
const replayFor = async (db: any, input: any) => {
  const rows = await db
    .query("providerEventReceipts")
    .withIndex("by_received_at", (q: any) =>
      q.eq("organizationKey", input.organizationKey),
    )
    .collect();
  return (
    rows.find(
      (row: any) =>
        row.connectionKey === input.connectionKey &&
        row.connectionGeneration === input.connectionGeneration &&
        row.providerEventId === input.providerEventId,
    ) ?? null
  );
};
const artifactFor = async (db: any, input: any) => {
  const event = input.payload?.event;
  const timestamp = event?.ts ?? event?.deleted_ts ?? "";
  return await db
    .query("sourceArtifacts")
    .withIndex("by_channel_provider_object", (q: any) =>
      q
        .eq("channelKey", input.channelKey)
        .eq(
          "providerObjectId",
          `${input.externalChannelId}:${String(timestamp)}`,
        ),
    )
    .unique();
};
export const receiveSlackEvent = internalMutationGeneric({
  args,
  returns: v.object({ outcome: v.string() }),
  handler: async (ctx, input) =>
    await ingestSlackEvent(
      {
        findReceipt: (deliveryId) =>
          receiptFor(ctx.db, { ...input, transportDeliveryId: deliveryId }),
        findReplay: () => replayFor(ctx.db, input),
        findArtifact: () => artifactFor(ctx.db, input),
        insert: (table, row) => ctx.db.insert(table as any, row as any),
        patchArtifact: (existing, row) =>
          ctx.db.patch((existing as any)._id, row as any),
      },
      input,
    ),
});
