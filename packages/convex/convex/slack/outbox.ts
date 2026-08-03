import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import {
  answerOutboxRow,
  authorizeAnswerDelivery,
  claimAnswerOutboxRow,
  completeAnswerDelivery,
  recordAnswerDeliveryFailure,
  recoverExpiredAnswerDelivery,
  type AnswerDeliveryInput,
  type AnswerDeliveryAuthorization,
  type AnswerLifecycleFence,
  type AnswerOutboxError,
  type SlackAnswerOutboxRow,
} from "../../confect/slack/answerOutbox";
import {
  defaultOperationPolicy,
  operationPolicyFromRecord,
  operationPolicyKey,
} from "../../confect/ops/brainOperationPolicy";
import { captureBrainMetric } from "../../confect/observability/posthog";
import {
  runAnswerDelivery,
  type AnswerOutboxStore,
  type ProviderPort,
} from "../../confect/slack/outboxPersistence";
import {
  createFakeNangoClient,
  createLiveNangoClient,
  providerModeFromEnv,
  validateNangoEnv,
  type NangoClient,
} from "@maestro-template/integrations/nango/client";
const f = {
  organizationKey: v.string(),
  workspaceId: v.string(),
  brainKey: v.string(),
  bindingKey: v.string(),
  bindingGeneration: v.number(),
  connectionKey: v.string(),
  connectionGeneration: v.number(),
  teamId: v.string(),
  channelKey: v.string(),
  deliveryGeneration: v.number(),
  operationGeneration: v.number(),
};
const internalOutbox = {
  get: makeFunctionReference<"query", { answerKey: string }, unknown>(
    "slack/outbox:getAnswerOutbox",
  ),
  providerConnection: makeFunctionReference<
    "query",
    { connectionKey: string },
    unknown
  >("slack/outbox:getSlackProviderConnection"),
  finalAuthorize: makeFunctionReference<
    "query",
    { answerKey: string; now: number },
    boolean
  >("slack/outbox:finalAuthorizeAnswerOutbox"),
  listExpired: makeFunctionReference<
    "query",
    { now: number; limit: number },
    unknown
  >("slack/outbox:listExpiredAnswerOutbox"),
  claim: makeFunctionReference<"mutation", any, { ok: boolean }>(
    "slack/outbox:claimAnswerOutbox",
  ),
  complete: makeFunctionReference<"mutation", any, { ok: boolean }>(
    "slack/outbox:completeAnswerOutbox",
  ),
  fail: makeFunctionReference<"mutation", any, { ok: boolean }>(
    "slack/outbox:failAnswerOutbox",
  ),
  recover: makeFunctionReference<"mutation", any, { ok: boolean }>(
    "slack/outbox:recoverAnswerOutbox",
  ),
  deliver: makeFunctionReference<"action", { answerKey: string }, unknown>(
    "slack/outbox:deliverAnswerOutbox",
  ),
} as const;
const find = async (db: any, k: string) =>
  await db
    .query("outboundDeliveryOutbox")
    .withIndex("by_answer_key", (q: any) => q.eq("answerKey", k))
    .unique();

export const getAnswerOutbox = internalQueryGeneric({
  args: { answerKey: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, a) => await find(ctx.db, a.answerKey),
});

export const getSlackProviderConnection = internalQueryGeneric({
  args: { connectionKey: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, a) =>
    await ctx.db
      .query("providerConnections")
      .withIndex("by_connection_key", (q: any) =>
        q.eq("connectionKey", a.connectionKey),
      )
      .unique(),
});

export const listExpiredAnswerOutbox = internalQueryGeneric({
  args: { now: v.number(), limit: v.number() },
  returns: v.array(v.any()),
  handler: async (ctx, a) =>
    (await ctx.db
      .query("outboundDeliveryOutbox")
      .withIndex("by_lease_expiry", (q: any) =>
        q.eq("status", "in_flight").lte("leaseExpiresAt", a.now),
      )
      .take(a.limit)) as SlackAnswerOutboxRow[],
});

