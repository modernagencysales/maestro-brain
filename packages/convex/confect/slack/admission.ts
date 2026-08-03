import * as Schema from "effect/Schema";

import {
  VerifiedSlackChannelBinding,
  type VerifiedSlackEnvelope,
} from "../sources/sourceSchemas";
import { constantTimeEqual } from "../shared/tokenCrypto";
import { sha256Hex } from "../shared/sha256";

export const slackV0TimestampSkewSeconds = 300;

export class SlackAdmissionError extends Error {
  readonly _tag = "SlackAdmissionError" as const;

  constructor(
    readonly reason:
      "malformed" | "stale" | "bad_signature" | "replay" | "tenant_policy",
  ) {
    super(`Slack event admission failed: ${reason}`);
  }
}

type SlackPolicy = Pick<
  VerifiedSlackEnvelope,
  | "organizationKey"
  | "connectionKey"
  | "connectionGeneration"
  | "teamId"
  | "appId"
  | "botUserId"
  | "channelKey"
  | "externalChannelId"
> & {
  readonly connectionStatus: "active" | string;
  readonly channelMembershipStatus:
    "joined_needs_policy" | "joined_active" | string;
};

export type SlackSignedEventAdmission = SlackPolicy & {
  readonly providerEventId: string;
  readonly rawBody: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly signingSecret: string;
  readonly nowMillis: number;
  readonly maxSkewSeconds?: number;
  readonly seenReplayKeys?: ReadonlySet<string>;
};

const receiptHash = (value: string): `sha256:${string}` =>
  `sha256:${sha256Hex(value)}`;

const hmacSha256Hex = async (
  secret: string,
  value: string,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

const policyFor = (input: SlackSignedEventAdmission): SlackPolicy => {
  if (
    input.connectionStatus !== "active" ||
    (input.channelMembershipStatus !== "joined_needs_policy" &&
      input.channelMembershipStatus !== "joined_active")
  )
    throw new SlackAdmissionError("tenant_policy");
  return input;
};

export const slackReplayKeyFor = (
  input: Pick<
    SlackPolicy,
    "organizationKey" | "connectionKey" | "connectionGeneration"
  > & {
    readonly providerEventId: string;
  },
) =>
  `slack:v0:${input.organizationKey}:${input.connectionKey}:${String(input.connectionGeneration)}:${input.providerEventId}`;

export const slackIdempotencyKeyFor = (
  input: Pick<
    SlackPolicy,
    "organizationKey" | "connectionKey" | "connectionGeneration"
  > & {
    readonly providerEventId: string;
    readonly rawBody: string;
  },
) => `${slackReplayKeyFor(input)}:${sha256Hex(input.rawBody)}`;

export const admitSlackSignedEvent = async (
  input: SlackSignedEventAdmission,
): Promise<VerifiedSlackEnvelope> => {
  const policy = policyFor(input);
  if (
    !input.rawBody ||
    !input.signingSecret ||
    !/^\d+$/.test(input.timestamp) ||
    !/^v0=[a-f0-9]{64}$/.test(input.signature)
  )
    throw new SlackAdmissionError("malformed");

  const timestampSeconds = Number(input.timestamp);
  const nowSeconds = input.nowMillis / 1000;
  const maxSkew = input.maxSkewSeconds ?? slackV0TimestampSkewSeconds;
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    !Number.isFinite(input.nowMillis) ||
    maxSkew < 0 ||
    Math.abs(nowSeconds - timestampSeconds) > maxSkew
  )
    throw new SlackAdmissionError("stale");

  const expected = `v0=${await hmacSha256Hex(
    input.signingSecret,
    `v0:${input.timestamp}:${input.rawBody}`,
  )}`;
  if (!constantTimeEqual(expected, input.signature))
    throw new SlackAdmissionError("bad_signature");

  const replayKey = slackReplayKeyFor(input);
  if (input.seenReplayKeys?.has(replayKey))
    throw new SlackAdmissionError("replay");

  const binding = {
    providerEventId: input.providerEventId,
    signatureVerification: {
      status: "verified" as const,
      receiptHash: receiptHash(`v0:${input.timestamp}:${input.rawBody}`),
    },
    replayVerification: {
      status: "accepted" as const,
      receiptHash: receiptHash(replayKey),
    },
    organizationKey: policy.organizationKey,
    connectionKey: policy.connectionKey,
    connectionGeneration: policy.connectionGeneration,
    teamId: policy.teamId,
    appId: policy.appId,
    botUserId: policy.botUserId,
    channelKey: policy.channelKey,
    externalChannelId: policy.externalChannelId,
  };
  try {
    return Schema.decodeUnknownSync(VerifiedSlackChannelBinding)(binding);
  } catch {
    throw new SlackAdmissionError("tenant_policy");
  }
};
