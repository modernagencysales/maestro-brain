import { describe, expect, it } from "vitest";

import {
  nangoWebhookSignatureFor,
  parseNangoSlackWebhook,
  verifyNangoWebhookSignature,
} from "./webhook";

describe("Nango webhook boundary", () => {
  it("verifies the current HMAC-SHA256 header over the untouched body", async () => {
    const rawBody = JSON.stringify({ type: "forward", connectionId: "c_1" });
    const signingKey = "test-signing-key";
    const signature = await nangoWebhookSignatureFor(rawBody, signingKey);

    await expect(
      verifyNangoWebhookSignature({ rawBody, signingKey, signature }),
    ).resolves.toBe(true);
    await expect(
      verifyNangoWebhookSignature({
        rawBody: `${rawBody} `,
        signingKey,
        signature,
      }),
    ).resolves.toBe(false);
  });

  it("normalizes an attributed Slack forward without exposing credentials", () => {
    expect(
      parseNangoSlackWebhook({
        from: "slack",
        providerConfigKey: "slack",
        type: "forward",
        connectionId: "connection-123",
        payload: {
          token: "legacy-slack-verification-token",
          team_id: "T012AB3CD",
          event_id: "Ev1",
          event: { type: "message", channel: "C1", text: "Hello" },
        },
      }),
    ).toEqual({
      kind: "slack_forward",
      forward: {
        connectionId: "connection-123",
        providerConfigKey: "slack",
        payload: {
          team_id: "T012AB3CD",
          event_id: "Ev1",
          event: { type: "message", channel: "C1", text: "Hello" },
        },
      },
    });
  });

  it("fails closed for raw Slack payloads Nango could not attribute", () => {
    expect(
      parseNangoSlackWebhook({
        team_id: "T012AB3CD",
        event: { type: "message" },
      }),
    ).toEqual({ kind: "unattributed_slack" });
    expect(parseNangoSlackWebhook({ type: "sync", success: true })).toEqual({
      kind: "ignored",
    });
  });
});
