import { CanonicalCallTranscript } from "@maestro-template/integrations/transcripts/canonical";
import * as Schema from "effect/Schema";

import { sha256Hex } from "../shared/sha256";

const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);
const PositiveInteger = Schema.Number.pipe(Schema.int(), Schema.greaterThan(0));
const Hash = Schema.String.pipe(Schema.pattern(/^sha256:[a-f0-9]{64}$/));
const UnitKey = Schema.String.pipe(Schema.pattern(/^sunit_[a-f0-9]{64}$/));
const UnitRevisionKey = Schema.String.pipe(
  Schema.pattern(/^surev_[a-f0-9]{64}$/),
);
const SegmentKey = Schema.String.pipe(Schema.pattern(/^seg_[a-f0-9]{64}$/));
const Lifecycle = Schema.Struct({
  state: Schema.Literal("active", "deleted_tombstone", "redacted", "purged"),
  generation: PositiveInteger,
  updatedAt: NonNegativeInteger,
  purgeAfter: Schema.NullOr(NonNegativeInteger),
});

export const SourceUnitAuthority = Schema.Struct({
  organizationKey: Schema.String,
  connectionGeneration: PositiveInteger,
  receivedAt: NonNegativeInteger,
});
export type SourceUnitAuthority = typeof SourceUnitAuthority.Type;

export const SourceUnitRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: PositiveInteger,
  providerKey: Schema.String,
  externalCallId: Schema.String,
  unitKey: UnitKey,
  currentUnitRevisionKey: UnitRevisionKey,
  lifecycle: Lifecycle,
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export const SourceUnitRevisionRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  unitKey: UnitKey,
  unitRevisionKey: UnitRevisionKey,
  externalRevisionId: Schema.String,
  title: Schema.String,
  startedAt: CanonicalCallTranscript.fields.startedAt,
  endedAt: CanonicalCallTranscript.fields.endedAt,
  durationMs: CanonicalCallTranscript.fields.durationMs,
  organizer: CanonicalCallTranscript.fields.organizer,
  participants: CanonicalCallTranscript.fields.participants,
  sourceUrl: Schema.String,
  recordingUrl: Schema.NullOr(Schema.String),
  providerSummary: Schema.NullOr(Schema.String),
  providerMetadataJson: Schema.String,
  contentHash: Hash,
  tombstone: Schema.Boolean,
  createdAt: NonNegativeInteger,
});

export const SourceSegmentRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  unitKey: UnitKey,
  unitRevisionKey: UnitRevisionKey,
  segmentKey: SegmentKey,
  externalSegmentId: Schema.String,
  ordinal: NonNegativeInteger,
  evidenceKind: Schema.Literal("verbatim_transcript", "provider_notes"),
  speakerExternalId: Schema.NullOr(Schema.String),
  speakerLabel: Schema.String,
  startMs: Schema.NullOr(NonNegativeInteger),
  endMs: Schema.NullOr(NonNegativeInteger),
  text: Schema.String.pipe(Schema.maxLength(32_000)),
  contentHash: Hash,
  createdAt: NonNegativeInteger,
});

const digest = (value: unknown) => sha256Hex(JSON.stringify(value));

export const buildCallSourceUnitRows = (
  rawInput: typeof CanonicalCallTranscript.Type,
  rawAuthority: SourceUnitAuthority,
) => {
  const authority = Schema.decodeUnknownSync(SourceUnitAuthority)(rawAuthority);
  const input = Schema.decodeUnknownSync(CanonicalCallTranscript)(rawInput);
  const segments = [...input.segments].sort(
    (left, right) =>
      left.ordinal - right.ordinal ||
      left.externalSegmentId.localeCompare(right.externalSegmentId),
  );
  const ordinals = new Set<number>();
  const externalIds = new Set<string>();
  for (const segment of segments) {
    if (
      ordinals.has(segment.ordinal) ||
      externalIds.has(segment.externalSegmentId)
    )
      throw new Error("duplicate transcript segment");
    if (segment.text.length > 32_000)
      throw new Error("segment exceeds 32000 characters");
    if (segment.text.length === 0) throw new Error("empty transcript segment");
    ordinals.add(segment.ordinal);
    externalIds.add(segment.externalSegmentId);
  }
  if (!input.deleted && segments.length === 0)
    throw new Error("empty transcript");
  try {
    JSON.parse(input.providerMetadataJson);
  } catch {
    throw new Error("invalid provider metadata JSON");
  }

  const unitKey = `sunit_${digest({
    organizationKey: authority.organizationKey,
    connectionKey: input.connectionKey,
    connectionGeneration: authority.connectionGeneration,
    providerKey: input.providerKey,
    externalCallId: input.externalCallId,
  })}`;
  const contentHash = `sha256:${digest({
    title: input.title,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: input.durationMs,
    organizer: input.organizer,
    participants: input.participants,
    segments,
    sourceUrl: input.sourceUrl,
    recordingUrl: input.recordingUrl,
    providerSummary: input.providerSummary,
    providerMetadataJson: input.providerMetadataJson,
  })}`;
  const unitRevisionKey = `surev_${digest({
    unitKey,
    externalRevisionId: input.externalRevisionId,
    contentHash,
    deleted: input.deleted,
  })}`;
  const lifecycle = {
    state: input.deleted ? ("deleted_tombstone" as const) : ("active" as const),
    generation: 1,
    updatedAt: authority.receivedAt,
    purgeAfter: null,
  };

  return {
    unit: {
      schemaVersion: 1 as const,
      organizationKey: authority.organizationKey,
      connectionKey: input.connectionKey,
      connectionGeneration: authority.connectionGeneration,
      providerKey: input.providerKey,
      externalCallId: input.externalCallId,
      unitKey,
      currentUnitRevisionKey: unitRevisionKey,
      lifecycle,
      createdAt: authority.receivedAt,
      updatedAt: authority.receivedAt,
    },
    revision: {
      schemaVersion: 1 as const,
      organizationKey: authority.organizationKey,
      unitKey,
      unitRevisionKey,
      externalRevisionId: input.externalRevisionId,
      title: input.title,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationMs: input.durationMs,
      organizer: input.organizer,
      participants: input.participants,
      sourceUrl: input.sourceUrl,
      recordingUrl: input.recordingUrl,
      providerSummary: input.providerSummary,
      providerMetadataJson: input.providerMetadataJson,
      contentHash,
      tombstone: input.deleted,
      createdAt: authority.receivedAt,
    },
    segments: segments.map((segment) => {
      const segmentContentHash = `sha256:${digest({
        evidenceKind: segment.evidenceKind,
        speakerExternalId: segment.speakerExternalId,
        speakerLabel: segment.speakerLabel,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
      })}`;
      return {
        schemaVersion: 1 as const,
        organizationKey: authority.organizationKey,
        unitKey,
        unitRevisionKey,
        segmentKey: `seg_${digest({
          unitRevisionKey,
          externalSegmentId: segment.externalSegmentId,
          ordinal: segment.ordinal,
          contentHash: segmentContentHash,
        })}`,
        externalSegmentId: segment.externalSegmentId,
        ordinal: segment.ordinal,
        evidenceKind: segment.evidenceKind,
        speakerExternalId: segment.speakerExternalId,
        speakerLabel: segment.speakerLabel,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        contentHash: segmentContentHash,
        createdAt: authority.receivedAt,
      };
    }),
  };
};
