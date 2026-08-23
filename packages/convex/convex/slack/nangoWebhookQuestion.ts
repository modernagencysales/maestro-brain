import { makeFunctionReference } from "convex/server";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const receiveQuestion = makeFunctionReference<
  "mutation",
  { input: unknown; scopes: readonly unknown[]; scopeKey?: string },
  unknown
>("slack/question:receiveSlackQuestionReceipt");

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`NangoSlackWebhookMissing:${field}`);
  return value;
};

const questionKind = (event: Record<string, unknown>) => {
  if (event.type === "app_mention") return "app_mention" as const;
  if (event.type === "message" && event.channel_type === "im")
    return "dm" as const;
  return null;
};

const questionChannelKind = (
  eventKind: "app_mention" | "dm",
  event: Record<string, unknown>,
) => {
  if (eventKind === "dm") return "im" as const;
  if (event.channel_type === "group") return "private_channel" as const;
  return "public_channel" as const;
};

export type NangoSlackQuestionCapture = Readonly<{
  channel: Doc<"sourceChannels">;
  connection: Doc<"providerConnections">;
  externalChannelId: string;
  providerEventId: string;
  teamId: string;
}>;

const questionScopes = (
  organizationKey: string,
  identity: Doc<"slackIdentityBindings">,
) => {
  if (identity.workspaceId === undefined) return [];
  if (identity.brainKey === undefined) return [];
  return [
    {
      organizationKey,
      workspaceId: identity.workspaceId,
      brainKey: identity.brainKey,
      status: "active",
    },
  ];
};

export const scheduleNangoSlackQuestion = async (
  ctx: MutationCtx,
  receivedAt: number,
  event: Record<string, unknown>,
  capture: NangoSlackQuestionCapture,
) => {
  const eventKind = questionKind(event);
  if (eventKind === null) return null;
  const slackUserId = requiredString(event.user, "event.user");
  const identities = await ctx.db
    .query("slackIdentityBindings")
    .withIndex("by_exact_slack_identity_status", (query) =>
      query
        .eq("organizationKey", capture.connection.organizationKey)
        .eq("teamId", capture.teamId)
        .eq("slackUserId", slackUserId)
        .eq("status", "active"),
    )
    .take(2);
  const identity = identities.length === 1 ? identities[0] : undefined;
  if (identity === undefined) return "identity_required" as const;
  await ctx.scheduler.runAfter(0, receiveQuestion, {
    input: {
      organizationKey: capture.connection.organizationKey,
      connectionKey: capture.connection.connectionKey,
      connectionGeneration: capture.connection.connectionGeneration,
      currentConnectionGeneration: capture.connection.connectionGeneration,
      teamId: capture.teamId,
      eventKind,
      channelKind: questionChannelKind(eventKind, event),
      isSlackConnect: capture.channel.isShared || capture.channel.isExtShared,
      channelKey: capture.channel.channelKey,
      externalChannelId: capture.externalChannelId,
      providerEventId: capture.providerEventId,
      requester: {
        slackUserId,
        userId: identity.userId,
        bindingKey: identity.bindingKey,
        bindingGeneration: identity.bindingGeneration,
        status: identity.status,
      },
      text: requiredString(event.text, "event.text"),
      receivedAt,
    },
    scopes: questionScopes(capture.connection.organizationKey, identity),
    ...(identity.brainKey === undefined ? {} : { scopeKey: identity.brainKey }),
  });
  return "scheduled" as const;
};
