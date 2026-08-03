import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import * as Either from "effect/Either";
import {
  answerOutboxRow,
  claimAnswerOutboxRow,
  completeAnswerDelivery,
  recordAnswerDeliveryFailure,
  recoverExpiredAnswerDelivery,
  type AnswerDeliveryInput,
  type AnswerDeliveryAuthorization,
  type SlackAnswerOutboxRow,
} from "../../confect/slack/answerOutbox";
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
const find = async (db: any, k: string) =>
  await db
    .query("outboundDeliveryOutbox")
    .withIndex("by_answer_key", (q: any) => q.eq("answerKey", k))
    .unique();
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
export const enqueueAnswerOutbox = internalMutationGeneric({
  args: { input: v.any(), authorized: v.any() },
  returns: v.object({ inserted: v.boolean(), answerKey: v.string() }),
  handler: async (ctx, a) => {
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
    return { inserted: true, answerKey: r.answerKey };
  },
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
