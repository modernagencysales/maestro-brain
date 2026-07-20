import * as Schema from "effect/Schema";

import { sha256Hex } from "../shared/sha256";

const StableKey = Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_.:-]+$/));
const ProviderObjectId = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9_.:-]+$/),
);
const SourceKey = Schema.String.pipe(Schema.pattern(/^src_[A-Za-z0-9_.:-]+$/));
const RevisionKey = Schema.String.pipe(Schema.pattern(/^srev_[a-f0-9]{64}$/));
const IsoTimestamp = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
);
const Hash = Schema.String.pipe(Schema.pattern(/^sha256:[a-f0-9]{64}$/));
const Lifecycle = Schema.Struct({
  state: Schema.Literal("active", "deleted_tombstone", "redacted", "purged"),
  generation: Schema.Number,
  updatedAt: Schema.Number,
  purgeAfter: Schema.NullOr(Schema.Number),
});
const AuthorSnapshot = Schema.Struct({
  providerUserId: StableKey,
  displayName: Schema.String,
});

export const ProviderEventReceiptRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: StableKey,
  connectionKey: StableKey,
  connectionGeneration: Schema.Number,
  channelKey: StableKey,
  externalChannelId: StableKey,
  transportDeliveryId: StableKey,
  observationKey: StableKey,
  sourceKey: SourceKey,
  sourceRevisionKey: RevisionKey,
  outcome: Schema.Literal("inserted", "duplicate"),
  receivedAt: Schema.Number,
  createdAt: Schema.Number,
});
export type ProviderEventReceiptRowValue = typeof ProviderEventReceiptRow.Type;

export const SourceArtifactRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: StableKey,
  connectionKey: StableKey,
  connectionGeneration: Schema.Number,
  channelKey: StableKey,
  externalChannelId: StableKey,
  providerObjectId: StableKey,
  sourceKey: SourceKey,
  threadKey: StableKey,
  latestSourceRevisionKey: RevisionKey,
  latestProviderOrder: StableKey,
  lifecycle: Lifecycle,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type SourceArtifactRowValue = typeof SourceArtifactRow.Type;

export const SourceRevisionRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: StableKey,
  connectionKey: StableKey,
  connectionGeneration: Schema.Number,
  channelKey: StableKey,
  sourceKey: SourceKey,
  sourceRevisionKey: RevisionKey,
  observationKey: StableKey,
  providerOrder: StableKey,
  sourceCreatedAt: Schema.Number,
  sourceTimestamp: IsoTimestamp,
  authorSnapshot: AuthorSnapshot,
  normalizedText: Schema.String.pipe(Schema.maxLength(32_000)),
  blocksJson: Schema.String,
  permalink: Schema.String,
  contentHash: Hash,
  tombstone: Schema.Boolean,
  lifecycle: Lifecycle,
  createdAt: Schema.Number,
});
export type SourceRevisionRowValue = typeof SourceRevisionRow.Type;

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
  policyEpoch: Schema.Number,
  leaseOwner: Schema.NullOr(Schema.String),
  leaseExpiresAt: Schema.NullOr(Schema.Number),
  nextRetryAt: Schema.Number,
  attemptCount: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type SourceProcessingJobRowValue = typeof SourceProcessingJobRow.Type;

export const SourceLedgerCaptureInput = Schema.Struct({
  envelope: Schema.Struct({
    organizationKey: StableKey,
    connectionKey: StableKey,
    connectionGeneration: Schema.Number,
    teamId: StableKey,
    appId: StableKey,
    botUserId: StableKey,
    channelKey: StableKey,
    externalChannelId: StableKey,
    transportDeliveryId: StableKey,
    receivedAt: Schema.Number,
  }),
  observation: Schema.Struct({
    providerObjectId: ProviderObjectId,
    threadKey: StableKey,
    sourceTimestamp: IsoTimestamp,
    providerOrder: StableKey,
    author: AuthorSnapshot,
    text: Schema.String.pipe(Schema.maxLength(32_000)),
    blocksJson: Schema.String,
    permalink: Schema.String,
    tombstone: Schema.Boolean,
    revisionNonce: StableKey,
  }),
  routing: Schema.Struct({
    policyEpoch: Schema.Number,
    assemblyStage: Schema.Literal("assembly_pending"),
    effectKey: StableKey,
  }),
});
export type SourceLedgerCaptureInputValue =
  typeof SourceLedgerCaptureInput.Type;

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

const safeObjectId = (value: string) => value.replace(/[^A-Za-z0-9_:-]/g, "_");
const digest = (value: unknown) => sha256Hex(JSON.stringify(value));

export const sourceLedgerKeysFor = (input: SourceLedgerCaptureInputValue) => {
  const sourceKey = `src_${input.envelope.organizationKey}_${input.envelope.connectionKey}_g${input.envelope.connectionGeneration}_${input.envelope.channelKey}_${safeObjectId(input.observation.providerObjectId)}`;
  const observationKey = `obs_${digest({
    organizationKey: input.envelope.organizationKey,
    connectionKey: input.envelope.connectionKey,
    connectionGeneration: input.envelope.connectionGeneration,
    channelKey: input.envelope.channelKey,
    providerObjectId: input.observation.providerObjectId,
    revisionNonce: input.observation.revisionNonce,
  })}`;
  const contentHash = `sha256:${digest({
    text: input.observation.text,
    blocksJson: input.observation.blocksJson,
    tombstone: input.observation.tombstone,
  })}`;
  const sourceRevisionKey = `srev_${digest({
    sourceKey,
    providerOrder: input.observation.providerOrder,
    sourceTimestamp: input.observation.sourceTimestamp,
    contentHash,
    revisionNonce: input.observation.revisionNonce,
  })}`;
  return {
    sourceKey,
    sourceUnitKey: `sunit_${digest({ sourceKey, threadKey: input.observation.threadKey })}`,
    observationKey,
    sourceRevisionKey,
    assemblyJobKey: `sjob_${digest({ sourceRevisionKey, effectKey: input.routing.effectKey })}`,
    contentHash,
  } as const;
};

export const assertValidSourceLedgerCapture = (
  input: SourceLedgerCaptureInputValue,
  options: {
    readonly seenTransportDeliveries?: Set<string>;
    readonly existingObservationKey?: string;
  } = {},
) => {
  let decoded: SourceLedgerCaptureInputValue;
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
  if (!decoded.envelope.organizationKey)
    throw new TenantMismatch("TenantMismatch");
  if (
    !decoded.envelope.channelKey.endsWith(
      decoded.envelope.externalChannelId.replace(/^C_/, ""),
    )
  )
    throw new ChannelAccessLost("ChannelAccessLost");
  if (decoded.observation.providerObjectId.includes("/"))
    throw new DuplicateKeyConflict("DuplicateKeyConflict");
  const keys = sourceLedgerKeysFor(decoded);
  if (
    options.existingObservationKey &&
    options.existingObservationKey !== keys.observationKey
  )
    throw new DuplicateKeyConflict("DuplicateKeyConflict");
  const deliveryKey = `${decoded.envelope.organizationKey}:${decoded.envelope.connectionKey}:g${decoded.envelope.connectionGeneration}:${decoded.envelope.transportDeliveryId}`;
  if (options.seenTransportDeliveries?.has(deliveryKey))
    return { outcome: "duplicate" as const, ...keys };
  options.seenTransportDeliveries?.add(deliveryKey);
  return { outcome: "inserted" as const, ...keys };
};
