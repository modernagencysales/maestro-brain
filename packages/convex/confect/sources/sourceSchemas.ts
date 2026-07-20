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
    botUserId: StableKey,
    channelKey: StableKey,
    externalChannelId: StableKey,
    transport: Transport,
    transportDeliveryId: StableKey,
    receivedAt: NonNegativeInteger,
  }),
  observation: Schema.Struct({
    providerObjectId: ProviderObjectId,
    threadKey: StableKey,
    sourceTimestamp: IsoTimestamp,
    providerOrder: StableKey,
    providerRevisionId: StableKey,
    author: AuthorSnapshot,
    text: Schema.String.pipe(Schema.maxLength(32_000)),
    blocksJson: Schema.String,
    permalink: Schema.String,
    tombstone: Schema.Boolean,
    revisionNonce: StableKey,
  }),
  routing: Schema.Struct({
    policyEpoch: PositiveInteger,
    assemblyStage: Schema.Literal("assembly_pending"),
    effectKey: StableKey,
  }),
});

const SourceLedgerEnvelope = SourceLedgerCaptureInput.fields.envelope;
type SourceLedgerEnvelopeType = typeof SourceLedgerEnvelope.Type;

const assertBindingMatchesEnvelope = (
  binding: typeof VerifiedSlackChannelBinding.Type,
  envelope: SourceLedgerEnvelopeType,
) => {
  if (
    binding.organizationKey !== envelope.organizationKey ||
    binding.connectionKey !== envelope.connectionKey ||
    binding.connectionGeneration !== envelope.connectionGeneration
  )
    throw new TenantMismatch("TenantMismatch");
  if (
    binding.teamId !== envelope.teamId ||
    binding.appId !== envelope.appId ||
    binding.botUserId !== envelope.botUserId ||
    binding.channelKey !== envelope.channelKey ||
    binding.externalChannelId !== envelope.externalChannelId
  )
    throw new ChannelAccessLost("ChannelAccessLost");
};

type MutablePartial<T> = { -readonly [K in keyof T]?: T[K] };

type CaptureValidationOptions = {
  readonly seenTransportDeliveries?: Set<string>;
  readonly existingObservationKey?: string;
  readonly existingArtifact?: {
    readonly sourceKey: string;
    readonly latestProviderOrder: string;
    readonly lifecycleGeneration: number;
    readonly createdAt: number;
  };
  readonly verifiedBinding?: VerifiedSlackEnvelope;
};

const taggedError = <const Tag extends string>(_tag: Tag) =>
  class extends Error {
    readonly _tag = _tag;
  };
export const TenantMismatch = taggedError("TenantMismatch");
export const ChannelAccessLost = taggedError("ChannelAccessLost");
export const ObservationInvalid = taggedError("ObservationInvalid");
export const PayloadTooLarge = taggedError("PayloadTooLarge");
export const DuplicateKeyConflict = taggedError("DuplicateKeyConflict");

const digest = (value: unknown) => sha256Hex(JSON.stringify(value));
const stableOrInvalidPayload = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]+$/.test(value)
    ? value
    : "invalid_payload";

export const sourceLedgerKeysFor = (
  input: typeof SourceLedgerCaptureInput.Type,
) => {
  const sourceKey = `src_${digest({
    organizationKey: input.envelope.organizationKey,
    connectionKey: input.envelope.connectionKey,
    connectionGeneration: input.envelope.connectionGeneration,
    channelKey: input.envelope.channelKey,
    providerObjectId: input.observation.providerObjectId,
  })}`;
  const contentHash = `sha256:${digest({
    text: input.observation.text,
    blocksJson: input.observation.blocksJson,
    tombstone: input.observation.tombstone,
  })}`;
  const observationKey = `obs_${digest({
    organizationKey: input.envelope.organizationKey,
    connectionKey: input.envelope.connectionKey,
    connectionGeneration: input.envelope.connectionGeneration,
    externalChannelId: input.envelope.externalChannelId,
    providerObjectId: input.observation.providerObjectId,
    providerRevisionId: input.observation.providerRevisionId,
    canonicalContentHash: input.observation.tombstone
      ? "tombstone"
      : contentHash,
  })}`;
  const sourceRevisionKey = `srev_${digest({
    sourceKey,
    providerOrder: input.observation.providerOrder,
    providerRevisionId: input.observation.providerRevisionId,
    sourceTimestamp: input.observation.sourceTimestamp,
    contentHash,
    tombstone: input.observation.tombstone,
  })}`;
  return {
    sourceKey,
    sourceUnitKey: `sunit_${digest([sourceKey, input.observation.threadKey])}`,
    observationKey,
    sourceRevisionKey,
    assemblyJobKey: `sjob_${digest([sourceRevisionKey, input.routing.effectKey])}`,
    contentHash,
  } as const;
};

