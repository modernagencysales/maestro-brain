import { describe, expect, it } from "vitest";

import { ingestSlackEvent } from "./ingress";

const nowSeconds = Math.floor(Date.now() / 1000);
const body = JSON.stringify({
  event_id: "Ev123",
  team_id: "T1",
  api_app_id: "A1",
  event: {
    type: "message",
    channel: "C1",
    ts: "1700000000.123456",
    thread_ts: "1700000000.123456",
    user: "U2",
    username: "Ada",
    text: "hello",
    blocks: [],
    permalink: "https://example.test/1",
  },
});
const secret = "signing-secret";
const policy = {
  organizationKey: "org_1",
  connectionKey: "conn_1",
  connectionGeneration: 2,
  teamId: "T1",
  appId: "A1",
  botUserId: "Ubot",
  channelKey: "chan_1",
  externalChannelId: "C1",
  connectionStatus: "active" as const,
  channelMembershipStatus: "joined_active" as const,
};
const routing = {
  policyEpoch: 1,
  assemblyStage: "assembly_pending" as const,
  effectKey: "effect_1",
};

const signatureFor = async (timestamp: string) => {
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
      new TextEncoder().encode(`v0:${timestamp}:${body}`),
    ),
  );
  return `v0=${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

const db = () => {
  const rows: Record<string, unknown[]> = {};
  return {
    rows,
    findReceipt: async (key: string) =>
      rows.providerEventReceipts?.find(
        (row) =>
          (row as { transportDeliveryId: string }).transportDeliveryId === key,
      ) ?? null,
    findReplay: async (providerEventId: string) =>
      rows.providerEventReceipts?.find(
        (row) =>
          (row as { providerEventId: string }).providerEventId ===
          providerEventId,
      ) ?? null,
    findArtifact: async (_channel: string, providerObjectId: string) =>
      rows.sourceArtifacts?.find(
        (row) =>
          (row as { providerObjectId: string }).providerObjectId ===
          providerObjectId,
      ) ?? null,
    insert: async (table: string, row: unknown) => {
      (rows[table] ??= []).push(row);
      return `${table}:${rows[table].length}`;
    },
    patchArtifact: async (existing: { _id?: string }, row: unknown) => {
      Object.assign(existing, row);
    },
  };
};

describe("durable Slack ingress", () => {
  it("rejects an invalid signature before writing", async () => {
    const state = db();
    await expect(
      ingestSlackEvent(state, {
        ...policy,
        routing,
        signingSecret: secret,
        timestamp: String(nowSeconds),
        nowMillis: nowSeconds * 1000,
        signature: "v0=" + "0".repeat(64),
        providerEventId: "Ev123",
        transportDeliveryId: "delivery_1",
        rawBody: body,
        payload: JSON.parse(body),
        receivedAt: nowSeconds * 1000,
      }),
    ).rejects.toMatchObject({ reason: "bad_signature" });
    expect(state.rows).toEqual({});
  });

  it("persists one ledger set for a duplicate delivery", async () => {
    const state = db();
    const timestamp = String(nowSeconds);
    const input = {
      ...policy,
      routing,
      signingSecret: secret,
      timestamp,
      nowMillis: nowSeconds * 1000,
      signature: await signatureFor(timestamp),
      providerEventId: "Ev123",
      transportDeliveryId: "delivery_1",
      rawBody: body,
      payload: JSON.parse(body),
      receivedAt: nowSeconds * 1000,
    };
    expect((await ingestSlackEvent(state, input)).outcome).toBe("inserted");
    expect((await ingestSlackEvent(state, input)).outcome).toBe(
      "duplicate_delivery",
    );
    expect(state.rows.providerEventReceipts).toHaveLength(1);
    expect(state.rows.sourceArtifacts).toHaveLength(1);
    expect(state.rows.sourceRevisions).toHaveLength(1);
    expect(state.rows.sourceProcessingJobs).toHaveLength(1);
  });

  it("does not persist a replay with a new transport delivery id", async () => {
    const state = db();
    const timestamp = String(nowSeconds);
    const input = {
      ...policy,
      routing,
      signingSecret: secret,
      timestamp,
      nowMillis: nowSeconds * 1000,
      signature: await signatureFor(timestamp),
      providerEventId: "Ev123",
      transportDeliveryId: "delivery_1",
      rawBody: body,
      payload: JSON.parse(body),
      receivedAt: nowSeconds * 1000,
    };
    expect((await ingestSlackEvent(state, input)).outcome).toBe("inserted");
    const replay = { ...input, transportDeliveryId: "delivery_2" };
    expect((await ingestSlackEvent(state, replay)).outcome).toBe(
      "duplicate_replay",
    );
    expect(state.rows.providerEventReceipts).toHaveLength(1);
  });
});