export const finalAuthorizeAnswerOutbox = internalQueryGeneric({
  args: { answerKey: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, a) => {
    const row = (await find(
      ctx.db,
      a.answerKey,
    )) as SlackAnswerOutboxRow | null;
    if (row === null) return false;
    const binding = await ctx.db
      .query("slackIdentityBindings")
      .withIndex("by_binding_key", (q: any) =>
        q.eq("bindingKey", row.lifecycle.bindingKey),
      )
      .unique();
    const policies = await ctx.db
      .query("channelDeliveryPolicies")
      .withIndex("by_channel_active", (q: any) =>
        q.eq("channelKey", row.delivery.channelKey).eq("active", true),
      )
      .collect();
    const records = await ctx.db
      .query("policies")
      .withIndex("by_policy_version", (q: any) =>
        q.eq(
          "policyKey",
          operationPolicyKey(row.delivery.workspaceId, "slackDelivery"),
        ),
      )
      .collect();
    if (
      binding === null ||
      binding.workspaceId === undefined ||
      binding.brainKey === undefined
    )
      return false;
    const policy = policies.find(
      (candidate: any) =>
        candidate.organizationKey === row.delivery.organizationKey,
    );
    if (policy === undefined) return false;
    let operation = defaultOperationPolicy("slackDelivery");
    try {
      const current = records
        .filter((record: any) => record.status === "active")
        .map(operationPolicyFromRecord)
        .filter(
          (candidate) =>
            candidate.expiresAt === undefined || candidate.expiresAt > a.now,
        )
        .sort((left, right) => right.generation - left.generation)[0];
      if (current !== undefined) operation = current;
    } catch {
      return false;
    }
    const input: AnswerDeliveryInput = {
      organizationKey: row.delivery.organizationKey,
      workspaceId: row.delivery.workspaceId,
      brainKey: row.delivery.brainKey,
      requestId: row.answerKey,
      answerReference: row.answerReference,
      answerPayload: row.answer,
      requesterUserId: row.requester.userId,
      requesterSlackUserId: row.requester.slackUserId,
      bindingKey: row.lifecycle.bindingKey,
      bindingGeneration: row.lifecycle.bindingGeneration,
      connectionKey: row.delivery.connectionKey,
      connectionGeneration: row.lifecycle.connectionGeneration,
      teamId: row.delivery.teamId,
      channelKey: row.delivery.channelKey,
      externalChannelId: row.delivery.externalChannelId,
      deliveryGeneration: row.lifecycle.deliveryGeneration,
      operationGeneration: row.lifecycle.operationGeneration,
      now: a.now,
    };
    return Either.isRight(
      authorizeAnswerDelivery({ input, binding, policy, operation }),
    );
  },
});
const mutate = async (
  ctx: any,
  k: string,
  fn: (r: SlackAnswerOutboxRow) => Either.Either<SlackAnswerOutboxRow, unknown>,
) => {
  const r = await find(ctx.db, k);
  if (!r) return { ok: false };
  const n = fn(r as SlackAnswerOutboxRow);
  if (Either.isLeft(n)) return { ok: false };
  await ctx.db.patch(r._id, n.right);
  return { ok: true };
};
export const enqueueAnswerOutboxHandler = async (
  ctx: any,
  a: any,
  schedule: (answerKey: string) => Promise<void>,
) => {
  const r = answerOutboxRow({
    input: a.input as AnswerDeliveryInput,
    authorized: a.authorized as AnswerDeliveryAuthorization,
  });
  if (await find(ctx.db, r.answerKey))
    return { inserted: false, answerKey: r.answerKey };
  await ctx.db.insert("outboundDeliveryOutbox", {
    ...r,
    schemaVersion: 1,
    organizationKey: r.delivery.organizationKey,
  });
  await schedule(r.answerKey);
  return { inserted: true, answerKey: r.answerKey };
};

export const enqueueAnswerOutbox = internalMutationGeneric({
  args: { input: v.any(), authorized: v.any() },
  returns: v.object({ inserted: v.boolean(), answerKey: v.string() }),
  handler: async (ctx, a) =>
    await enqueueAnswerOutboxHandler(ctx, a, async (answerKey) => {
      await ctx.scheduler.runAfter(0, internalOutbox.deliver, { answerKey });
    }),
});
export const claimAnswerOutbox = internalMutationGeneric({
  args: {
    answerKey: v.string(),
    leaseToken: v.string(),
    leaseExpiresAt: v.number(),
    now: v.number(),
    expectedLifecycle: v.object(f),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, a) =>
    mutate(ctx, a.answerKey, (r) => claimAnswerOutboxRow(r, a)),
});
export const completeAnswerOutbox = internalMutationGeneric({
  args: {
    answerKey: v.string(),
    leaseToken: v.string(),
    now: v.number(),
    expectedLifecycle: v.object(f),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, a) =>
    mutate(ctx, a.answerKey, (r) => completeAnswerDelivery(r, a)),
});
export const recoverAnswerOutbox = internalMutationGeneric({
  args: {
    answerKey: v.string(),
    now: v.number(),
    expectedLifecycle: v.object(f),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, a) =>
    mutate(ctx, a.answerKey, (r) => recoverExpiredAnswerDelivery(r, a)),
});
export const failAnswerOutbox = internalMutationGeneric({
  args: {
    answerKey: v.string(),
    leaseToken: v.string(),
    now: v.number(),
    kind: v.union(v.literal("retryable"), v.literal("terminal")),
    code: v.string(),
    expectedLifecycle: v.object(f),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, a) =>
    mutate(ctx, a.answerKey, (r) => recordAnswerDeliveryFailure(r, a)),
});

