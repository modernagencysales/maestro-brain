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
  handler: async (ctx, args) => {
    const row = await findRow(ctx.db, args.answerKey);
    if (!row) return { ok: false };
    const next = claimAnswerOutboxRow(row as SlackAnswerOutboxRow, args);
    if (Either.isLeft(next)) return { ok: false };
    await ctx.db.patch(row._id, next.right);
    return { ok: true };
  },
});

export const completeAnswerOutbox = internalMutationGeneric({
  args: {
    answerKey: v.string(),
    leaseToken: v.string(),
    now: v.number(),
    expectedLifecycle: v.object(fenceArgs),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await findRow(ctx.db, args.answerKey);
    if (!row) return { ok: false };
    const next = completeAnswerDelivery(row as SlackAnswerOutboxRow, args);
    if (Either.isLeft(next)) return { ok: false };
    await ctx.db.patch(row._id, next.right);
    return { ok: true };
  },
});

export const recoverAnswerOutbox = internalMutationGeneric({
  args: {
    answerKey: v.string(),
    now: v.number(),
    expectedLifecycle: v.object(fenceArgs),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await findRow(ctx.db, args.answerKey);
    if (!row) return { ok: false };
    const next = recoverExpiredAnswerDelivery(
      row as SlackAnswerOutboxRow,
      args,
    );
    if (Either.isLeft(next)) return { ok: false };
    await ctx.db.patch(row._id, next.right);
    return { ok: true };
  },
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
  handler: async (ctx, args) => {
    const row = await findRow(ctx.db, args.answerKey);
    if (!row) return { ok: false };
    const next = recordAnswerDeliveryFailure(row as SlackAnswerOutboxRow, args);
    if (Either.isLeft(next)) return { ok: false };
    await ctx.db.patch(row._id, next.right);
    return { ok: true };
  },
});