export const assertValidSourceLedgerCapture = (
  input: typeof SourceLedgerCaptureInput.Type,
  options: CaptureValidationOptions = {},
) => {
  let decoded: typeof SourceLedgerCaptureInput.Type;
  try {
    decoded = Schema.decodeUnknownSync(SourceLedgerCaptureInput)(input);
  } catch {
    if (!input.envelope?.organizationKey)
      throw new TenantMismatch("TenantMismatch");
    if (input.observation?.providerObjectId?.includes("/"))
      throw new DuplicateKeyConflict("DuplicateKeyConflict");
    if (input.observation?.text && input.observation.text.length > 32_000)
      throw new PayloadTooLarge("PayloadTooLarge");
    throw new ObservationInvalid("ObservationInvalid");
  }
  let binding: typeof VerifiedSlackChannelBinding.Type;
  try {
    binding = assertVerifiedSlackEnvelope(options.verifiedBinding);
  } catch {
    throw new ChannelAccessLost("ChannelAccessLost");
  }
  assertBindingMatchesEnvelope(binding, decoded.envelope);
  if (decoded.observation.providerObjectId.includes("/"))
    throw new DuplicateKeyConflict("DuplicateKeyConflict");
  const keys = sourceLedgerKeysFor(decoded);
  const knownObservationDuplicate =
    options.existingObservationKey === keys.observationKey;
  if (
    options.existingObservationKey &&
    options.existingObservationKey !== keys.observationKey
  )
    throw new DuplicateKeyConflict("DuplicateKeyConflict");
  if (options.existingArtifact && !knownObservationDuplicate) {
    if (options.existingArtifact.sourceKey !== keys.sourceKey)
      throw new DuplicateKeyConflict("DuplicateKeyConflict");
    const nextPrimary = providerPrimarySortKeyFor(decoded);
    const currentPrimary = options.existingArtifact.latestProviderOrder
      .split("|")
      .slice(0, 2)
      .join("|");
    if (
      nextPrimary < currentPrimary ||
      (nextPrimary === currentPrimary &&
        providerSortKeyFor(decoded) >=
          options.existingArtifact.latestProviderOrder)
    )
      throw new DuplicateKeyConflict("DuplicateKeyConflict");
  }
  const deliveryKey = `delivery_${digest([decoded.envelope.organizationKey, decoded.envelope.connectionKey, decoded.envelope.connectionGeneration, decoded.envelope.transport, decoded.envelope.transportDeliveryId])}`;
  const deliveryFingerprint = digest({
    envelope: {
      channelKey: decoded.envelope.channelKey,
      externalChannelId: decoded.envelope.externalChannelId,
      transport: decoded.envelope.transport,
      transportDeliveryId: decoded.envelope.transportDeliveryId,
    },
    observation: {
      providerObjectId: decoded.observation.providerObjectId,
      threadKey: decoded.observation.threadKey,
      sourceTimestamp: decoded.observation.sourceTimestamp,
      providerOrder: decoded.observation.providerOrder,
      providerRevisionId: decoded.observation.providerRevisionId,
      author: decoded.observation.author,
      text: decoded.observation.text,
      blocksJson: decoded.observation.blocksJson,
      permalink: decoded.observation.permalink,
      tombstone: decoded.observation.tombstone,
      revisionNonce: decoded.observation.revisionNonce,
    },
    sourceKey: keys.sourceKey,
    observationKey: keys.observationKey,
    sourceRevisionKey: keys.sourceRevisionKey,
    contentHash: keys.contentHash,
  });
  const deliveryObservationKey = `${deliveryKey}:${deliveryFingerprint}`;
  if (options.seenTransportDeliveries?.has(deliveryKey)) {
    if (!options.seenTransportDeliveries.has(deliveryObservationKey))
      throw new DuplicateKeyConflict("DuplicateKeyConflict");
    return { outcome: "duplicate" as const, ...keys };
  }
  options.seenTransportDeliveries?.add(deliveryKey);
  options.seenTransportDeliveries?.add(deliveryObservationKey);
  const outcome = knownObservationDuplicate
    ? ("duplicate" as const)
    : decoded.observation.tombstone
      ? ("tombstone" as const)
      : ("inserted" as const);
  return { outcome, ...keys };
};

const providerPrimarySortKeyFor = (
  input: typeof SourceLedgerCaptureInput.Type,
) =>
  [
    input.observation.sourceTimestamp,
    input.observation.providerRevisionId,
  ].join("|");
const providerSortKeyFor = (input: typeof SourceLedgerCaptureInput.Type) =>
  [
    providerPrimarySortKeyFor(input),
    input.envelope.organizationKey,
    input.envelope.connectionKey,
    String(input.envelope.connectionGeneration),
    input.envelope.transport,
    input.envelope.transportDeliveryId,
  ].join("|");
export const buildSourceLedgerRows = (
  input: typeof SourceLedgerCaptureInput.Type,
  options: CaptureValidationOptions,
) => {
  const validationOptions: MutablePartial<CaptureValidationOptions> = {};
  if (options.existingObservationKey)
    validationOptions.existingObservationKey = options.existingObservationKey;
  if (options.existingArtifact)
    validationOptions.existingArtifact = options.existingArtifact;
  if (options.seenTransportDeliveries)
    validationOptions.seenTransportDeliveries = new Set(
      options.seenTransportDeliveries,
    );
  if (options.verifiedBinding)
    validationOptions.verifiedBinding = options.verifiedBinding;
  const verifiedBinding = assertVerifiedSlackEnvelope(options.verifiedBinding);
  const result = assertValidSourceLedgerCapture(input, validationOptions);
  const keys = result;
  const signatureVerification = verifiedBinding.signatureVerification;
  const replayVerification = verifiedBinding.replayVerification;
  const receipt = {
    schemaVersion: 1 as const,
    organizationKey: input.envelope.organizationKey,
    connectionKey: input.envelope.connectionKey,
    connectionGeneration: input.envelope.connectionGeneration,
    channelKey: input.envelope.channelKey,
    externalChannelId: input.envelope.externalChannelId,
