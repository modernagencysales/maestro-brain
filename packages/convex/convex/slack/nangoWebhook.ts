import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { sha256Hex } from "../../confect/shared/sha256";
import type { VerifiedSlackEnvelope } from "../../confect/sources/sourceSchemas";
import { internalMutation } from "../_generated/server";
import { receiveVerifiedSlackEvent } from "./ingress";

const receiveQuestion = makeFunctionReference<
  "mutation",
  { input: unknown; scopes: readonly unknown[]; scopeKey?: string },
  unknown
>("slack/question:receiveSlackQuestionReceipt");

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`NangoSlackWebhookMissing:${field}`);
  return value;
};

const receiptHash = (value: string): `sha256:${string}` =>
  `sha256:${sha256Hex(value)}`;

const questionKind = (event: Record<string, unknown>) => {
  if (event.type === "app_mention") return "app_mention" as const;
  if (event.type === "message" && event.channel_type === "im")
    return "dm" as const;
  return null;
};

export const receiveNangoSlackWebhook = internalMutation({
  args: {
    connectionId: v.string(),
    providerConfigKey: v.string(),
    payload: v.any(),
    deliveryDigest: v.string(),
    signature: v.string(),
    receivedAt: v.number(),
  },
  returns: v.object({
    outcome: v.string(),
    questionOutcome: v.optional(v.string()),
  }),
  handler: async (ctx, input) => {
    if (!/^[a-f0-9]{64}$/.test(input.deliveryDigest))
      throw new Error("NangoSlackDeliveryDigestInvalid");
    const payload = record(input.payload);
    const event = record(payload?.event);
    if (payload === null || event === null)
      throw new Error("NangoSlackWebhookMalformed");

    const connection = await ctx.db
      .query("providerConnections")
      .withIndex("by_nango_connection", (query) =>
        query.eq("nangoConnectionId", input.connectionId),
      )
      .unique();
    if (
      connection === null ||
      connection.provider !== "nango" ||
      connection.providerConfigKey !== input.providerConfigKey ||
      connection.status !== "active" ||
      connection.nangoConnectionId !== input.connectionId ||
      connection.teamId == null ||
      connection.apiAppId == null ||
      connection.botUserId == null
    )
      throw new Error("NangoSlackConnectionUnavailable");

    const teamId = requiredString(
      payload.team_id ?? record(payload.team)?.id,
      "team_id",
    );
    if (teamId !== connection.teamId) throw new Error("NangoSlackTeamMismatch");
    const externalChannelId = requiredString(event.channel, "event.channel");
    const providerEventId = requiredString(payload.event_id, "event_id");
    const channel = await ctx.db
      .query("sourceChannels")
      .withIndex("by_connection_external_channel", (query) =>
        query
          .eq("connectionKey", connection.connectionKey)
          .eq("externalChannelId", externalChannelId),
      )
      .unique();
    if (
      channel === null ||
      channel.organizationKey !== connection.organizationKey ||
      channel.connectionGeneration !== connection.connectionGeneration ||
      (channel.membershipStatus !== "joined_needs_policy" &&
        channel.membershipStatus !== "joined_active")
    )
      throw new Error("NangoSlackChannelUnavailable");

    const policies = await ctx.db
      .query("channelRoutingPolicies")
      .withIndex("by_channel_active", (query) =>
        query.eq("channelKey", channel.channelKey).eq("active", true),
      )
      .take(2);
    if (policies.length > 1) throw new Error("NangoSlackChannelPolicyConflict");
    const policyEpoch = policies[0]?.policyEpoch ?? 1;
    const transportDeliveryId = `nango_${input.deliveryDigest}`;
    const binding: VerifiedSlackEnvelope = {
      providerEventId,
      signatureVerification: {
        status: "verified",
        receiptHash: receiptHash(`nango-hmac:${input.signature}`),
      },
      replayVerification: {
        status: "accepted",
        receiptHash: receiptHash(
          `nango-slack:${input.connectionId}:${providerEventId}`,
        ),
      },
      organizationKey: connection.organizationKey,
      connectionKey: connection.connectionKey,
      connectionGeneration: connection.connectionGeneration,
      teamId,
      appId: connection.apiAppId,
      botUserId: connection.botUserId,
      channelKey: channel.channelKey,
      externalChannelId,
    };
    const captured = await receiveVerifiedSlackEvent(
      ctx,
      {
        organizationKey: connection.organizationKey,
        connectionKey: connection.connectionKey,
        connectionGeneration: connection.connectionGeneration,
        channelKey: channel.channelKey,
        externalChannelId,
        providerEventId,
        transportDeliveryId,
        payload,
        receivedAt: input.receivedAt,
        routing: {
          policyEpoch,
          assemblyStage: "assembly_pending",
          effectKey: `slack_${sha256Hex(`${providerEventId}:${policyEpoch}`)}`,
        },
      },
      binding,
    );
    if (captured.outcome !== "inserted") return { outcome: captured.outcome };

    const eventKind = questionKind(event);
    if (eventKind === null) return { outcome: captured.outcome };
    const slackUserId = requiredString(event.user, "event.user");
    const identityRows = await ctx.db
      .query("slackIdentityBindings")
      .withIndex("by_exact_slack_identity_status", (query) =>
        query
          .eq("organizationKey", connection.organizationKey)
          .eq("teamId", teamId)
          .eq("slackUserId", slackUserId)
          .eq("status", "active"),
      )
      .take(2);
    const identity = identityRows[0];
    if (identityRows.length !== 1 || identity === undefined)
      return {
        outcome: captured.outcome,
        questionOutcome: "identity_required",
      };
    const hasScope =
      identity.workspaceId !== undefined && identity.brainKey !== undefined;
    await ctx.scheduler.runAfter(0, receiveQuestion, {
      input: {
        organizationKey: connection.organizationKey,
        connectionKey: connection.connectionKey,
        connectionGeneration: connection.connectionGeneration,
        currentConnectionGeneration: connection.connectionGeneration,
        teamId,
        eventKind,
        channelKind:
          eventKind === "dm"
            ? "im"
            : event.channel_type === "group"
              ? "private_channel"
              : "public_channel",
        isSlackConnect: channel.isShared || channel.isExtShared,
        channelKey: channel.channelKey,
        externalChannelId,
        providerEventId,
        requester: {
          slackUserId,
          userId: identity.userId,
          bindingKey: identity.bindingKey,
          bindingGeneration: identity.bindingGeneration,
          status: identity.status,
        },
        text: requiredString(event.text, "event.text"),
        receivedAt: input.receivedAt,
      },
      scopes: hasScope
        ? [
            {
              organizationKey: connection.organizationKey,
              workspaceId: identity.workspaceId,
              brainKey: identity.brainKey,
              status: "active",
            },
          ]
        : [],
      ...(identity.brainKey === undefined
        ? {}
        : { scopeKey: identity.brainKey }),
    });
    return { outcome: captured.outcome, questionOutcome: "scheduled" };
  },
});
