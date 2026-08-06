import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import * as Either from "effect/Either";
import {
  receiveSlackQuestion,
  selectAuthorizedBrainScope,
} from "../../confect/slack/question";
import { authorizeAnswerDelivery } from "../../confect/slack/answerOutbox";
import {
  defaultOperationPolicy,
  operationPolicyFromRecord,
  operationPolicyKey,
} from "../../confect/ops/brainOperationPolicy";
import { orchestrateSlackQuestion } from "../../confect/slack/questionOrchestration";
import { sha256Hex } from "../../confect/shared/sha256";
import type { AskResponse } from "../../confect/brain/retrieval";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

type SlackQuestionReceiptRow = {
  readonly state: string;
  readonly scope: unknown | null;
};
type OperationPolicyRecord = {
  readonly status: string;
  readonly dataJson: string;
};
type IndexQuery = { eq(field: string, value: unknown): IndexQuery };

const delivery = {
  organizationKey: v.string(),
  workspaceId: v.string(),
  brainKey: v.string(),
  requesterUserId: v.string(),
  requesterSlackUserId: v.string(),
  bindingKey: v.string(),
  bindingGeneration: v.number(),
  connectionKey: v.string(),
  connectionGeneration: v.number(),
  teamId: v.string(),
  channelKey: v.string(),
  externalChannelId: v.string(),
  deliveryGeneration: v.number(),
  operationGeneration: v.number(),
  now: v.number(),
};
const internalQuestion = {
  getReceipt: makeFunctionReference<"query", { receiptKey: string }, unknown>(
    "slack/question:getSlackQuestionReceipt",
  ),
  ask: makeFunctionReference<
    "query",
    { brainKey: string; question: string },
    unknown
  >("brain/readApi:answersAsk"),
  binding: makeFunctionReference<"query", { bindingKey: string }, unknown>(
    "slack/question:getSlackIdentityBinding",
  ),
  policies: makeFunctionReference<"query", { channelKey: string }, unknown>(
    "slack/question:getChannelDeliveryPolicies",
  ),
  operations: makeFunctionReference<"query", { policyKey: string }, unknown>(
    "slack/question:getOperationPolicies",
  ),
  enqueue: makeFunctionReference<
    "mutation",
    { input: unknown; authorized: unknown },
    { inserted: boolean; answerKey: string }
  >("slack/outbox:enqueueAnswerOutbox"),
  answer: makeFunctionReference<
    "action",
    { receiptKey: string; questionText: string; delivery: unknown },
    { outcome: string; answerKey?: string }
  >("slack/question:answerSlackQuestion"),
};

export const getSlackQuestionReceipt = internalQueryGeneric({
  args: { receiptKey: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx: QueryCtx, args) =>
    await ctx.db
      .query("slackQuestionReceipts")
      .withIndex("by_receipt_key", (q) => q.eq("receiptKey", args.receiptKey))
      .unique(),
});

export const getSlackIdentityBinding = internalQueryGeneric({
  args: { bindingKey: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx: QueryCtx, args) =>
    await ctx.db
      .query("slackIdentityBindings")
      .withIndex("by_binding_key", (q) => q.eq("bindingKey", args.bindingKey))
      .unique(),
});

export const getChannelDeliveryPolicies = internalQueryGeneric({
  args: { channelKey: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx: QueryCtx, args) =>
    await ctx.db
      .query("channelDeliveryPolicies")
      .withIndex(
        "by_channel_active",
        (q) =>
          (q as unknown as IndexQuery)
            .eq("channelKey", args.channelKey)
            .eq("active", true) as never,
      )
      .collect(),
});

