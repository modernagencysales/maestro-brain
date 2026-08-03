import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import {
  receiveSlackQuestion,
  selectAuthorizedBrainScope,
} from "../../confect/slack/question";
import { sha256Hex } from "../../confect/shared/sha256";
export const receiveSlackQuestionReceipt = internalMutationGeneric({
  args: {
    input: v.any(),
    scopes: v.array(v.any()),
    scopeKey: v.optional(v.string()),
  },
  returns: v.object({ state: v.string(), receiptKey: v.string() }),
  handler: async (ctx, args) => {
    const received = receiveSlackQuestion(args.input as never);
    const scoped = selectAuthorizedBrainScope(received, {
      scopes: args.scopes as never,
      ...(args.scopeKey === undefined ? {} : { scopeKey: args.scopeKey }),
    });
    const receiptKey =
      "receiptKey" in scoped && typeof scoped.receiptKey === "string"
        ? scoped.receiptKey
        : `sha256:${sha256Hex(`${scoped.organizationKey}:${scoped.providerEventId}`)}`;
    const existing = await ctx.db
      .query("slackQuestionReceipts")
      .withIndex("by_receipt_key", (q: any) => q.eq("receiptKey", receiptKey))
      .unique();
    if (!existing)
      await ctx.db.insert("slackQuestionReceipts", {
        schemaVersion: 1,
        receiptKey,
        organizationKey: scoped.organizationKey,
        connectionKey: scoped.connectionKey,
        providerEventId: scoped.providerEventId,
        state: scoped.state,
        requester: scoped.requester,
        questionHash: scoped.questionHash,
        scope: scoped.scope,
        ...(scoped.reason === undefined ? {} : { reason: scoped.reason }),
        ...(scoped.availableBrainKeys === undefined
          ? {}
          : { availableBrainKeys: scoped.availableBrainKeys }),
        receivedAt: scoped.receivedAt,
        createdAt: scoped.receivedAt,
      });
    return { state: scoped.state, receiptKey };
  },
});
