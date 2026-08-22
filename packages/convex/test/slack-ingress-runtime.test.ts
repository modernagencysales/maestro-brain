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
const runPublicationJob = makeFunctionReference<
  "mutation",
  {
    jobKey: string;
    caller: { kind: "system"; name: string; surface: "internal" };
    now: number;
  },
  {
    jobKey: string;
    status: string;
    attemptCount: number;
    nextAttemptAt: number;
    lastErrorTag?: string;
  }
>("brain/retrievalPublication:runPublicationJob");

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

const activeConnectionRow = {
  provider: "nango" as const,
  providerConfigKey: "slack",
  organizationKey: "org_1",
  connectionKey: "conn_1",
  connectionGeneration: 2,
  status: "active" as const,
  connectSessionId: "session_slack_ingress",
  nangoConnectionId: "nango_slack_ingress",
  nangoEndUserId: "end_user_slack_ingress",
  nangoOrganizationId: "organization_slack_ingress",
  correlationTag: "slack-ingress-runtime",
  attemptId: "attempt_slack_ingress",
  attemptExpiresAt: 2_000_000_000_000,
  completedAt: 1,
  createdAt: 1,
  updatedAt: 1,
};

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
      await ctx.db.insert("providerConnections", activeConnectionRow);
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
      effectClass: "direct_publication",
      requestGeneration: 12,
      targetResolutionIntentKey: expect.any(String),
    });
    const [job] = jobs;
    if (job === undefined) throw new Error("missing publication job");
    const intent = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("slackPublicationTargetIntents")
        .withIndex("by_receipt_id", (q) => q.eq("receiptId", receiptId))
        .unique();
      if (row === null) throw new Error("missing target intent");
      expect(row.targetDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(row.targets).toEqual([
        {
          workspaceId: job.workspaceId,
          brainKey: "brain_target",
          jobKey: job.jobKey,
        },
      ]);
      return row;
    });
    expect(intent.targetCount).toBe(1);
    await t.run(async (ctx) => {
      const parents = await ctx.db
        .query("providerTargetResolutionIntents")
        .collect();
      const children = await ctx.db.query("ingestionObligations").collect();
      const required = await ctx.db
        .query("brainRequiredScopeIntents")
        .collect();
      expect(parents).toHaveLength(1);
      expect(parents[0]).toMatchObject({
        authorityKind: "live_capture",
        status: "succeeded",
        providerKind: "slack",
        targetCount: 1,
        captureKey: expect.stringMatching(/^slack-receipt:/),
      });
      expect(parents[0]).not.toHaveProperty("reconciliationRunKey");
      expect(parents[0]).not.toHaveProperty("pageEnvelopeKey");
      expect(parents[0]).not.toHaveProperty("pageChunkKey");
      expect(children).toHaveLength(2);
      const parentObligation = children.find(
        (obligation) => obligation.parentIngestionObligationKey === undefined,
      );
      const child = children.find(
        (obligation) => obligation.parentIngestionObligationKey !== undefined,
      );
      expect(parentObligation).toMatchObject({
        authorityKind: "live_capture",
        ingestionObligationKey: parents[0]?.ingestionObligationKey,
        state: "drain_pending",
        publicationJobKeys: [],
      });
      expect(parentObligation).not.toHaveProperty("workspaceId");
      expect(parentObligation).not.toHaveProperty("brainKey");
      expect(parentObligation).not.toHaveProperty("allowlistGeneration");
      expect(parentObligation).not.toHaveProperty("requiredScopeIntentKey");
      expect(child).toMatchObject({
        authorityKind: "live_capture",
        parentIngestionObligationKey: parents[0]?.ingestionObligationKey,
        ingestionObligationKey: job.ingestionObligationKey,
        requiredScopeIntentKey: required[0]?.requiredScopeIntentKey,
        state: "publication_pending",
      });
      expect(child).not.toHaveProperty("reconciliationRunKey");
      expect(required).toHaveLength(1);
      expect(parents[0]?.targets[0]).toMatchObject({
        workspaceId: job.workspaceId,
        brainKey: job.brainKey,
        jobKey: job.jobKey,
        authorityDigest: job.authorityDigest,
        childIngestionObligationKey: child?.ingestionObligationKey,
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(job._id, {
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: 1_700_000_100_002,
        lastErrorTag: undefined,
        completedAt: undefined,
      });
      await ctx.db.patch(intent._id, {
        resolutionGeneration: undefined,
        linkageVersion: undefined,
        targetDigest: undefined,
        targets: undefined,
      });
      const legacyIntent = await ctx.db.get(intent._id);
      expect(legacyIntent).toMatchObject({ status: "succeeded" });
      expect(legacyIntent?.resolutionGeneration).toBeUndefined();
      expect(legacyIntent?.linkageVersion).toBeUndefined();
      expect(legacyIntent?.targetDigest).toBeUndefined();
      expect(legacyIntent?.targets).toBeUndefined();
    });
    expect(
      await t.mutation(runPublicationJob, {
        jobKey: job.jobKey,
        caller: {
          kind: "system",
          name: "slack-legacy-linkage-test",
          surface: "internal",
        },
        now: 1_700_000_100_002,
      }),
    ).toMatchObject({
      status: "revoked",
      attemptCount: 1,
    });
    await t.run(async (ctx) => {
      const migratedIntent = await ctx.db.get(intent._id);
      expect(migratedIntent?.resolutionGeneration).toBe(
        intent.resolutionGeneration,
      );
      expect(migratedIntent?.linkageVersion).toBe(intent.linkageVersion);
      expect(migratedIntent?.targetDigest).toBe(intent.targetDigest);
      expect(migratedIntent?.targets).toEqual(intent.targets);
      const currentJob = await ctx.db
        .query("retrievalPublicationJobs")
        .withIndex("by_job_key", (q) => q.eq("jobKey", job.jobKey))
        .unique();
      if (currentJob === null) throw new Error("missing publication job");
      await ctx.db.patch(intent._id, {
        resolutionGeneration: intent.resolutionGeneration,
        linkageVersion: intent.linkageVersion,
        targetDigest: intent.targetDigest,
        targets: intent.targets,
        sourceRevisionKey: "rev_substituted_after_resolution",
      });
      await ctx.db.patch(currentJob._id, {
        status: "pending",
        nextAttemptAt: 1_700_000_100_003,
        lastErrorTag: undefined,
      });
    });
    expect(
      await t.mutation(runPublicationJob, {
        jobKey: job.jobKey,
        caller: {
          kind: "system",
          name: "slack-linkage-substitution-test",
          surface: "internal",
        },
        now: 1_700_000_100_003,
      }),
    ).toMatchObject({
      status: "integrity_failure",
      attemptCount: 1,
      lastErrorTag: "PublicationIngestionObligationLinkageInvalid",
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
      providerIntents: await ctx.db
        .query("providerTargetResolutionIntents")
        .collect(),
      obligations: await ctx.db.query("ingestionObligations").collect(),
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
    expect(state.obligations).toEqual([
      expect.objectContaining({
        authorityKind: "live_capture",
        state: "capacity_blocked",
        publicationJobKeys: [],
      }),
    ]);
    expect(state.obligations[0]).not.toHaveProperty("workspaceId");
    expect(state.obligations[0]).not.toHaveProperty("requiredScopeIntentKey");
    expect(state.providerIntents).toHaveLength(1);
    expect(state.providerIntents[0]).toMatchObject({
      authorityKind: "live_capture",
      status: "retry_wait",
      targetCount: 0,
      targets: [],
    });
    expect(state.providerIntents[0]).not.toHaveProperty("reconciliationRunKey");
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
      await ctx.db.insert("providerConnections", activeConnectionRow);
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
      obligations: await ctx.db.query("ingestionObligations").collect(),
    }));
    expect(blocked.receipts).toHaveLength(1);
    expect(blocked.intents).toHaveLength(1);
    expect(blocked.intents[0]).toMatchObject({
      status: "retry_wait",
      lastErrorTag: "SlackActiveWorkspaceCapacityExceeded",
    });
    expect(blocked.revisions).toHaveLength(1);
    expect(blocked.jobs).toEqual([]);
    expect(blocked.obligations).toEqual([
      expect.objectContaining({
        authorityKind: "live_capture",
        state: "capacity_blocked",
        publicationJobKeys: [],
      }),
    ]);

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
      obligations: await ctx.db.query("ingestionObligations").collect(),
    }));
    expect(recovered.receipts).toHaveLength(1);
    expect(recovered.intents).toHaveLength(1);
    expect(recovered.intents[0]).toMatchObject({
      status: "succeeded",
      targetCount: 26,
    });
    expect(recovered.revisions).toHaveLength(1);
    expect(recovered.jobs).toHaveLength(26);
    expect(recovered.obligations).toHaveLength(27);
    expect(
      recovered.obligations.filter(
        (obligation) => obligation.parentIngestionObligationKey === undefined,
      ),
    ).toEqual([expect.objectContaining({ state: "drain_pending" })]);
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
  }, 30_000);

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