export const getOperationPolicies = internalQueryGeneric({
  args: { policyKey: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx: QueryCtx, args) =>
    await ctx.db
      .query("policies")
      .withIndex("by_policy_version", (q) => q.eq("policyKey", args.policyKey))
      .collect(),
});
export const receiveSlackQuestionReceipt = internalMutationGeneric({
  args: {
    input: v.any(),
    scopes: v.array(v.any()),
    scopeKey: v.optional(v.string()),
  },
  returns: v.object({ state: v.string(), receiptKey: v.string() }),
  handler: async (ctx: MutationCtx, a) => {
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
        .withIndex("by_receipt_key", (q) => q.eq("receiptKey", k))
        .unique();
    if (!e) {
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
          : { availableBrainKeys: [...s.availableBrainKeys] }),
        receivedAt: s.receivedAt,
        createdAt: s.receivedAt,
      });
      const input = a.input as { readonly text?: unknown };
      if (s.state === "scoped" && typeof input.text === "string") {
        await ctx.scheduler.runAfter(0, internalQuestion.answer, {
          receiptKey: k,
          questionText: input.text,
          delivery: {
            organizationKey: s.organizationKey,
            workspaceId: s.scope?.workspaceId ?? "",
            brainKey: s.scope?.brainKey ?? "",
            requesterUserId: s.requester.userId,
            requesterSlackUserId: s.requester.slackUserId,
            bindingKey: s.requester.bindingKey,
            bindingGeneration: s.requester.bindingGeneration,
            connectionKey: s.connectionKey,
            connectionGeneration: s.connectionGeneration,
            teamId: s.teamId,
            channelKey: s.channelKey,
            externalChannelId: s.externalChannelId,
            deliveryGeneration: 0,
            operationGeneration: 0,
            now: s.receivedAt,
          },
        });
      }
    }
    return { state: s.state, receiptKey: k };
  },
});

export const answerSlackQuestion = internalActionGeneric({
  args: {
    receiptKey: v.string(),
    questionText: v.string(),
    delivery: v.object(delivery),
  },
  returns: v.object({ outcome: v.string(), answerKey: v.optional(v.string()) }),
  handler: async (ctx: ActionCtx, args) => {
    const row = (await ctx.runQuery(internalQuestion.getReceipt, {
      receiptKey: args.receiptKey,
    })) as SlackQuestionReceiptRow | null;
    if (row === null || row.state !== "scoped" || row.scope === null)
      return { outcome: "ignored" };
    const binding = await ctx.runQuery(internalQuestion.binding, {
      bindingKey: args.delivery.bindingKey,
    });
    const policies = await ctx.runQuery(internalQuestion.policies, {
      channelKey: args.delivery.channelKey,
    });
    if (binding === null || !Array.isArray(policies))
      return { outcome: "denied" };
    const policy = policies.find(
      (candidate) =>
        candidate.organizationKey === args.delivery.organizationKey &&
        candidate.active === true,
    );
    if (policy === undefined) return { outcome: "denied" };
    const records = (await ctx.runQuery(internalQuestion.operations, {
      policyKey: operationPolicyKey(args.delivery.workspaceId, "slackDelivery"),
    })) as readonly OperationPolicyRecord[];
    let operation = defaultOperationPolicy("slackDelivery");
    const current = records
      .filter((record) => record.status === "active")
      .map(operationPolicyFromRecord)
      .sort((left, right) => right.generation - left.generation)[0];
    if (current !== undefined) operation = current;
    const authorization = authorizeAnswerDelivery({
      input: {
        ...args.delivery,
        requestId: args.receiptKey,
        answerReference: `slack-ask:${args.receiptKey}`,
        answerPayload: { format: "mrkdwn", text: "", citations: [] },
      },
      binding: binding as never,
      policy,
      operation,
    });
    if (Either.isLeft(authorization)) return { outcome: "denied" };
    const result = await orchestrateSlackQuestion(
      {
        question: row as never,
        questionText: args.questionText,
        delivery: args.delivery,
        authorized: authorization.right,
      },
      {
        ask: async (input) => {
          const asked = (await ctx.runQuery(internalQuestion.ask, input)) as {
            readonly response: AskResponse;
          };
          return asked.response;
        },
        enqueue: async (input, authorized) =>
          await ctx.runMutation(internalQuestion.enqueue, {
            input,
            authorized,
          }),
      },
    );
    return result.outcome === "enqueued" ? result : { outcome: result.outcome };
  },
});
