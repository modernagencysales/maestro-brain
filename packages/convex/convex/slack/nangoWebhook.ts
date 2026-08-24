import { v } from "convex/values";

import { sha256Hex } from "../../confect/shared/sha256";
import type { VerifiedSlackEnvelope } from "../../confect/sources/sourceSchemas";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { receiveVerifiedSlackEvent } from "./ingress";
import { scheduleNangoSlackQuestion } from "./nangoWebhookQuestion";

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

type NangoSlackInput = Readonly<{
  connectionId: string;
  providerConfigKey: string;
  payload: unknown;
  deliveryDigest: string;
  signature: string;
  receivedAt: number;
}>;

type ActiveNangoSlackConnection = Doc<"providerConnections"> &
  Readonly<{
    teamId: string;
    apiAppId: string;
    botUserId: string;
    nangoConnectionId: string;
  }>;

const assertNangoSlackProviderConnection: (
  connection: Doc<"providerConnections"> | null,
  providerConfigKey: string,
) => asserts connection is Doc<"providerConnections"> = (
  connection,
  providerConfigKey,
) => {
  if (connection === null) throw new Error("NangoSlackConnectionUnavailable");
  if (connection.provider !== "nango")
    throw new Error("NangoSlackConnectionUnavailable");
  if (connection.providerConfigKey !== providerConfigKey)
    throw new Error("NangoSlackConnectionUnavailable");
  if (connection.status !== "active")
    throw new Error("NangoSlackConnectionUnavailable");
};

const assertNangoSlackConnectionMetadata: (
  connection: Doc<"providerConnections">,
  connectionId: string,
) => asserts connection is ActiveNangoSlackConnection = (
  connection,
  connectionId,
) => {
  if (connection.nangoConnectionId !== connectionId)
    throw new Error("NangoSlackConnectionUnavailable");
  if (connection.teamId == null)
    throw new Error("NangoSlackConnectionUnavailable");
  if (connection.apiAppId == null)
    throw new Error("NangoSlackConnectionUnavailable");
  if (connection.botUserId == null)
    throw new Error("NangoSlackConnectionUnavailable");
};

const nangoSlackPayload = (input: NangoSlackInput) => {
  if (!/^[a-f0-9]{64}$/.test(input.deliveryDigest))
    throw new Error("NangoSlackDeliveryDigestInvalid");
  const payload = record(input.payload);
  const event = record(payload?.event);
  if (payload === null) throw new Error("NangoSlackWebhookMalformed");
  if (event === null) throw new Error("NangoSlackWebhookMalformed");
  return { payload, event };
};

const activeNangoSlackConnection = async (
  ctx: MutationCtx,
  input: NangoSlackInput,
): Promise<ActiveNangoSlackConnection> => {
  const connection = await ctx.db
    .query("providerConnections")
    .withIndex("by_nango_connection", (query) =>
      query.eq("nangoConnectionId", input.connectionId),
    )
    .unique();
  assertNangoSlackProviderConnection(connection, input.providerConfigKey);
  assertNangoSlackConnectionMetadata(connection, input.connectionId);
  return connection;
};

const activeSlackChannel = async (
  ctx: MutationCtx,
  connection: ActiveNangoSlackConnection,
  externalChannelId: string,
) => {
  const channel = await ctx.db
    .query("sourceChannels")
    .withIndex("by_connection_external_channel", (query) =>
      query
        .eq("connectionKey", connection.connectionKey)
        .eq("externalChannelId", externalChannelId),
    )
    .unique();
  if (channel === null) throw new Error("NangoSlackChannelUnavailable");
  if (channel.organizationKey !== connection.organizationKey)
    throw new Error("NangoSlackChannelUnavailable");
  if (channel.connectionGeneration !== connection.connectionGeneration)
    throw new Error("NangoSlackChannelUnavailable");
  const admittedMembership = new Set([
    "joined_needs_policy",
    "joined_active",
  ]).has(channel.membershipStatus);
  if (!admittedMembership) throw new Error("NangoSlackChannelUnavailable");
  return channel;
};

const activePolicyEpoch = async (ctx: MutationCtx, channelKey: string) => {
  const policies = await ctx.db
    .query("channelRoutingPolicies")
    .withIndex("by_channel_active", (query) =>
      query.eq("channelKey", channelKey).eq("active", true),
    )
    .take(2);
  if (policies.length > 1) throw new Error("NangoSlackChannelPolicyConflict");
  return policies[0]?.policyEpoch ?? 1;
};

const captureNangoSlackEvent = async (
  ctx: MutationCtx,
  input: NangoSlackInput,
  payload: Record<string, unknown>,
  event: Record<string, unknown>,
) => {
  const connection = await activeNangoSlackConnection(ctx, input);
  const teamId = requiredString(
    payload.team_id ?? record(payload.team)?.id,
    "team_id",
  );
  if (teamId !== connection.teamId) throw new Error("NangoSlackTeamMismatch");
  const externalChannelId = requiredString(event.channel, "event.channel");
  const providerEventId = requiredString(payload.event_id, "event_id");
  const channel = await activeSlackChannel(ctx, connection, externalChannelId);
  const policyEpoch = await activePolicyEpoch(ctx, channel.channelKey);
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
      transportDeliveryId: `nango_${input.deliveryDigest}`,
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
  return {
    captured,
    channel,
    connection,
    externalChannelId,
    providerEventId,
    teamId,
  };
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
    const { payload, event } = nangoSlackPayload(input);
    const capture = await captureNangoSlackEvent(ctx, input, payload, event);
    if (capture.captured.outcome !== "inserted")
      return { outcome: capture.captured.outcome };
    const questionOutcome = await scheduleNangoSlackQuestion(
      ctx,
      input.receivedAt,
      event,
      capture,
    );
    return {
      outcome: capture.captured.outcome,
      ...(questionOutcome === null ? {} : { questionOutcome }),
    };
  },
});
