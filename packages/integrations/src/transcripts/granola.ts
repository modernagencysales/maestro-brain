import {
  canonicalTranscriptRevision,
  providerTimestampRevisionOrder,
  type CanonicalCallTranscript,
  type CanonicalParticipant,
} from "./canonical";

type JsonObject = Record<string, unknown>;

export class GranolaDecodeError extends Error {
  readonly _tag = "GranolaDecodeError";
  constructor(
    readonly reason: "invalid_page" | "invalid_note" | "invalid_transcript",
  ) {
    super("Granola note could not be decoded");
  }
}

const object = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const deleted = (record: JsonObject): boolean => {
  const metadata = object(record._nango_metadata);
  return (
    record.deleted === true ||
    Boolean(string(metadata?.deleted_at)) ||
    metadata?.last_action === "DELETED"
  );
};
const participant = (value: unknown): CanonicalParticipant | null => {
  const record = object(value);
  const email = string(record?.email)?.toLowerCase() ?? null;
  const displayName = string(record?.name) ?? email;
  if (!displayName) return null;
  return {
    externalParticipantId: email ?? displayName,
    displayName,
    email,
    domain: email?.includes("@") ? (email.split("@").at(-1) ?? null) : null,
  };
};
const relativeMs = (value: unknown, startedMs: number): number | null => {
  const parsed = Date.parse(string(value) ?? "");
  return Number.isFinite(parsed) ? Math.max(0, parsed - startedMs) : null;
};

export const granolaNotesEndpoint = (cursor: string | null): string => {
  const query = new URLSearchParams({ page_size: "30" });
  if (cursor) query.set("cursor", cursor);
  return `/v1/notes?${query}`;
};

export const decodeGranolaNotePage = (value: unknown) => {
  const page = object(value);
  if (!page || !Array.isArray(page.notes) || typeof page.hasMore !== "boolean")
    throw new GranolaDecodeError("invalid_page");
  const cursor = page.cursor === null ? null : string(page.cursor);
  if (page.hasMore && cursor === null)
    throw new GranolaDecodeError("invalid_page");
  return {
    records: page.notes as readonly JsonObject[],
    nextCursor: page.hasMore ? cursor : null,
  };
};

export const normalizeGranolaNote = (input: {
  readonly connectionKey: string;
  readonly note: unknown;
}): CanonicalCallTranscript => {
  const note = object(input.note);
  const externalCallId = /^not_[a-zA-Z0-9]{14}$/.test(string(note?.id) ?? "")
    ? string(note?.id)
    : null;
  const calendar = object(note?.calendar_event);
  const startedMs = Date.parse(
    string(calendar?.scheduled_start_time) ?? string(note?.created_at) ?? "",
  );
  if (!note || !externalCallId || !Number.isFinite(startedMs))
    throw new GranolaDecodeError("invalid_note");

  const isDeleted = deleted(note);
  const transcript = note.transcript;
  if (!isDeleted && transcript !== null && !Array.isArray(transcript))
    throw new GranolaDecodeError("invalid_transcript");
  const owner = participant(note.owner);
  const attendees = Array.isArray(note.attendees)
    ? note.attendees.flatMap((value) => {
        const normalized = participant(value);
        return normalized ? [normalized] : [];
      })
    : [];
  const invitees = Array.isArray(calendar?.invitees)
    ? calendar.invitees.flatMap((value) => {
        const normalized = participant(value);
        return normalized ? [normalized] : [];
      })
    : [];
  const participants = [
    ...(owner ? [owner] : []),
    ...attendees,
    ...invitees,
  ].filter(
    (candidate, index, all) =>
      all.findIndex(
        ({ externalParticipantId }) =>
          externalParticipantId === candidate.externalParticipantId,
      ) === index,
  );
  const organizerEmail = string(calendar?.organiser)?.toLowerCase();
  const organizer =
    participants.find(({ email }) => email === organizerEmail) ?? owner;
  const summary = string(note.summary_markdown) ?? string(note.summary_text);
  const transcriptSegments =
    isDeleted || !Array.isArray(transcript)
      ? []
      : transcript.flatMap((value, sourceOrdinal) => {
          const item = object(value);
          const speaker = object(item?.speaker);
          const text = string(item?.text);
          if (!item || !speaker || !text)
            throw new GranolaDecodeError("invalid_transcript");
          const speakerLabel =
            string(speaker.name) ??
            string(speaker.diarization_label) ??
            string(speaker.attribution) ??
            string(speaker.source) ??
            "Unknown speaker";
          return [
            {
              externalSegmentId: `${externalCallId}:transcript:${sourceOrdinal}`,
              evidenceKind: "verbatim_transcript" as const,
              speakerExternalId:
                string(speaker.name) ??
                string(speaker.diarization_label) ??
                string(speaker.attribution) ??
                string(speaker.source),
              speakerLabel,
              startMs: relativeMs(item.start_time, startedMs),
              endMs: relativeMs(item.end_time, startedMs),
              text,
            },
          ];
        });
  const segments = isDeleted
    ? []
    : [
        ...(summary
          ? [
              {
                externalSegmentId: `${externalCallId}:notes`,
                evidenceKind: "provider_notes" as const,
                speakerExternalId: owner?.externalParticipantId ?? null,
                speakerLabel: owner?.displayName ?? "Granola notes",
                startMs: null,
                endMs: null,
                text: summary,
              },
            ]
          : []),
        ...transcriptSegments,
      ].map((segment, ordinal) => ({ ...segment, ordinal }));
  const endedMs = Date.parse(string(calendar?.scheduled_end_time) ?? "");
  const metadata = object(note._nango_metadata);
  const revisionOrder = isDeleted
    ? providerTimestampRevisionOrder(
        "_nango_metadata.deleted_at",
        metadata?.deleted_at,
      )
    : (providerTimestampRevisionOrder("updated_at", note.updated_at) ??
      providerTimestampRevisionOrder("created_at", note.created_at));
  if (revisionOrder === null) throw new GranolaDecodeError("invalid_note");
  const call = {
    providerKey: "granola",
    connectionKey: input.connectionKey,
    externalCallId,
    revisionOrder,
    title:
      string(note.title) ??
      string(calendar?.event_title) ??
      "Untitled Granola note",
    startedAt: new Date(startedMs).toISOString(),
    endedAt: Number.isFinite(endedMs) ? new Date(endedMs).toISOString() : null,
    durationMs:
      Number.isFinite(endedMs) && endedMs >= startedMs
        ? endedMs - startedMs
        : null,
    organizer: organizer ?? null,
    participants,
    segments,
    sourceUrl: string(note.web_url) ?? "",
    recordingUrl: null,
    providerSummary: summary,
    providerMetadataJson: JSON.stringify({
      calendarEventId: string(calendar?.calendar_event_id),
      updatedAt: string(note.updated_at),
    }),
    deleted: isDeleted,
  } satisfies Omit<CanonicalCallTranscript, "externalRevisionId">;
  return { ...call, externalRevisionId: canonicalTranscriptRevision(call) };
};
