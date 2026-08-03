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
  handler: async (ctx, a) => {
    const r = receiveSlackQuestion(a.input as never),
      s = selectAuthorizedBrainScope(r, {
        scopes: a.scopes as never,
        ...(a.scopeKey === undefined ? {} : { scopeKey: a.scopeKey }),
      }),
      k =
        "receiptKey" in s && typeof s.receiptKey === "string"
          ? s.receiptKey
          : `sha256:${sha256Hex(`${s.organizationKey}:${s.providerEventId}`)}`,
      e = await ctx.db
        .query("slackQuestionReceipts")
        .withIndex("by_receipt_key", (q: any) => q.eq("receiptKey", k))
        .unique();
    if (!e)
      await ctx.db.insert("slackQuestionReceipts", {
        schemaVersion: 1,
        receiptKey: k,
        organizationKey: s.organizationKey,
        connectionKey: s.connectionKey,
        providerEventId: s.providerEventId,
        state: s.state,
        requester: s.requester,
        questionHash: s.questionHash,
        scope: s.scope,
        ...(s.reason === undefined ? {} : { reason: s.reason }),
        ...(s.availableBrainKeys === undefined
          ? {}
          : { availableBrainKeys: s.availableBrainKeys }),
        receivedAt: s.receivedAt,
        createdAt: s.receivedAt,
      });
    return { state: s.state, receiptKey: k };
  },
});
