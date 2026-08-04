import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import type { DatabaseReader, DatabaseWriter } from "../_generated/server";
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
  type SlackAnswerOutboxRow,
} from "../../confect/slack/answerOutbox";
import {
  defaultOperationPolicy,
  operationPolicyFromRecord,
  operationPolicyKey,
} from "../../confect/ops/brainOperationPolicy";
import {
  runAnswerDelivery,
  type AnswerOutboxStore,
  type ProviderPort,
} from "../../confect/slack/outboxPersistence";
import type { ActionCtx } from "../_generated/server";
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
type OutboxMutationArgs = Readonly<{
  answerKey: string;
  now: number;
  expectedLifecycle: AnswerLifecycleFence;
  leaseToken?: string;
  leaseExpiresAt?: number;
  kind?: "retryable" | "terminal";
  code?: string;
}>;
type OutboxReader = Pick<DatabaseReader, "query">;
type OutboxEnqueuer = Pick<DatabaseWriter, "query" | "insert">;
type OutboxMutator = Pick<DatabaseWriter, "query" | "patch">;
type OutboxActionContext = Pick<
  ActionCtx,
  "runQuery" | "runMutation" | "scheduler"
>;
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
  claim: makeFunctionReference<"mutation", OutboxMutationArgs, { ok: boolean }>(
    "slack/outbox:claimAnswerOutbox",
  ),
  complete: makeFunctionReference<
    "mutation",
    OutboxMutationArgs,
    { ok: boolean }
  >("slack/outbox:completeAnswerOutbox"),
  fail: makeFunctionReference<"mutation", OutboxMutationArgs, { ok: boolean }>(
    "slack/outbox:failAnswerOutbox",
  ),
  recover: makeFunctionReference<
    "mutation",
    OutboxMutationArgs,
    { ok: boolean }
  >("slack/outbox:recoverAnswerOutbox"),
  deliver: makeFunctionReference<"action", { answerKey: string }, unknown>(
    "slack/outboxWorker:deliverAnswerOutbox",
  ),
} as const;
const find = async (db: OutboxReader, k: string) =>
  await db
    .query("outboundDeliveryOutbox")
    .withIndex("by_answer_key", (q) => q.eq("answerKey", k))
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
      .withIndex("by_connection_key", (q) =>
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
      .withIndex("by_lease_expiry", (q) => q.eq("status", "in_flight"))
      .filter((q) => q.lte(q.field("leaseExpiresAt"), a.now))
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
      .withIndex("by_binding_key", (q) =>
        q.eq("bindingKey", row.lifecycle.bindingKey),
      )
      .unique();
    const policies = await ctx.db
      .query("channelDeliveryPolicies")
      .withIndex("by_channel_active", (q) =>
        q.eq("channelKey", row.delivery.channelKey),
      )
      .filter((q) => q.eq(q.field("active"), true))
      .collect();
    const records = await ctx.db
      .query("policies")
      .withIndex("by_policy_version", (q) =>
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
      (candidate) =>
        (candidate as Record<string, unknown>).organizationKey ===
        row.delivery.organizationKey,
    ) as Parameters<typeof authorizeAnswerDelivery>[0]["policy"] | undefined;
    if (policy === undefined) return false;
    let operation = defaultOperationPolicy("slackDelivery");
    try {
      const current = records
        .filter((record) => record.status === "active")
        .map((record) =>
          operationPolicyFromRecord(
            record as Parameters<typeof operationPolicyFromRecord>[0],
          ),
        )
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
  ctx: { readonly db: OutboxMutator },
  k: string,
  fn: (r: SlackAnswerOutboxRow) => Either.Either<SlackAnswerOutboxRow, unknown>,
) => {
  const r = await find(ctx.db, k);
  if (!r) return { ok: false };
  const n = fn(r as SlackAnswerOutboxRow);
  if (Either.isLeft(n)) return { ok: false };
  await ctx.db.patch(r._id, {
    ...n.right,
    answer: {
      ...n.right.answer,
      citations: n.right.answer.citations.map((citation) => ({ ...citation })),
    },
  } as never);
  return { ok: true };
};
export const enqueueAnswerOutboxHandler = async (
  ctx: { readonly db: OutboxEnqueuer },
  a: {
    readonly input: AnswerDeliveryInput;
    readonly authorized: AnswerDeliveryAuthorization;
  },
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
    answer: {
      ...r.answer,
      citations: r.answer.citations.map((citation) => ({ ...citation })),
    },
    schemaVersion: 1,
    organizationKey: r.delivery.organizationKey,
  } as never);
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

export const recoverExpiredAnswerOutboxesHandler = async (
  ctx: OutboxActionContext,
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
