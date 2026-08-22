import {
  canonicalTranscriptRevision,
  providerTimestampRevisionOrder,
  type CanonicalCallTranscript,
  type CanonicalParticipant,
} from "./canonical";

type JsonObject = Record<string, unknown>;

export class FathomDecodeError extends Error {
  readonly _tag = "FathomDecodeError";
  constructor(
    readonly reason: "invalid_page" | "invalid_call" | "invalid_transcript",
  ) {
    super("Fathom transcript could not be decoded");
  }
}

const object = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const callId = (value: unknown): string | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : /^\d+$/.test(string(value) ?? "")
      ? string(value)
      : null;
const deleted = (record: JsonObject): boolean => {
  const metadata = object(record._nango_metadata);
  return (
    record.deleted === true ||
    Boolean(string(metadata?.deleted_at)) ||
    metadata?.last_action === "DELETED"
  );
};
const timestamp = (value: unknown): number | null => {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(string(value) ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return minutes < 60 && seconds < 60
    ? ((hours * 60 + minutes) * 60 + seconds) * 1000
    : null;
};
const participant = (value: unknown): CanonicalParticipant | null => {
  const record = object(value);
  if (!record) return null;
  const email = string(record.email)?.toLowerCase() ?? null;
  const displayName = string(record.name) ?? email;
  if (!displayName) return null;
  return {
    externalParticipantId: email ?? displayName,
    displayName,
    email,
    domain:
      string(record.email_domain)?.toLowerCase() ??
      (email?.includes("@") ? (email.split("@").at(-1) ?? null) : null),
  };
};

export const fathomMeetingsEndpoint = (cursor: string | null): string => {
  const query = new URLSearchParams({ limit: "100", include_summary: "true" });
  if (cursor) query.set("cursor", cursor);
  return `/external/v1/meetings?${query}`;
};

export const decodeFathomMeetingPage = (value: unknown) => {
  const page = object(value);
  if (!page || !Array.isArray(page.items))
    throw new FathomDecodeError("invalid_page");
  const nextCursor =
    page.next_cursor === null ? null : string(page.next_cursor);
  if (page.next_cursor !== null && nextCursor === null)
    throw new FathomDecodeError("invalid_page");
  return { records: page.items as readonly JsonObject[], nextCursor };
};

export const normalizeFathomCall = (input: {
  readonly connectionKey: string;
  readonly meeting: unknown;
  readonly transcript: unknown;
}): CanonicalCallTranscript => {
  const meeting = object(input.meeting);
  const externalCallId = callId(meeting?.recording_id);
  const startedMs = Date.parse(
    string(meeting?.recording_start_time) ??
      string(meeting?.scheduled_start_time) ??
      string(meeting?.created_at) ??
      "",
  );
  if (!meeting || !externalCallId || !Number.isFinite(startedMs))
    throw new FathomDecodeError("invalid_call");

  const isDeleted = deleted(meeting);
  const transcript = object(input.transcript);
  const items = transcript?.transcript;
  if (!isDeleted && !Array.isArray(items))
    throw new FathomDecodeError("invalid_transcript");

  const organizer = participant(meeting.recorded_by);
  const participants = [
    ...(organizer ? [organizer] : []),
    ...(Array.isArray(meeting.calendar_invitees)
      ? meeting.calendar_invitees.flatMap((value) => {
          const normalized = participant(value);
          return normalized ? [normalized] : [];
        })
      : []),
  ].filter(
    (candidate, index, all) =>
      all.findIndex(
        ({ externalParticipantId }) =>
          externalParticipantId === candidate.externalParticipantId,
      ) === index,
  );
  const endedMs = Date.parse(string(meeting.recording_end_time) ?? "");
  const metadata = object(meeting._nango_metadata);
  const revisionOrder = isDeleted
    ? providerTimestampRevisionOrder(
        "_nango_metadata.deleted_at",
        metadata?.deleted_at,
      )
    : (providerTimestampRevisionOrder("updated_at", meeting.updated_at) ??
      providerTimestampRevisionOrder(
        "recording_end_time",
        meeting.recording_end_time,
      ) ??
      providerTimestampRevisionOrder("created_at", meeting.created_at));
  if (revisionOrder === null) throw new FathomDecodeError("invalid_call");
  const summary = object(meeting.default_summary);
  const segments = isDeleted
    ? []
    : (items as readonly unknown[]).flatMap((value, sourceOrdinal) => {
        const item = object(value);
        const speaker = object(item?.speaker);
        const text = string(item?.text);
        const startMs = timestamp(item?.timestamp);
        if (!item || !speaker || !text || startMs === null)
          throw new FathomDecodeError("invalid_transcript");
        const email = string(
          speaker.matched_calendar_invitee_email,
        )?.toLowerCase();
        const label =
          string(speaker.display_name) ?? email ?? "Unknown speaker";
        return [
          {
            externalSegmentId: `${externalCallId}:${sourceOrdinal}`,
            ordinal: sourceOrdinal,
            evidenceKind: "verbatim_transcript" as const,
            speakerExternalId: email ?? label,
            speakerLabel: label,
            startMs,
            endMs: null,
            text,
          },
        ];
      });
  const call = {
    providerKey: "fathom",
    connectionKey: input.connectionKey,
    externalCallId,
    revisionOrder,
    title:
      string(meeting.title) ??
      string(meeting.meeting_title) ??
      "Untitled Fathom call",
    startedAt: new Date(startedMs).toISOString(),
    endedAt: Number.isFinite(endedMs) ? new Date(endedMs).toISOString() : null,
    durationMs:
      Number.isFinite(endedMs) && endedMs >= startedMs
        ? endedMs - startedMs
        : null,
    organizer,
    participants,
    segments,
    sourceUrl: string(meeting.share_url) ?? string(meeting.url) ?? "",
    recordingUrl: null,
    providerSummary: string(summary?.markdown_formatted),
    providerMetadataJson: JSON.stringify({
      meetingType: string(meeting.meeting_type),
      transcriptLanguage: string(meeting.transcript_language),
    }),
    deleted: isDeleted,
  } satisfies Omit<CanonicalCallTranscript, "externalRevisionId">;
  return { ...call, externalRevisionId: canonicalTranscriptRevision(call) };
};
