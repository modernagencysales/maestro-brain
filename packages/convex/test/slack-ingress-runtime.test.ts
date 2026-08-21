import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import convexSchema from "../confect/_generated/convexSchema";

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");
const makeTest = () => convexTest(convexSchema, modules);

const receiveSlackEvent = makeFunctionReference<
  "mutation",
  {
    organizationKey: string;
    connectionKey: string;
    connectionGeneration: number;
    teamId: string;
    appId: string;
    botUserId: string;
    channelKey: string;
    externalChannelId: string;
    connectionStatus: string;
    channelMembershipStatus: string;
    signingSecret: string;
    timestamp: string;
    nowMillis: number;
    signature: string;
    providerEventId: string;
    transportDeliveryId: string;
    rawBody: string;
    payload: unknown;
    receivedAt: number;
    routing: {
      policyEpoch: number;
      assemblyStage: "assembly_pending";
      effectKey: string;
    };
  },
  {
    outcome: string;
    sourceKey?: string;
    sourceRevisionKey?: string;
  }
>("slack/ingress:receiveSlackEvent");

const secret = "signing-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);

const signatureFor = async (timestamp: string, rawBody: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`v0:${timestamp}:${rawBody}`),
    ),
  );
  return `v0=${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

const payloadFor = (
  eventId: string,
  event: Readonly<Record<string, unknown>>,
) => ({
  event_id: eventId,
  team_id: "T1",
  api_app_id: "A1",
  event,
});

const inputFor = async (
  payload: ReturnType<typeof payloadFor>,
  transportDeliveryId: string,
  receivedAt: number,
) => {
  const timestamp = String(nowSeconds);
  const rawBody = JSON.stringify(payload);
  return {
    organizationKey: "org_1",
    connectionKey: "conn_1",
    connectionGeneration: 2,
    teamId: "T1",
    appId: "A1",
    botUserId: "Ubot",
    channelKey: "chan_1",
    externalChannelId: "C1",
    connectionStatus: "active",
    channelMembershipStatus: "joined_active",
    signingSecret: secret,
    timestamp,
    nowMillis: nowSeconds * 1_000,
    signature: await signatureFor(timestamp, rawBody),
    providerEventId: payload.event_id,
    transportDeliveryId,
    rawBody,
    payload,
    receivedAt,
    routing: {
      policyEpoch: 1,
      assemblyStage: "assembly_pending" as const,
      effectKey: "effect_1",
    },
  };
};

const createPayload = payloadFor("Ev100", {
  type: "message",
  channel: "C1",
  ts: "1700000000.123456",
  thread_ts: "1700000000.000001",
  user: "U2",
  username: "Ada",
  text: "Created text.",
  blocks: [],
  permalink: "https://example.test/slack/p/1",
});

describe("Slack Convex ingress", () => {
  it("detects a replay with the exact bounded index even when legacy duplicates exist", async () => {
    const t = makeTest();
    expect(
      await t.mutation(
        receiveSlackEvent,
        await inputFor(createPayload, "delivery_create", 1_700_000_100_000),
      ),
    ).toMatchObject({ outcome: "inserted" });

    await t.run(async (ctx) => {
      const [receipt] = await ctx.db.query("providerEventReceipts").collect();
      if (receipt === undefined) throw new Error("missing receipt");
      const {
        _id: _receiptId,
        _creationTime: _receiptCreatedAt,
        ...row
      } = receipt;
      expect(_receiptId).toBeDefined();
      expect(_receiptCreatedAt).toBeGreaterThan(0);
      await ctx.db.insert("providerEventReceipts", {
        ...row,
        transportDeliveryId: "legacy_duplicate_delivery",
        receivedAt: row.receivedAt + 1,
        createdAt: row.createdAt + 1,
      });
    });

    expect(
      await t.mutation(
        receiveSlackEvent,
        await inputFor(createPayload, "delivery_replay", 1_700_000_100_002),
      ),
    ).toEqual({ outcome: "duplicate_replay" });
  });

  it("advances lifecycle generations without accepting delayed resurrection", async () => {
    const t = makeTest();
    const changedPayload = payloadFor("Ev900", {
      type: "message",
      subtype: "message_changed",
      channel: "C1",
      event_ts: "1700000200.000001",
      message: {
        ts: "1700000000.123456",
        thread_ts: "1700000000.000001",
        user: "U2",
        username: "Ada",
        text: "Edited text.",
        blocks: [],
        permalink: "https://example.test/slack/p/1",
      },
    });
    const deletedPayload = payloadFor("Ev001", {
      type: "message",
      subtype: "message_deleted",
      channel: "C1",
      event_ts: "1700000300.000001",
      deleted_ts: "1700000000.123456",
      previous_message: {
        ts: "1700000000.123456",
        thread_ts: "1700000000.000001",
      },
    });
    const delayedPayload = payloadFor("Ev999", {
      ...changedPayload.event,
      event_ts: "1700000250.000001",
    });
    const recreatedPayload = payloadFor("Ev002", {
      ...changedPayload.event,
      event_ts: "1700000400.000001",
      message: {
        ...(changedPayload.event.message as Record<string, unknown>),
        text: "Recreated text.",
      },
    });

    await t.mutation(
      receiveSlackEvent,
      await inputFor(createPayload, "delivery_create", 1_700_000_100_000),
    );
    await t.mutation(
      receiveSlackEvent,
      await inputFor(changedPayload, "delivery_edit", 1_700_000_200_000),
    );
    await t.mutation(
      receiveSlackEvent,
      await inputFor(deletedPayload, "delivery_delete", 1_700_000_300_000),
    );
    await expect(
      t.mutation(
        receiveSlackEvent,
        await inputFor(
          delayedPayload,
          "delivery_delayed_edit",
          1_700_000_350_000,
        ),
      ),
    ).rejects.toThrow("DuplicateKeyConflict");
    await t.mutation(
      receiveSlackEvent,
      await inputFor(recreatedPayload, "delivery_recreate", 1_700_000_400_000),
    );

    const state = await t.run(async (ctx) => ({
      artifacts: await ctx.db.query("sourceArtifacts").collect(),
      revisions: await ctx.db.query("sourceRevisions").collect(),
      receipts: await ctx.db.query("providerEventReceipts").collect(),
    }));
    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0]?.lifecycle).toMatchObject({
      state: "active",
      generation: 4,
    });
    expect(state.revisions.map((row) => row.lifecycle.generation)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(state.receipts).toHaveLength(4);
  });
});
