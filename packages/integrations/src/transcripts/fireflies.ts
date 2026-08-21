import {
  canonicalTranscriptRevision,
  providerTimestampRevisionOrder,
  type CanonicalCallTranscript,
  type CanonicalParticipant,
} from "./canonical";

type JsonObject = Record<string, unknown>;

export class FirefliesDecodeError extends Error {
  readonly _tag = "FirefliesDecodeError";
  constructor(readonly reason: "invalid_call" | "invalid_sentences") {
    super("Fireflies transcript could not be decoded");
  }
}

const object = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const secondsToMs = (value: unknown): number | null => {
  const parsed = number(value);
  return parsed === null || parsed < 0 ? null : Math.round(parsed * 1000);
};
const deleted = (record: JsonObject): boolean => {
  const metadata = object(record._nango_metadata);
  return (
    Boolean(string(metadata?.deleted_at)) || metadata?.last_action === "DELETED"
  );
};
const participant = (email: string): CanonicalParticipant => {
  const normalized = email.toLowerCase();
  const at = normalized.lastIndexOf("@");
  return {
    externalParticipantId: normalized,
    displayName: email,
    email: normalized,
    domain: at < 0 ? null : normalized.slice(at + 1),
  };
};

export const normalizeFirefliesCall = (input: {
  readonly connectionKey: string;
  readonly transcript: unknown;
  readonly sentences: unknown;
}): CanonicalCallTranscript => {
  const transcript = object(input.transcript);
  const externalCallId = string(transcript?.id);
  const startedValue = transcript?.date;
  const startedMs =
    typeof startedValue === "number"
      ? startedValue >= 1_000_000_000_000
        ? startedValue
        : startedValue * 1000
      : Date.parse(string(startedValue) ?? "");
  if (!transcript || !externalCallId || !Number.isFinite(startedMs)) {
    throw new FirefliesDecodeError("invalid_call");
  }
  if (!Array.isArray(input.sentences)) {
    throw new FirefliesDecodeError("invalid_sentences");
  }

  const durationMs = secondsToMs(transcript.duration);
  const isDeleted = deleted(transcript);
  const metadata = object(transcript._nango_metadata);
  const revisionOrder = isDeleted
    ? providerTimestampRevisionOrder(
        "_nango_metadata.deleted_at",
        metadata?.deleted_at,
      )
    : (providerTimestampRevisionOrder("updated_at", transcript.updated_at) ??
      providerTimestampRevisionOrder("date", transcript.date));
  if (revisionOrder === null) throw new FirefliesDecodeError("invalid_call");
  const emails = Array.isArray(transcript.participants)
    ? transcript.participants.flatMap((value) => {
        const email = string(value);
        return email ? [email] : [];
      })
    : [];
  const organizerEmail =
    string(transcript.organizer_email) ?? string(transcript.host_email);
  if (organizerEmail && !emails.includes(organizerEmail))
    emails.push(organizerEmail);
  const participants = [
    ...new Set(emails.map((email) => email.toLowerCase())),
  ].map(participant);
  const summary = object(transcript.summary);

  const segments = isDeleted
    ? []
    : input.sentences
        .map((value, sourceOrdinal) => ({
          record: object(value),
          sourceOrdinal,
        }))
        .flatMap(({ record, sourceOrdinal }) => {
          if (!record) throw new FirefliesDecodeError("invalid_sentences");
          const transcriptId = string(record.transcript_id);
          if (transcriptId && transcriptId !== externalCallId) {
            throw new FirefliesDecodeError("invalid_sentences");
          }
          const text = string(record.text) ?? string(record.raw_text);
          if (!text) return [];
          const speakerIdValue = record.speaker_id;
          const speakerExternalId =
            typeof speakerIdValue === "string" ||
            typeof speakerIdValue === "number"
              ? String(speakerIdValue)
              : null;
          return [
            {
              externalSegmentId:
                string(record.id) ?? `${externalCallId}:${sourceOrdinal}`,
              sourceOrdinal,
              providerOrdinal: number(record.index) ?? sourceOrdinal,
              evidenceKind: "verbatim_transcript" as const,
              speakerExternalId,
              speakerLabel:
                string(record.speaker_name) ??
                speakerExternalId ??
                "Unknown speaker",
              startMs: secondsToMs(record.start_time),
              endMs: secondsToMs(record.end_time),
              text,
            },
          ];
        })
        .sort(
          (left, right) =>
            left.providerOrdinal - right.providerOrdinal ||
            left.sourceOrdinal - right.sourceOrdinal,
        )
        .map((segment, ordinal) => ({
          externalSegmentId: segment.externalSegmentId,
          ordinal,
          evidenceKind: segment.evidenceKind,
          speakerExternalId: segment.speakerExternalId,
          speakerLabel: segment.speakerLabel,
          startMs: segment.startMs,
          endMs: segment.endMs,
          text: segment.text,
        }));

  const call = {
    providerKey: "fireflies",
    connectionKey: input.connectionKey,
    externalCallId,
    revisionOrder,
    title: string(transcript.title) ?? "Untitled Fireflies call",
    startedAt: new Date(startedMs).toISOString(),
    endedAt:
      durationMs === null
        ? null
        : new Date(startedMs + durationMs).toISOString(),
    durationMs,
    organizer: organizerEmail ? participant(organizerEmail) : null,
    participants,
    segments,
    sourceUrl: string(transcript.transcript_url) ?? "",
    recordingUrl: string(transcript.audio_url),
    providerSummary: string(summary?.short_summary),
    providerMetadataJson: JSON.stringify({
      firefliesUserCount: Array.isArray(transcript.fireflies_users)
        ? transcript.fireflies_users.length
        : 0,
    }),
    deleted: isDeleted,
  } satisfies Omit<CanonicalCallTranscript, "externalRevisionId">;

  return { ...call, externalRevisionId: canonicalTranscriptRevision(call) };
};
