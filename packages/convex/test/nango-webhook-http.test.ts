import { nangoWebhookSignatureFor } from "@maestro-template/integrations/nango/webhook";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type HeadlessHttpCtx,
  handleTemplateHttpRequest,
  templateHttpRoutes,
} from "../confect/http";

const requestFor = async (
  body: unknown,
  signingKey = "webhook-signing-key",
) => {
  const rawBody = JSON.stringify(body);
  return new Request("https://template.local/webhooks/nango", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nango-hmac-sha256": await nangoWebhookSignatureFor(
        rawBody,
        signingKey,
      ),
    },
    body: rawBody,
  });
};

describe("Nango webhook HTTP route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("declares the provider webhook outside the headless API namespace", () => {
    expect(templateHttpRoutes).toContainEqual({
      path: "/webhooks/nango",
      method: "POST",
      description: "Receives verified provider webhooks forwarded by Nango.",
    });
  });

  it("verifies, attributes, and dispatches a Slack forward", async () => {
    vi.stubEnv("NANGO_WEBHOOK_SIGNING_KEY", "webhook-signing-key");
    const mutations: Record<string, unknown>[] = [];
    const ctx: HeadlessHttpCtx = {
      runQuery: async () => null,
      runMutation: async (_ref, input) => {
        mutations.push(input);
        return { outcome: "inserted" };
      },
      runAction: async () => null,
    };
    const payload = {
      team_id: "T1",
      event_id: "Ev1",
      event: { type: "message", channel: "C1", text: "hello" },
    };
    const response = await handleTemplateHttpRequest(
      ctx,
      await requestFor({
        from: "slack",
        providerConfigKey: "slack",
        type: "forward",
        connectionId: "connection-123",
        payload,
      }),
    );

    expect(response.status).toBe(202);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      connectionId: "connection-123",
      providerConfigKey: "slack",
      payload,
      deliveryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      signature: expect.stringMatching(/^[a-f0-9]{64}$/),
      receivedAt: expect.any(Number),
    });
  });

  it("rejects invalid signatures and unmatched raw Slack events", async () => {
    vi.stubEnv("NANGO_WEBHOOK_SIGNING_KEY", "webhook-signing-key");
    const ctx: HeadlessHttpCtx = {
      runQuery: async () => null,
      runMutation: async () => {
        throw new Error("must not dispatch");
      },
      runAction: async () => null,
    };
    const invalid = await handleTemplateHttpRequest(
      ctx,
      new Request("https://template.local/webhooks/nango", {
        method: "POST",
        headers: { "x-nango-hmac-sha256": "0".repeat(64) },
        body: "{}",
      }),
    );
    const unmatched = await handleTemplateHttpRequest(
      ctx,
      await requestFor({ team_id: "T1", event: { type: "message" } }),
    );

    expect(invalid.status).toBe(401);
    expect(unmatched.status).toBe(422);
  });
});