export type AnswerOutboxWorkerRuntime = Readonly<{
  readonly store: AnswerOutboxStore;
  readonly reauthorize: () => boolean | Promise<boolean>;
  readonly provider: ProviderPort;
  readonly now: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: number;
}>;

export const runAnswerOutboxWorker = async (
  runtime: AnswerOutboxWorkerRuntime,
  input: Readonly<{
    readonly answerKey: string;
    readonly expectedLifecycle: AnswerLifecycleFence;
  }>,
) =>
  await runAnswerDelivery(runtime.store, {
    ...input,
    leaseToken: runtime.leaseToken,
    leaseExpiresAt: runtime.leaseExpiresAt,
    now: runtime.now,
    reauthorize: runtime.reauthorize,
    provider: runtime.provider,
  });

const invalid = (): Either.Either<SlackAnswerOutboxRow, AnswerOutboxError> =>
  Either.left({ _tag: "AnswerOutboxError", reason: "invalid_state" });

const actionStore = (ctx: any): AnswerOutboxStore => ({
  insertIfAbsent: async () => {
    throw new Error("delivery workers cannot enqueue answer outbox rows");
  },
  claim: async (answerKey, transition) => {
    const current = (await ctx.runQuery(internalOutbox.get, {
      answerKey,
    })) as SlackAnswerOutboxRow | null;
    if (current === null) return null;
    const next = transition(current);
    if (Either.isLeft(next)) return next;
    const claimed = await ctx.runMutation(internalOutbox.claim, {
      answerKey,
      leaseToken: next.right.leaseToken ?? "",
      leaseExpiresAt: next.right.leaseExpiresAt ?? 0,
      now: next.right.updatedAt,
      expectedLifecycle: next.right.lifecycle,
    });
    if (!claimed.ok) return invalid();
    const saved = (await ctx.runQuery(internalOutbox.get, {
      answerKey,
    })) as SlackAnswerOutboxRow | null;
    return saved === null ? invalid() : Either.right(saved);
  },
  update: async (answerKey, transition) => {
    const current = (await ctx.runQuery(internalOutbox.get, {
      answerKey,
    })) as SlackAnswerOutboxRow | null;
    if (current === null) return null;
    const next = transition(current);
    if (Either.isLeft(next)) return next;
    const updated =
      next.right.status === "sent"
        ? await ctx.runMutation(internalOutbox.complete, {
            answerKey,
            leaseToken: current.leaseToken ?? "",
            now: next.right.updatedAt,
            expectedLifecycle: next.right.lifecycle,
          })
        : next.right.lastError === undefined
          ? { ok: false }
          : await ctx.runMutation(internalOutbox.fail, {
              answerKey,
              leaseToken: current.leaseToken ?? "",
              now: next.right.updatedAt,
              kind: next.right.lastError.kind,
              code: next.right.lastError.code,
              expectedLifecycle: next.right.lifecycle,
            });
    if (!updated.ok) return invalid();
    const saved = (await ctx.runQuery(internalOutbox.get, {
      answerKey,
    })) as SlackAnswerOutboxRow | null;
    return saved === null ? invalid() : Either.right(saved);
  },
  listExpiredInFlight: async () => [],
});

