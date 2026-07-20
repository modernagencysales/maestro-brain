import { createHmac, timingSafeEqual } from "node:crypto";

import * as Schema from "effect/Schema";

import { sha256Hex } from "../shared/sha256";

const StableKey = Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_.:-]+$/));
const PositiveInteger = Schema.Number.pipe(Schema.int(), Schema.greaterThan(0));
const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);
const ProviderObjectId = StableKey;
const SourceKey = Schema.String.pipe(Schema.pattern(/^src_[A-Za-z0-9_.:-]+$/));
const RevisionKey = Schema.String.pipe(Schema.pattern(/^srev_[a-f0-9]{64}$/));
const IsoTimestamp = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
);
const Hash = Schema.String.pipe(Schema.pattern(/^sha256:[a-f0-9]{64}$/));
const slackEnvelopeBrand: unique symbol = Symbol("VerifiedSlackEnvelope");
const ReceiptSuccessOutcome = Schema.Literal(
  "inserted",
  "duplicate",
  "tombstone",
);
const ReceiptNoSourceOutcome = Schema.Literal("ignored_bot_output", "rejected");
const IgnoredReason = Schema.Literal(
  "self_authored_bot",
  "unsupported_subtype",
);
const RejectedReason = Schema.Literal(
  "invalid_payload",
  "channel_access_lost",
  "payload_too_large",
);
const Transport = Schema.Literal("live", "backfill", "reconciliation");
const Lifecycle = Schema.Struct({
  state: Schema.Literal("active", "deleted_tombstone", "redacted", "purged"),
  generation: PositiveInteger,
  updatedAt: NonNegativeInteger,
  purgeAfter: Schema.NullOr(Schema.Number),
});
const AuthorSnapshot = Schema.Struct({
  providerUserId: StableKey,
  displayName: Schema.String,
});

const ProviderEventReceiptBase = {
  schemaVersion: Schema.Literal(1),
  organizationKey: StableKey,
  connectionKey: StableKey,
  connectionGeneration: PositiveInteger,
  channelKey: StableKey,
  externalChannelId: StableKey,
  transport: Transport,
  transportDeliveryId: StableKey,
  providerEventId: StableKey,
  providerObjectId: ProviderObjectId,
  providerRevisionId: StableKey,
  providerOrder: StableKey,
  canonicalContentHash: Hash,
  tombstone: Schema.Boolean,
  signatureVerification: Schema.Struct({
    status: Schema.Literal("verified"),
    receiptHash: Hash,
  }),
  replayVerification: Schema.Struct({
    status: Schema.Literal("accepted"),
    receiptHash: Hash,
  }),
  receivedAt: NonNegativeInteger,
  createdAt: NonNegativeInteger,
};

export const ProviderEventReceiptRow = Schema.Union(
  Schema.Struct({
    ...ProviderEventReceiptBase,
    observationKey: StableKey,
    sourceKey: SourceKey,
    sourceRevisionKey: RevisionKey,
    outcome: ReceiptSuccessOutcome,
  }),
  Schema.Struct({
    ...ProviderEventReceiptBase,
    observationKey: Schema.Null,
    sourceKey: Schema.Null,
    sourceRevisionKey: Schema.Null,
    outcome: ReceiptNoSourceOutcome,
    reason: Schema.Union(IgnoredReason, RejectedReason),
  }),
);

export const SourceArtifactRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: StableKey,
  connectionKey: StableKey,
  connectionGeneration: PositiveInteger,
  channelKey: StableKey,
  externalChannelId: StableKey,
  providerObjectId: StableKey,
  sourceKey: SourceKey,
  threadKey: StableKey,
  latestSourceRevisionKey: RevisionKey,
  latestProviderOrder: StableKey,
  lifecycle: Lifecycle,
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export const SourceRevisionRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: StableKey,
  connectionKey: StableKey,
  connectionGeneration: PositiveInteger,
  channelKey: StableKey,
  sourceKey: SourceKey,
  sourceRevisionKey: RevisionKey,
  observationKey: StableKey,
  providerOrder: StableKey,
  providerRevisionId: StableKey,
  sourceCreatedAt: NonNegativeInteger,
  sourceTimestamp: IsoTimestamp,
  authorSnapshot: AuthorSnapshot,
  normalizedText: Schema.String.pipe(Schema.maxLength(32_000)),
  blocksJson: Schema.String,
  permalink: Schema.String,
  contentHash: Hash,
  tombstone: Schema.Boolean,
  lifecycle: Lifecycle,
  createdAt: NonNegativeInteger,
});

