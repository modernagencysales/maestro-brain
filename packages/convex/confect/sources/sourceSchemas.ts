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
const ReceiptSuccessOutcome = Schema.Literal(
  "inserted",
  "duplicate",
  "tombstone",
);
const ReceiptNoSourceOutcome = Schema.Literal("ignored_bot_output", "rejected");
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
    reason: Schema.String.pipe(Schema.maxLength(160)),
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
  verifiedSlackEnvelope: Schema.Literal(true),
  organizationKey: StableKey,
  connectionKey: StableKey,
  connectionGeneration: PositiveInteger,
  teamId: StableKey,
  appId: StableKey,
  botUserId: StableKey,
  channelKey: StableKey,
  externalChannelId: StableKey,
});

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

type MutablePartial<T> = { -readonly [K in keyof T]?: T[K] };

type CaptureValidationOptions = {
  readonly seenTransportDeliveries?: Set<string>;
  readonly existingObservationKey?: string;
  readonly existingArtifact?: {
    readonly sourceKey: string;
    readonly latestProviderOrder: string;
    readonly lifecycleGeneration: number;
  };
  readonly verifiedBinding?: typeof VerifiedSlackChannelBinding.Type;
};

export class TenantMismatch extends Error {
  readonly _tag = "TenantMismatch";
}
export class ChannelAccessLost extends Error {
  readonly _tag = "ChannelAccessLost";
}
export class ObservationInvalid extends Error {
  readonly _tag = "ObservationInvalid";
}
export class PayloadTooLarge extends Error {
  readonly _tag = "PayloadTooLarge";
}
export class DuplicateKeyConflict extends Error {
  readonly _tag = "DuplicateKeyConflict";
}

const digest = (value: unknown) => sha256Hex(JSON.stringify(value));

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
    binding = Schema.decodeUnknownSync(VerifiedSlackChannelBinding)(
      options.verifiedBinding,
    );
  } catch {
    throw new ChannelAccessLost("ChannelAccessLost");
  }
  if (
    binding.organizationKey !== decoded.envelope.organizationKey ||
    binding.connectionKey !== decoded.envelope.connectionKey ||
    binding.connectionGeneration !== decoded.envelope.connectionGeneration
  )
    throw new TenantMismatch("TenantMismatch");
  if (
    binding.teamId !== decoded.envelope.teamId ||
    binding.appId !== decoded.envelope.appId ||
    binding.botUserId !== decoded.envelope.botUserId ||
    binding.channelKey !== decoded.envelope.channelKey ||
    binding.externalChannelId !== decoded.envelope.externalChannelId
  )
    throw new ChannelAccessLost("ChannelAccessLost");
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
    if (
      providerSortKeyFor(decoded) <=
      options.existingArtifact.latestProviderOrder
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

const providerSortKeyFor = (input: typeof SourceLedgerCaptureInput.Type) =>
  [
    input.observation.sourceTimestamp,
    input.observation.providerRevisionId,
    digest({
      organizationKey: input.envelope.organizationKey,
      connectionKey: input.envelope.connectionKey,
      connectionGeneration: input.envelope.connectionGeneration,
      transport: input.envelope.transport,
      transportDeliveryId: input.envelope.transportDeliveryId,
    }),
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
  const result = assertValidSourceLedgerCapture(input, validationOptions);
  const keys = result;
  const signatureVerification = {
    status: "verified" as const,
    receiptHash: `sha256:${digest({ organizationKey: input.envelope.organizationKey, connectionKey: input.envelope.connectionKey, transportDeliveryId: input.envelope.transportDeliveryId, verified: true })}`,
  };
  const replayVerification = {
    status: "accepted" as const,
    receiptHash: `sha256:${digest({ transport: input.envelope.transport, transportDeliveryId: input.envelope.transportDeliveryId, sourceRevisionKey: keys.sourceRevisionKey })}`,
  };
  const receipt = {
    schemaVersion: 1 as const,
    organizationKey: input.envelope.organizationKey,
    connectionKey: input.envelope.connectionKey,
    connectionGeneration: input.envelope.connectionGeneration,
    channelKey: input.envelope.channelKey,
    externalChannelId: input.envelope.externalChannelId,
    transport: input.envelope.transport,
    transportDeliveryId: input.envelope.transportDeliveryId,
    providerEventId: input.envelope.transportDeliveryId,
    providerObjectId: input.observation.providerObjectId,
    providerRevisionId: input.observation.providerRevisionId,
    providerOrder: input.observation.providerOrder,
    canonicalContentHash: keys.contentHash,
    tombstone: input.observation.tombstone,
    signatureVerification,
    replayVerification,
    observationKey: keys.observationKey,
    sourceKey: keys.sourceKey,
    sourceRevisionKey: keys.sourceRevisionKey,
    outcome: result.outcome,
    receivedAt: input.envelope.receivedAt,
    createdAt: input.envelope.receivedAt,
  };
  if (result.outcome === "duplicate")
    return { receipt, artifact: null, revision: null, processingJob: null };
  const lifecycleValue = {
    state: input.observation.tombstone
      ? ("deleted_tombstone" as const)
      : ("active" as const),
    generation: (options.existingArtifact?.lifecycleGeneration ?? 0) + 1,
    updatedAt: input.envelope.receivedAt,
    purgeAfter: null,
  };
  return {
    receipt,
    artifact: {
      schemaVersion: 1 as const,
      organizationKey: input.envelope.organizationKey,
      connectionKey: input.envelope.connectionKey,
      connectionGeneration: input.envelope.connectionGeneration,
      channelKey: input.envelope.channelKey,
      externalChannelId: input.envelope.externalChannelId,
      providerObjectId: input.observation.providerObjectId,
      sourceKey: keys.sourceKey,
      threadKey: input.observation.threadKey,
      latestSourceRevisionKey: keys.sourceRevisionKey,
      latestProviderOrder: providerSortKeyFor(input),
      lifecycle: lifecycleValue,
      createdAt: input.envelope.receivedAt,
      updatedAt: input.envelope.receivedAt,
    },
    revision: {
      schemaVersion: 1 as const,
      organizationKey: input.envelope.organizationKey,
      connectionKey: input.envelope.connectionKey,
      connectionGeneration: input.envelope.connectionGeneration,
      channelKey: input.envelope.channelKey,
      sourceKey: keys.sourceKey,
      sourceRevisionKey: keys.sourceRevisionKey,
      observationKey: keys.observationKey,
      providerOrder: input.observation.providerOrder,
      providerRevisionId: input.observation.providerRevisionId,
      sourceCreatedAt: input.envelope.receivedAt,
      sourceTimestamp: input.observation.sourceTimestamp,
      authorSnapshot: input.observation.author,
      normalizedText: input.observation.text,
      blocksJson: input.observation.blocksJson,
      permalink: input.observation.permalink,
      contentHash: keys.contentHash,
      tombstone: input.observation.tombstone,
      lifecycle: lifecycleValue,
      createdAt: input.envelope.receivedAt,
    },
    processingJob: {
      schemaVersion: 1 as const,
      organizationKey: input.envelope.organizationKey,
      sourceUnitKey: keys.sourceUnitKey,
      sourceRevisionKey: keys.sourceRevisionKey,
      stage: input.routing.assemblyStage,
      status: "pending" as const,
      effectKey: input.routing.effectKey,
      policyEpoch: input.routing.policyEpoch,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextRetryAt: input.envelope.receivedAt,
      attemptCount: 0,
      createdAt: input.envelope.receivedAt,
      updatedAt: input.envelope.receivedAt,
    },
  };
};
