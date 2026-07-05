import { describe, expect, it } from "vitest";
import {
  DodoWebhookConfigError,
  DodoWebhookReplayError,
  normalizeDodoWebhook,
  verifyDodoWebhook,
} from "./dodo";

describe("Dodo payment seam", () => {
  it("accepts fake-mode webhooks without live secrets", async () => {
    await expect(
      verifyDodoWebhook({
        mode: "fake",
        payload: '{"event":"payment.succeeded"}',
        signature: undefined,
        webhookSecret: undefined,
        nowMs: 1_000,
        seenEventIds: [],
      }),
    ).resolves.toEqual({
      ok: true,
      mode: "fake",
      eventId: "fake-dodo-event",
    });
  });

  it("requires a secret and signature in live-ready mode", async () => {
    await expect(
      verifyDodoWebhook({
        mode: "live",
        payload: '{"id":"evt_123"}',
        signature: undefined,
        webhookSecret: "secret",
        nowMs: 1_000,
        seenEventIds: [],
      }),
    ).resolves.toBeInstanceOf(DodoWebhookConfigError);
  });

  it("denies duplicate webhook event ids", async () => {
    await expect(
      verifyDodoWebhook({
        mode: "test",
        payload: '{"id":"evt_123"}',
        signature: "test_signature",
        webhookSecret: "secret",
        nowMs: 1_000,
        seenEventIds: ["evt_123"],
      }),
    ).resolves.toBeInstanceOf(DodoWebhookReplayError);
  });

  it("normalizes Dodo webhook identity by provider, event id, and signature timestamp", () => {
    const normalized = normalizeDodoWebhook({
      payload: JSON.stringify({
        id: "evt_123",
        type: "payment.succeeded",
        data: {
          customer: {
            email: "buyer@example.com",
          },
        },
      }),
      signatureTimestamp: "1700000000",
    });

    expect(normalized).toEqual({
      provider: "dodo",
      eventId: "evt_123",
      eventType: "payment.succeeded",
      signatureTimestamp: "1700000000",
      dedupeKey: "dodo.evt_123.1700000000",
      redactedPayload: {
        id: "evt_123",
        type: "payment.succeeded",
        data: "[redacted]",
      },
    });
    expect(JSON.stringify(normalized)).not.toContain("buyer@example.com");
  });

  it("detects duplicate Dodo webhooks by provider, event id, and signature timestamp", async () => {
    await expect(
      verifyDodoWebhook({
        mode: "test",
        payload: '{"id":"evt_123","type":"payment.succeeded"}',
        signature: "test_signature",
        signatureTimestamp: "1700000000",
        webhookSecret: "secret",
        nowMs: 1_000,
        seenWebhookKeys: ["dodo.evt_123.1700000000"],
        seenEventIds: [],
      }),
    ).resolves.toBeInstanceOf(DodoWebhookReplayError);
  });
});
