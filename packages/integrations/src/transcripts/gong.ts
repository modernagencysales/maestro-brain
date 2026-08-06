import {
  canonicalTranscriptRevision,
  type CanonicalCallTranscript,
  type CanonicalParticipant,
} from "./canonical";

type JsonObject = Record<string, unknown>;

export class GongDecodeError extends Error {
  readonly _tag = "GongDecodeError";
  constructor(readonly reason: "invalid_call" | "invalid_transcript") {
    super("Gong call could not be decoded");
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
const nonNegativeMs = (value: unknown): number | null => {
  const parsed = number(value);
  return parsed === null || parsed < 0 ? null : Math.round(parsed);
};
const deleted = (record: JsonObject): boolean => {
  const metadata = object(record._nango_metadata);
  return (
    Boolean(string(metadata?.deleted_at)) || metadata?.last_action === "DELETED"
  );
};
const participant = (party: JsonObject): CanonicalParticipant | null => {
  const externalParticipantId =
    string(party.id) ?? string(party.userId) ?? string(party.speakerId);
  if (!externalParticipantId) return null;
  const email = string(party.emailAddress)?.toLowerCase() ?? null;
  return {
    externalParticipantId,
    displayName: string(party.name) ?? email ?? externalParticipantId,
    email,
    domain: email?.includes("@") ? (email.split("@").at(-1) ?? null) : null,
  };
};

export const normalizeGongCall = (input: {
  readonly connectionKey: string;
  readonly call: unknown;
  readonly transcript: unknown;
}): CanonicalCallTranscript => {
  const callRecord = object(input.call);
  const transcriptRecord = object(input.transcript);
  const externalCallId = string(callRecord?.id);
  const transcriptCallId = string(transcriptRecord?.callId);
  const startedMs = Date.parse(string(callRecord?.started) ?? "");
  if (!callRecord || !externalCallId || !Number.isFinite(startedMs)) {
    throw new GongDecodeError("invalid_call");
  }
  if (
    !transcriptRecord ||
    transcriptCallId !== externalCallId ||
    !Array.isArray(transcriptRecord.transcript)
  ) {
    throw new GongDecodeError("invalid_transcript");
  }

  const durationSeconds = number(callRecord.duration);
  const durationMs =
    durationSeconds === null || durationSeconds < 0
      ? null
      : Math.round(durationSeconds * 1000);
  const parties = Array.isArray(callRecord.parties)
    ? callRecord.parties.flatMap((value) => {
        const record = object(value);
        return record ? [record] : [];
      })
    : [];
  const participants = parties.flatMap((party) => {
    const normalized = participant(party);
    return normalized ? [normalized] : [];
  });
  const primaryUserId = string(callRecord.primaryUserId);
  const organizerParty = parties.find(
    (party) => string(party.userId) === primaryUserId,
  );
  const mediaUrls = object(callRecord.mediaUrls);
  const isDeleted = deleted(callRecord) || deleted(transcriptRecord);
  const transcriptId = string(transcriptRecord.id) ?? externalCallId;

  const segments = isDeleted
    ? []
    : transcriptRecord.transcript
        .flatMap((monologueValue, monologueIndex) => {
          const monologue = object(monologueValue);
          if (!monologue || !Array.isArray(monologue.sentences)) {
            throw new GongDecodeError("invalid_transcript");
          }
          const speakerExternalId =
            string(monologue.speakerId) ??
            (typeof monologue.speakerId === "number"
              ? String(monologue.speakerId)
              : null);
          const speakerParty = parties.find(
            (party) => string(party.speakerId) === speakerExternalId,
          );
          return monologue.sentences.flatMap((sentenceValue, sentenceIndex) => {
            const sentence = object(sentenceValue);
            if (!sentence) throw new GongDecodeError("invalid_transcript");
            const text = string(sentence.text);
            if (!text) return [];
            return [
              {
                externalSegmentId: `${transcriptId}:${monologueIndex}:${sentenceIndex}`,
                sourceOrdinal: monologueIndex * 1_000_000 + sentenceIndex,
                evidenceKind: "verbatim_transcript" as const,
                speakerExternalId,
                speakerLabel:
                  string(speakerParty?.name) ??
                  speakerExternalId ??
                  "Unknown speaker",
                startMs: nonNegativeMs(sentence.start),
                endMs: nonNegativeMs(sentence.end),
                text,
              },
            ];
          });
        })
        .sort(
          (left, right) =>
            (left.startMs ?? Number.MAX_SAFE_INTEGER) -
              (right.startMs ?? Number.MAX_SAFE_INTEGER) ||
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

  const normalized = {
    providerKey: "gong",
    connectionKey: input.connectionKey,
    externalCallId,
    title: string(callRecord.title) ?? "Untitled Gong call",
    startedAt: new Date(startedMs).toISOString(),
    endedAt:
      durationMs === null
        ? null
        : new Date(startedMs + durationMs).toISOString(),
    durationMs,
    organizer: organizerParty ? participant(organizerParty) : null,
    participants,
    segments,
    sourceUrl: string(callRecord.url) ?? "",
    recordingUrl: string(mediaUrls?.audioUrl),
    providerSummary: null,
    providerMetadataJson: JSON.stringify({
      primaryUserId,
      scheduled: string(callRecord.scheduled),
      videoUrl: string(mediaUrls?.videoUrl),
    }),
    deleted: isDeleted,
  } satisfies Omit<CanonicalCallTranscript, "externalRevisionId">;

  return {
    ...normalized,
    externalRevisionId: canonicalTranscriptRevision(normalized),
  };
};
