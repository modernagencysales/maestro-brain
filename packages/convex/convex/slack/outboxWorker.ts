"use node";

import { internalActionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import * as Either from "effect/Either";
import * as Effect from "effect/Effect";
import {
  type AnswerLifecycleFence,
  type AnswerOutboxError,
  type SlackAnswerOutboxRow,
} from "../../confect/slack/answerOutbox";
import { captureBrainMetric } from "../../confect/observability/posthog";
import { runAnswerOutboxWorker } from "./outbox";
import type {
  AnswerOutboxStore,
  ProviderPort,
} from "../../confect/slack/outboxPersistence";
import {
  createFakeNangoClient,
  createLiveNangoClient,
  providerModeFromEnv,
  validateNangoEnv,
  type NangoClient,
} from "@maestro-template/integrations/nango/client";
import type { ActionCtx } from "../_generated/server";
import { readProcessEnv } from "../../confect/shared/env";

type OutboxActionContext = Pick<
  ActionCtx,
  "runQuery" | "runMutation" | "scheduler"
>;
type OutboxMutationArgs = Readonly<{
  answerKey: string;
  now: number;
  expectedLifecycle: AnswerLifecycleFence;
  leaseToken?: string;
  leaseExpiresAt?: number;
  kind?: "retryable" | "terminal";
  code?: string;
}>;

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
} as const;

const invalid = (): Either.Either<SlackAnswerOutboxRow, AnswerOutboxError> =>
  Either.left({ _tag: "AnswerOutboxError", reason: "invalid_state" });

const actionStore = (ctx: OutboxActionContext): AnswerOutboxStore => ({
  insertIfAbsent: async () => {
    throw new Error("delivery workers cannot enqueue answer outbox rows");
  },
  claim: async (answerKey, transition) => {
    const current = (await ctx.runQuery(internalOutbox.get, {
      answerKey,
    })) as SlackAnswerOutboxRow | null;
    if (current === null) return null;
    const next = transition(current);
    if (next._tag === "Left") return next;
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
    if (next._tag === "Left") return next;
    const updated =
      next.right.status === "sent"
        ? await ctx.runMutation(internalOutbox.complete, {
            answerKey,
            leaseToken: current.leaseToken ?? "",
            now: next.right.updatedAt,
            expectedLifecycle: next.right.lifecycle,
          })
        : await ctx.runMutation(internalOutbox.fail, {
            answerKey,
            leaseToken: current.leaseToken ?? "",
            now: next.right.updatedAt,
            kind: next.right.lastError?.kind ?? "terminal",
            code: next.right.lastError?.code ?? "unknown_failure",
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
  const env = readProcessEnv();
  const mode = providerModeFromEnv(env);
  if (mode === "live") {
    const secretKey = env.NANGO_SECRET_KEY?.trim();
    const providerConfigKey = env.NANGO_CONNECT_INTEGRATION_ID?.trim();
    if (
      validateNangoEnv("live", env) !== true ||
      !secretKey ||
      !providerConfigKey
    )
      return null;
    nangoClient = createLiveNangoClient({ secretKey, providerConfigKey });
  } else nangoClient = createFakeNangoClient({ now: Date.now() });
  return nangoClient;
};

const providerPort = (ctx: OutboxActionContext): ProviderPort => ({
  send: async (input) => {
    const connection = (await ctx.runQuery(internalOutbox.providerConnection, {
      connectionKey: input.connectionKey,
    })) as {
      readonly status?: string;
      readonly nangoConnectionId?: string;
      readonly connectionGeneration?: number;
      readonly teamId?: string;
    } | null;
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
        leaseExpiresAt: now + 30_000,
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
