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

const fenceArgs = {
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
const findRow = async (db: any, answerKey: string) =>
  await db
    .query("outboundDeliveryOutbox")
    .withIndex("by_answer_key", (q: any) => q.eq("answerKey", answerKey))
    .unique();
const mutateRow = async (
  ctx: any,
  answerKey: string,
  transition: (
    row: SlackAnswerOutboxRow,
  ) => Either.Either<SlackAnswerOutboxRow, unknown>,
) => {
  const row = await findRow(ctx.db, answerKey);
  if (!row) return { ok: false };
  const next = transition(row as SlackAnswerOutboxRow);
  if (Either.isLeft(next)) return { ok: false };
  await ctx.db.patch(row._id, next.right);
  return { ok: true };
};

export const enqueueAnswerOutbox = internalMutationGeneric({
  args: { input: v.any(), authorized: v.any() },
  returns: v.object({ inserted: v.boolean(), answerKey: v.string() }),
  handler: async (ctx, args) => {
    const row = answerOutboxRow({
      input: args.input as AnswerDeliveryInput,
      authorized: args.authorized as AnswerDeliveryAuthorization,
    });
    const existing = await findRow(ctx.db, row.answerKey);
    if (existing) return { inserted: false, answerKey: row.answerKey };
    await ctx.db.insert("outboundDeliveryOutbox", {
      ...row,
      schemaVersion: 1,
      organizationKey: row.delivery.organizationKey,
    });
    return { inserted: true, answerKey: row.answerKey };
  },
});
export const claimAnswerOutbox = internalMutationGeneric({
  args: {
    answerKey: v.string(),
    leaseToken: v.string(),
    leaseExpiresAt: v.number(),
    now: v.number(),
    expectedLifecycle: v.object(fenceArgs),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) =>
    mutateRow(ctx, args.answerKey, (row) => claimAnswerOutboxRow(row, args)),
});
export const completeAnswerOutbox = internalMutationGeneric({
  args: {
    answerKey: v.string(),
    leaseToken: v.string(),
    now: v.number(),
    expectedLifecycle: v.object(fenceArgs),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) =>
    mutateRow(ctx, args.answerKey, (row) => completeAnswerDelivery(row, args)),
});
export const recoverAnswerOutbox = internalMutationGeneric({
  args: {
    answerKey: v.string(),
    now: v.number(),
    expectedLifecycle: v.object(fenceArgs),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) =>
    mutateRow(ctx, args.answerKey, (row) =>
      recoverExpiredAnswerDelivery(row, args),
    ),
});
export const failAnswerOutbox = internalMutationGeneric({
  args: {
    answerKey: v.string(),
    leaseToken: v.string(),
    now: v.number(),
    kind: v.union(v.literal("retryable"), v.literal("terminal")),
    code: v.string(),
    expectedLifecycle: v.object(fenceArgs),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) =>
    mutateRow(ctx, args.answerKey, (row) =>
      recordAnswerDeliveryFailure(row, args),
    ),
});