export const SourceProcessingJobRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: StableKey,
  sourceUnitKey: StableKey,
  sourceRevisionKey: RevisionKey,
  stage: Schema.Literal(
    "assembly_pending",
    "classification_pending",
    "maintenance_pending",
  ),
  status: Schema.Literal(
    "pending",
    "leased",
    "complete",
    "failed",
    "dead_letter",
  ),
  effectKey: StableKey,
  policyEpoch: PositiveInteger,
  leaseOwner: Schema.NullOr(Schema.String),
  leaseExpiresAt: Schema.NullOr(NonNegativeInteger),
  nextRetryAt: NonNegativeInteger,
  attemptCount: NonNegativeInteger,
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export const VerifiedSlackChannelBinding = Schema.Struct({
  providerEventId: StableKey,
  signatureVerification: Schema.Struct({
    status: Schema.Literal("verified"),
    receiptHash: Hash,
  }),
  replayVerification: Schema.Struct({
    status: Schema.Literal("accepted"),
    receiptHash: Hash,
  }),
  organizationKey: StableKey,
  connectionKey: StableKey,
  connectionGeneration: PositiveInteger,
  teamId: StableKey,
  appId: StableKey,
  botUserId: StableKey,
  channelKey: StableKey,
  externalChannelId: StableKey,
});
export type VerifiedSlackEnvelope = typeof VerifiedSlackChannelBinding.Type & {
  readonly [slackEnvelopeBrand]: true;
};
const brandVerifiedSlackEnvelope = (
  value: typeof VerifiedSlackChannelBinding.Type,
): VerifiedSlackEnvelope => {
  const decoded = Schema.decodeUnknownSync(VerifiedSlackChannelBinding)(value);
  return Object.defineProperty(decoded, slackEnvelopeBrand, {
    value: true,
    enumerable: false,
  }) as VerifiedSlackEnvelope;
};

export type NativeSlackReplayAdmission = {
  readonly providerEventId: string;
  readonly status: "accepted";
  readonly receiptHash: typeof Hash.Type;
};

export type NativeSlackVerificationInput = {
  readonly rawBody: string;
  readonly signingSecret: string;
  readonly signature: string;
  readonly timestampSeconds: number;
  readonly nowSeconds: number;
  readonly replayAdmission: NativeSlackReplayAdmission;
  readonly binding: Omit<
    typeof VerifiedSlackChannelBinding.Type,
    "signatureVerification" | "replayVerification"
  >;
};

const slackSignatureFor = (
  signingSecret: string,
  timestampSeconds: number,
  rawBody: string,
) =>
  `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestampSeconds}:${rawBody}`)
    .digest("hex")}`;

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
};

export const verifyNativeSlackEnvelope = ({
  rawBody,
  signingSecret,
  signature,
  timestampSeconds,
  nowSeconds,
  replayAdmission,
  binding,
}: NativeSlackVerificationInput): VerifiedSlackEnvelope => {
  if (Math.abs(nowSeconds - timestampSeconds) > 60 * 5)
    throw new ChannelAccessLost("ChannelAccessLost");
  const expected = slackSignatureFor(signingSecret, timestampSeconds, rawBody);
  if (!safeEqual(expected, signature))
    throw new ChannelAccessLost("ChannelAccessLost");
  if (replayAdmission.providerEventId !== binding.providerEventId)
    throw new DuplicateKeyConflict("DuplicateKeyConflict");
  const evidenceBase = {
    providerEventId: binding.providerEventId,
    timestampSeconds,
    bodyHash: `sha256:${digest(rawBody)}`,
  };
  return brandVerifiedSlackEnvelope({
    ...binding,
    signatureVerification: {
      status: "verified",
      receiptHash: `sha256:${digest({ ...evidenceBase, signature })}`,
    },
    replayVerification: {
      status: replayAdmission.status,
      receiptHash: replayAdmission.receiptHash,
    },
  });
};
const assertVerifiedSlackEnvelope = (value: unknown): VerifiedSlackEnvelope => {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Record<PropertyKey, unknown>)[slackEnvelopeBrand] !== true
  )
    throw new ChannelAccessLost("ChannelAccessLost");
  return Schema.decodeUnknownSync(VerifiedSlackChannelBinding)(
    value,
  ) as VerifiedSlackEnvelope;
};

export const SourceLedgerCaptureInput = Schema.Struct({
  envelope: Schema.Struct({
    organizationKey: StableKey,
    connectionKey: StableKey,
    connectionGeneration: PositiveInteger,
    teamId: StableKey,
    appId: StableKey,
