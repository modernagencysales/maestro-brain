import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import convexSchema from "../confect/_generated/convexSchema";

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");
const receiveNangoSlackWebhook = makeFunctionReference<
  "mutation",
  {
    connectionId: string;
    providerConfigKey: string;
    payload: unknown;
    deliveryDigest: string;
    signature: string;
    receivedAt: number;
  },
  { outcome: string; questionOutcome?: string }
>("slack/nangoWebhook:receiveNangoSlackWebhook");

describe("Nango Slack runtime ingress", () => {
  it("attributes a forwarded event and deduplicates an exact retry", async () => {
    const test = convexTest(convexSchema, modules);
    await test.run(async (ctx) => {
      await ctx.db.insert("providerConnections", {
        provider: "nango",
        providerConfigKey: "slack",
        organizationKey: "org_1",
        connectionKey: "slack_org_1",
        connectionGeneration: 1,
        status: "active",
        connectSessionId: "session_1",
        nangoConnectionId: "nango_connection_1",
        nangoEndUserId: "end_user_1",
        nangoOrganizationId: "organization_1",
        correlationTag: "slack-connect:session_1",
        attemptId: "attempt_1",
        attemptExpiresAt: 2_000_000_000_000,
        completedAt: 1,
        teamId: "T1",
        apiAppId: "A1",
        botUserId: "UBOT",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("sourceChannels", {
        organizationKey: "org_1",
        connectionKey: "slack_org_1",
        connectionGeneration: 1,
        channelKey: "slack_org_1:C1",
        externalChannelId: "C1",
        name: "company-context",
        normalizedName: "company-context",
        isMember: true,
        isShared: false,
        isExtShared: false,
        isArchived: false,
        membershipStatus: "joined_active",
        accessGeneration: 1,
        firstDiscoveredAt: 1,
        lastSeenAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("slackIdentityBindings", {
        bindingKey: "binding_1",
        organizationKey: "org_1",
        connectionKey: "slack_org_1",
        connectionGeneration: 1,
        teamId: "T1",
        workspaceId: "workspace_1",
        brainKey: "brain_1",
        slackUserId: "U1",
        userId: "user_1",
        workosSubject: "workos_1",
        status: "active",
        bindingGeneration: 1,
        nonceHash: "sha256:binding",
        intentExpiresAt: 2_000_000_000_000,
        createdAt: 1,
        updatedAt: 1,
        verifiedAt: 1,
        revokedAt: null,
        revokeReason: null,
      });
    });
    const payload = {
      team_id: "T1",
      api_app_id: "A1",
      event_id: "Ev1",
      event: {
        type: "message",
        channel: "C1",
        user: "U1",
        username: "Ada",
        text: "Updated pricing context",
        ts: "1700000000.000001",
        blocks: [],
        permalink: "https://example.test/slack/1",
      },
    };
    const input = {
      connectionId: "nango_connection_1",
      providerConfigKey: "slack",
      payload,
      deliveryDigest: "b".repeat(64),
      signature: "a".repeat(64),
      receivedAt: 1_700_000_000_000,
    };

    await expect(
      test.mutation(receiveNangoSlackWebhook, input),
    ).resolves.toMatchObject({
      outcome: "inserted",
    });
    await expect(
      test.mutation(receiveNangoSlackWebhook, input),
    ).resolves.toEqual({
      outcome: "duplicate_delivery",
    });
    const receipts = await test.run(
      async (ctx) => await ctx.db.query("providerEventReceipts").collect(),
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      providerEventId: "Ev1",
      connectionKey: "slack_org_1",
      signatureVerification: { status: "verified" },
    });

    const mentionPayload = {
      ...payload,
      event_id: "Ev2",
      event: {
        ...payload.event,
        type: "app_mention",
        channel_type: "group",
        text: "<@UBOT> What is our ICP?",
        ts: "1700000001.000001",
      },
    };
    await expect(
      test.mutation(receiveNangoSlackWebhook, {
        ...input,
        payload: mentionPayload,
        deliveryDigest: "c".repeat(64),
      }),
    ).resolves.toMatchObject({
      outcome: "inserted",
      questionOutcome: "scheduled",
    });
    await expect(
      test.mutation(receiveNangoSlackWebhook, {
        ...input,
        payload: mentionPayload,
        deliveryDigest: "c".repeat(64),
      }),
    ).resolves.toEqual({ outcome: "duplicate_delivery" });
  });
});