let nangoClient: NangoClient | undefined;
const getNangoClient = (): NangoClient | null => {
  if (nangoClient !== undefined) return nangoClient;
  const env = process.env as Record<string, string | undefined>;
  const mode = providerModeFromEnv(env);
  if (mode === "live") {
    const secretKey = env.NANGO_SECRET_KEY?.trim();
    const providerConfigKey = env.NANGO_CONNECT_INTEGRATION_ID?.trim();
    const valid = validateNangoEnv("live", env);
    if (valid !== true || !secretKey || !providerConfigKey) return null;
    nangoClient = createLiveNangoClient({ secretKey, providerConfigKey });
  } else {
    nangoClient = createFakeNangoClient({ now: Date.now() });
  }
  return nangoClient;
};

const providerPort = (ctx: any): ProviderPort => ({
  send: async (input) => {
    const connection = await ctx.runQuery(internalOutbox.providerConnection, {
      connectionKey: input.connectionKey,
    });
    if (
      connection === null ||
      connection.status !== "active" ||
      typeof connection.nangoConnectionId !== "string" ||
      connection.connectionGeneration !== input.connectionGeneration ||
      connection.teamId !== input.teamId
    )
      return { outcome: "terminal", code: "slack_connection_unavailable" };
    const client = getNangoClient();
    if (client === null)
      return { outcome: "terminal", code: "nango_not_configured" };
    try {
      const response = await client.proxy({
        connectionId: connection.nangoConnectionId,
        endpoint: "/chat.postEphemeral",
        method: "POST",
        data: {
          channel: input.channelId,
          user: input.requesterSlackUserId,
          text: input.answer.text,
          ...(input.threadTs === undefined
            ? {}
            : { thread_ts: input.threadTs }),
        },
      });
      const body = response.data as { readonly ok?: unknown } | undefined;
      if (response.status >= 200 && response.status < 300 && body?.ok !== false)
        return { outcome: "delivered" };
      if (response.status === 408 || response.status === 429)
        return { outcome: "retryable", code: `slack_http_${response.status}` };
      return { outcome: "terminal", code: `slack_http_${response.status}` };
    } catch {
      return { outcome: "ambiguous" };
    }
  },
});

const leaseDurationMs = 30_000;

export const deliverAnswerOutbox = internalActionGeneric({
  args: { answerKey: v.string() },
  returns: v.object({ outcome: v.string() }),
  handler: async (ctx, a) => {
    const row = (await ctx.runQuery(internalOutbox.get, {
      answerKey: a.answerKey,
    })) as SlackAnswerOutboxRow | null;
    if (row === null) return { outcome: "invalid" };
    const now = Date.now();
    const result = await runAnswerOutboxWorker(
      {
        store: actionStore(ctx),
        reauthorize: async () =>
          await ctx.runQuery(internalOutbox.finalAuthorize, {
            answerKey: row.answerKey,
            now: Date.now(),
          }),
        provider: providerPort(ctx),
        now,
        leaseToken: `slack-answer:${crypto.randomUUID()}`,
        leaseExpiresAt: now + leaseDurationMs,
      },
      { answerKey: row.answerKey, expectedLifecycle: row.lifecycle },
    );
    if (result.outcome === "ambiguous_no_retry") {
      await Effect.runPromise(
        captureBrainMetric(ctx, {
          metric: "outbox_ambiguity",
          value: 1,
          unit: "count",
          workspaceId: row.delivery.workspaceId,
          subsystem: "slackDelivery",
          state: result.outcome,
          generation: row.lifecycle.operationGeneration,
        }),
      ).catch(() => undefined);
    }
    return result;
  },
});

export const recoverExpiredAnswerOutboxesHandler = async (
  ctx: any,
  a: { readonly limit: number },
  schedule: (answerKey: string) => Promise<void>,
) => {
  const now = Date.now();
  const rows = (await ctx.runQuery(internalOutbox.listExpired, {
    now,
    limit: a.limit,
  })) as readonly SlackAnswerOutboxRow[];
  let recovered = 0;
  for (const row of rows) {
    const result = await ctx.runMutation(internalOutbox.recover, {
      answerKey: row.answerKey,
      now,
      expectedLifecycle: row.lifecycle,
    });
    if (result.ok) {
      recovered += 1;
      await schedule(row.answerKey);
    }
  }
  return { recovered };
};

export const recoverExpiredAnswerOutboxes = internalActionGeneric({
  args: { limit: v.number() },
  returns: v.object({ recovered: v.number() }),
  handler: async (ctx, a) =>
    await recoverExpiredAnswerOutboxesHandler(ctx, a, async (answerKey) => {
      await ctx.scheduler.runAfter(0, internalOutbox.deliver, { answerKey });
    }),
});
