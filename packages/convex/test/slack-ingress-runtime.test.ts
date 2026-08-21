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
    publicationResolution?: {
      status: string;
      errorTag?: string;
    };
  }
>("slack/ingress:receiveSlackEvent");
const resolveSlackPublicationTargets = makeFunctionReference<
  "mutation",
  { receiptId: string; now: number },
  { status: string; targetCount: number; errorTag?: string }
>("slack/ingress:resolveSlackPublicationTargets");
const sweepSlackPublicationTargets = makeFunctionReference<
  "mutation",
  { limit: number; now?: number },
  { scheduled: number }
>("slack/ingress:sweepSlackPublicationTargets");

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
  it("does not let inactive policy and workspace history consume live fan-out", async () => {
    const t = makeTest();
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "slack-fanout-test",
        email: "slack-fanout@example.test",
        displayName: "Slack Fanout",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const organizationId = await ctx.db.insert("organizations", {
        ownerUserId: userId,
        agencyKey: "org_1",
        slug: "slack-fanout",
        name: "Slack Fanout",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      for (let index = 0; index < 27; index += 1)
        await ctx.db.insert("workspaces", {
          organizationId,
          ownerUserId: userId,
          brainKey: `archived_brain_${index}`,
          slug: `archived-${index}`,
          name: `Archived ${index}`,
          status: "archived",
          dataClassification: "internal",
          createdAt: index + 1,
          updatedAt: index + 1,
        });
      await ctx.db.insert("workspaces", {
        organizationId,
        ownerUserId: userId,
        brainKey: "brain_target",
        slug: "target",
        name: "Target",
        status: "active",
        dataClassification: "internal",
        createdAt: 100,
        updatedAt: 100,
      });
      for (let index = 0; index < 11; index += 1)
        await ctx.db.insert("channelRoutingPolicies", {
          organizationKey: "org_1",
          connectionKey: "conn_1",
          connectionGeneration: 2,
          channelKey: "chan_1",
          policyEpoch: index + 1,
          active: false,
          mode: "direct",
          targetBrainKeys: [`retired_brain_${index}`],
          statusAfterApply: "streaming",
          createdByRole: "owner",
          createdAt: index + 1,
        });
      await ctx.db.insert("channelRoutingPolicies", {
        organizationKey: "org_1",
        connectionKey: "conn_1",
        connectionGeneration: 2,
        channelKey: "chan_1",
        policyEpoch: 12,
        active: true,
        mode: "direct",
        targetBrainKeys: ["brain_target"],
        statusAfterApply: "streaming",
        createdByRole: "owner",
        createdAt: 12,
      });
    });

    expect(
      await t.mutation(
        receiveSlackEvent,
        await inputFor(createPayload, "delivery_fanout", 1_700_000_100_000),
      ),
    ).toMatchObject({
      outcome: "inserted",
      publicationResolution: { status: "pending" },
    });
    const receiptId = await t.run(async (ctx) => {
      const receipt = await ctx.db
        .query("providerEventReceipts")
        .withIndex("by_connection_generation_provider_event", (q) =>
          q
            .eq("organizationKey", "org_1")
            .eq("connectionKey", "conn_1")
            .eq("connectionGeneration", 2)
            .eq("providerEventId", "Ev100"),
        )
        .first();
      if (receipt === null) throw new Error("missing fan-out receipt");
      return receipt._id;
    });
    expect(
      await t.mutation(resolveSlackPublicationTargets, {
        receiptId,
        now: 1_700_000_100_001,
      }),
    ).toEqual({ status: "succeeded", targetCount: 1 });
    const jobs = await t.run(
      async (ctx) => await ctx.db.query("retrievalPublicationJobs").collect(),
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      brainKey: "brain_target",
      originKind: "slack",
      requestGeneration: 12,
    });
  });

  it("preserves capture and records retryable resolution when active policies are ambiguous", async () => {
    const t = makeTest();
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "slack-policy-capacity-test",
        email: "slack-policy-capacity@example.test",
        displayName: "Slack Policy Capacity",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizations", {
        ownerUserId: userId,
        agencyKey: "org_1",
        slug: "slack-policy-capacity",
        name: "Slack Policy Capacity",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      for (let index = 0; index < 11; index += 1)
        await ctx.db.insert("channelRoutingPolicies", {
          organizationKey: "org_1",
          connectionKey: "conn_1",
          connectionGeneration: 2,
          channelKey: "chan_1",
          policyEpoch: index + 1,
          active: true,
          mode: "direct",
          targetBrainKeys: [`brain_${index}`],
          statusAfterApply: "streaming",
          createdByRole: "owner",
          createdAt: index + 1,
        });
    });

    expect(
      await t.mutation(
        receiveSlackEvent,
        await inputFor(
          createPayload,
          "delivery_policy_overflow",
          1_700_000_100_000,
        ),
      ),
    ).toMatchObject({
      outcome: "inserted",
      publicationResolution: { status: "pending" },
    });
    const receiptId = await t.run(async (ctx) => {
      const [receipt] = await ctx.db.query("providerEventReceipts").collect();
      if (receipt === undefined) throw new Error("missing captured receipt");
      return receipt._id;
    });
    expect(
      await t.mutation(resolveSlackPublicationTargets, {
        receiptId,
        now: 1_700_000_100_001,
      }),
    ).toEqual({
      status: "retry_wait",
      targetCount: 0,
      errorTag: "SlackActivePolicyCapacityExceeded",
    });
    const state = await t.run(async (ctx) => ({
      receipts: await ctx.db.query("providerEventReceipts").collect(),
      intents: await ctx.db.query("slackPublicationTargetIntents").collect(),
      revisions: await ctx.db.query("sourceRevisions").collect(),
      jobs: await ctx.db.query("retrievalPublicationJobs").collect(),
    }));
    expect(state.receipts).toHaveLength(1);
    expect(state.intents).toHaveLength(1);
    expect(state.intents[0]).toMatchObject({
      status: "retry_wait",
      lastErrorTag: "SlackActivePolicyCapacityExceeded",
    });
    expect(state.revisions).toHaveLength(1);
    expect(state.jobs).toEqual([]);
  });

  it("preserves capture and resumes complete fan-out after workspace capacity recovers", async () => {
    const t = makeTest();
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "slack-capacity-test",
        email: "slack-capacity@example.test",
        displayName: "Slack Capacity",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const organizationId = await ctx.db.insert("organizations", {
        ownerUserId: userId,
        agencyKey: "org_1",
        slug: "slack-capacity",
        name: "Slack Capacity",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const targetBrainKeys: string[] = [];
      for (let index = 0; index < 27; index += 1) {
        const brainKey = `brain_${index}`;
        targetBrainKeys.push(brainKey);
        await ctx.db.insert("workspaces", {
          organizationId,
          ownerUserId: userId,
          brainKey,
          slug: `active-${index}`,
          name: `Active ${index}`,
          status: "active",
          dataClassification: "internal",
          createdAt: index + 1,
          updatedAt: index + 1,
        });
      }
      await ctx.db.insert("channelRoutingPolicies", {
        organizationKey: "org_1",
        connectionKey: "conn_1",
        connectionGeneration: 2,
        channelKey: "chan_1",
        policyEpoch: 1,
        active: true,
        mode: "direct",
        targetBrainKeys,
        statusAfterApply: "streaming",
        createdByRole: "owner",
        createdAt: 1,
      });
    });

    expect(
      await t.mutation(
        receiveSlackEvent,
        await inputFor(
          createPayload,
          "delivery_workspace_overflow",
          1_700_000_100_000,
        ),
      ),
    ).toMatchObject({
      outcome: "inserted",
      publicationResolution: { status: "pending" },
    });
    const initialReceiptId = await t.run(async (ctx) => {
      const [receipt] = await ctx.db.query("providerEventReceipts").collect();
      if (receipt === undefined) throw new Error("missing captured receipt");
      return receipt._id;
    });
    expect(
      await t.mutation(sweepSlackPublicationTargets, {
        limit: 20,
        now: 1_700_000_100_001,
      }),
    ).toEqual({ scheduled: 1 });
    expect(
      await t.mutation(resolveSlackPublicationTargets, {
        receiptId: initialReceiptId,
        now: 1_700_000_100_001,
      }),
    ).toEqual({
      status: "retry_wait",
      targetCount: 0,
      errorTag: "SlackActiveWorkspaceCapacityExceeded",
    });
    const blocked = await t.run(async (ctx) => ({
      receipts: await ctx.db.query("providerEventReceipts").collect(),
      intents: await ctx.db.query("slackPublicationTargetIntents").collect(),
      revisions: await ctx.db.query("sourceRevisions").collect(),
      jobs: await ctx.db.query("retrievalPublicationJobs").collect(),
    }));
    expect(blocked.receipts).toHaveLength(1);
    expect(blocked.intents).toHaveLength(1);
    expect(blocked.intents[0]).toMatchObject({
      status: "retry_wait",
      lastErrorTag: "SlackActiveWorkspaceCapacityExceeded",
    });
    expect(blocked.revisions).toHaveLength(1);
    expect(blocked.jobs).toEqual([]);

    expect(
      await t.mutation(
        receiveSlackEvent,
        await inputFor(
          createPayload,
          "delivery_workspace_overflow_replay",
          1_700_000_100_001,
        ),
      ),
    ).toEqual({ outcome: "duplicate_replay" });

    await t.run(async (ctx) => {
      const workspaces = await ctx.db.query("workspaces").collect();
      const last = workspaces.at(-1);
      if (last === undefined) throw new Error("missing overflow workspace");
      await ctx.db.patch(last._id, { status: "archived", updatedAt: 2_000 });
    });
    expect(
      await t.mutation(resolveSlackPublicationTargets, {
        receiptId: initialReceiptId,
        now: 1_700_000_100_002,
      }),
    ).toEqual({ status: "succeeded", targetCount: 26 });
    const recovered = await t.run(async (ctx) => ({
      receipts: await ctx.db.query("providerEventReceipts").collect(),
      intents: await ctx.db.query("slackPublicationTargetIntents").collect(),
      revisions: await ctx.db.query("sourceRevisions").collect(),
      jobs: await ctx.db.query("retrievalPublicationJobs").collect(),
    }));
    expect(recovered.receipts).toHaveLength(1);
    expect(recovered.intents).toHaveLength(1);
    expect(recovered.intents[0]).toMatchObject({
      status: "succeeded",
      targetCount: 26,
    });
    expect(recovered.revisions).toHaveLength(1);
    expect(recovered.jobs).toHaveLength(26);
  });

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
      lifecycleFences: await ctx.db
        .query("retrievalEligibilityFences")
        .withIndex("by_organization_kind_controller", (query) =>
          query.eq("organizationKey", "org_1").eq("kind", "lifecycle"),
        )
        .take(10),
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
    expect(state.lifecycleFences).toEqual([
      expect.objectContaining({
        controllerKey: expect.stringMatching(/^slack-source:org_1:src_/),
        eligibilityGeneration: 3,
        eligible: true,
      }),
    ]);
  });
});
