import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import type { DatabaseWriter } from "../_generated/server";
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
  returns: v.object({ outcome: v.string() }),
  handler: async (ctx, i) =>
    await ingestSlackEvent(
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
    ),
});
