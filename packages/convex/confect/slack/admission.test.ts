import { describe, expect, it } from "vitest";

import {
  SlackAdmissionError,
  admitSlackSignedEvent,
  slackIdempotencyKeyFor,
  slackReplayKeyFor,
} from "./admission";

const secret = "signing-secret";
const body = JSON.stringify({ event_id: "Ev123", type: "event_callback" });
const nowMillis = 1_700_000_000_000;
const timestamp = String(nowMillis / 1000);

const sign = async (value: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return `v0=${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

const policy = {
  organizationKey: "org_1",
  connectionKey: "conn_1",
  connectionGeneration: 2,
  teamId: "T1",
  appId: "A1",
  botUserId: "U1",
  channelKey: "chan_1",
  externalChannelId: "C1",
  connectionStatus: "active" as const,
  channelMembershipStatus: "joined_active" as const,
};

describe("Slack signed-event admission", () => {
  it("verifies Slack v0, applies the policy, and returns the source binding", async () => {
    const signature = await sign(`v0:${timestamp}:${body}`);
    const result = await admitSlackSignedEvent({
      ...policy,
      providerEventId: "Ev123",
      rawBody: body,
      timestamp,
      signature,
      signingSecret: secret,
      nowMillis,
    });

    expect(result).toMatchObject({
      providerEventId: "Ev123",
      signatureVerification: { status: "verified" },
      replayVerification: { status: "accepted" },
      organizationKey: "org_1",
      connectionGeneration: 2,
    });
    expect(result.signatureVerification.receiptHash).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });

  it.each([
    ["malformed timestamp", { timestamp: "nope" }],
    ["stale timestamp", { timestamp: String(Number(timestamp) - 301) }],
    ["bad signature", { signature: "v0=00" }],
    ["inactive connection", { connectionStatus: "revoked" as const }],
    ["unadmitted channel", { channelMembershipStatus: "access_lost" as const }],
  ])(
    "rejects %s",
    async (
      _,
      override: {
        readonly timestamp?: string;
        readonly signature?: string;
        readonly connectionStatus?: "revoked";
        readonly channelMembershipStatus?: "access_lost";
      },
    ) => {
      const actualTimestamp = override.timestamp ?? timestamp;
      const signature = await sign(`v0:${actualTimestamp}:${body}`);
      await expect(
        admitSlackSignedEvent({
          ...policy,
          ...override,
          providerEventId: "Ev123",
          rawBody: body,
          timestamp: actualTimestamp,
          signature: override.signature ?? signature,
          signingSecret: secret,
          nowMillis,
        }),
      ).rejects.toBeInstanceOf(SlackAdmissionError);
    },
  );

  it("makes replay and idempotency keys deterministic and tenant/generation scoped", () => {
    const input = { ...policy, providerEventId: "Ev123" };
    expect(slackReplayKeyFor(input)).toBe(slackReplayKeyFor({ ...input }));
    expect(slackReplayKeyFor(input)).not.toBe(
      slackReplayKeyFor({ ...input, connectionGeneration: 3 }),
    );
    expect(slackIdempotencyKeyFor({ ...input, rawBody: body })).toMatch(
      /^slack:v0:org_1:conn_1:2:Ev123:[a-f0-9]{64}$/,
    );
  });

  it("rejects a previously admitted replay", async () => {
    const signature = await sign(`v0:${timestamp}:${body}`);
    const replayKey = slackReplayKeyFor({
      ...policy,
      providerEventId: "Ev123",
    });
    await expect(
      admitSlackSignedEvent({
        ...policy,
        providerEventId: "Ev123",
        rawBody: body,
        timestamp,
        signature,
        signingSecret: secret,
        nowMillis,
        seenReplayKeys: new Set([replayKey]),
      }),
    ).rejects.toMatchObject({ reason: "replay" });
  });
});
