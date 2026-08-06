import { createHash } from "node:crypto";

import * as Schema from "effect/Schema";

const IsoTimestamp = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
);
const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);

export const CanonicalParticipant = Schema.Struct({
  externalParticipantId: Schema.String,
  displayName: Schema.String,
  email: Schema.NullOr(Schema.String),
  domain: Schema.NullOr(Schema.String),
});
export type CanonicalParticipant = typeof CanonicalParticipant.Type;

export const CanonicalTranscriptSegment = Schema.Struct({
  externalSegmentId: Schema.String,
  ordinal: NonNegativeInteger,
  evidenceKind: Schema.Literal("verbatim_transcript", "provider_notes"),
  speakerExternalId: Schema.NullOr(Schema.String),
  speakerLabel: Schema.String,
  startMs: Schema.NullOr(NonNegativeInteger),
  endMs: Schema.NullOr(NonNegativeInteger),
  text: Schema.String,
});
export type CanonicalTranscriptSegment = typeof CanonicalTranscriptSegment.Type;

export const CanonicalCallTranscript = Schema.Struct({
  providerKey: Schema.String,
  connectionKey: Schema.String,
  externalCallId: Schema.String,
  externalRevisionId: Schema.String,
  title: Schema.String,
  startedAt: IsoTimestamp,
  endedAt: Schema.NullOr(IsoTimestamp),
  durationMs: Schema.NullOr(NonNegativeInteger),
  organizer: Schema.NullOr(CanonicalParticipant),
  participants: Schema.Array(CanonicalParticipant),
  segments: Schema.Array(CanonicalTranscriptSegment),
  sourceUrl: Schema.String,
  recordingUrl: Schema.NullOr(Schema.String),
  providerSummary: Schema.NullOr(Schema.String),
  providerMetadataJson: Schema.String,
  deleted: Schema.Boolean,
});
export type CanonicalCallTranscript = typeof CanonicalCallTranscript.Type;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

export const canonicalTranscriptRevision = (
  value: Omit<CanonicalCallTranscript, "externalRevisionId">,
): string => {
  const providerRevision = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "connectionKey"),
  );
  return `sha256:${createHash("sha256")
    .update(stableJson(providerRevision))
    .digest("hex")}`;
};
