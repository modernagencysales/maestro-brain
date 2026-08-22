import { sha256Hex } from "@maestro-template/template-core/sha256";

import {
  canonicalTranscriptRevision,
  type CanonicalCallTranscript,
  type CanonicalTranscriptSegment,
} from "./canonical";

export const MAX_TRANSCRIPT_IMPORT_BYTES = 500_000;

export type TranscriptImportFormat =
  "json" | "vtt" | "srt" | "txt" | "markdown";

export class TranscriptImportError extends Error {
  readonly _tag = "TranscriptImportError";
  constructor(
    readonly reason:
      | "unsupported_format"
      | "payload_too_large"
      | "invalid_json"
      | "invalid_cue"
      | "invalid_metadata"
      | "empty",
  ) {
    super("Transcript import could not be decoded");
  }
}

type ImportInput = {
  readonly connectionKey: string;
  readonly title: string;
  readonly occurredAt: string;
  readonly participantEmails: readonly string[];
  readonly format: TranscriptImportFormat;
  readonly content: string;
};

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const milliseconds = (value: unknown): number | null =>
  value === null || value === undefined
    ? null
    : typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : null;
const timestampMs = (value: string): number | null => {
  const match = /^(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  return minutes < 60 && seconds < 60
    ? ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis
    : null;
};

const parseCues = (
  format: "vtt" | "srt",
  content: string,
): CanonicalTranscriptSegment[] => {
  const blocks = content
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !(format === "vtt" && /^(WEBVTT|NOTE\b)/.test(block)));
  const segments = blocks.flatMap((block, ordinal) => {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    const timing = lines[timingIndex];
    if (!timing) throw new TranscriptImportError("invalid_cue");
    const [startValue, endValueWithSettings] = timing.split("-->");
    const startMs = timestampMs(startValue?.trim() ?? "");
    const endMs = timestampMs(
      endValueWithSettings?.trim().split(/\s+/)[0] ?? "",
    );
    const text = lines
      .slice(timingIndex + 1)
      .join("\n")
      .trim();
    if (startMs === null || endMs === null || !text)
      throw new TranscriptImportError("invalid_cue");
    const cueId = lines.slice(0, timingIndex).join(" ").trim() || "cue";
    return [
      {
        externalSegmentId: `${cueId}:${ordinal}`,
        ordinal,
        evidenceKind: "verbatim_transcript" as const,
        speakerExternalId: null,
        speakerLabel: "Unknown speaker",
        startMs,
        endMs,
        text,
      },
    ];
  });
  if (segments.length === 0) throw new TranscriptImportError("empty");
  return segments;
};

const parseJson = (content: string): CanonicalTranscriptSegment[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new TranscriptImportError("invalid_json");
  }
  const root = object(parsed);
  if (!root || !Array.isArray(root.segments))
    throw new TranscriptImportError("invalid_json");
  const segments = root.segments.map((value, ordinal) => {
    const segment = object(value);
    const text = string(segment?.text);
    if (!segment || !text) throw new TranscriptImportError("invalid_json");
    const startMs = milliseconds(segment.startMs);
    const endMs = milliseconds(segment.endMs);
    if (
      (segment.startMs !== null &&
        segment.startMs !== undefined &&
        startMs === null) ||
      (segment.endMs !== null && segment.endMs !== undefined && endMs === null)
    )
      throw new TranscriptImportError("invalid_json");
    return {
      externalSegmentId:
        string(segment.externalSegmentId) ?? `segment:${ordinal}`,
      ordinal,
      evidenceKind: "verbatim_transcript" as const,
      speakerExternalId: string(segment.speakerExternalId),
      speakerLabel: string(segment.speakerLabel) ?? "Unknown speaker",
      startMs,
      endMs,
      text,
    };
  });
  if (segments.length === 0) throw new TranscriptImportError("empty");
  return segments;
};

export const parseTranscriptImport = (
  input: ImportInput,
): CanonicalCallTranscript => {
  if (!["json", "vtt", "srt", "txt", "markdown"].includes(input.format))
    throw new TranscriptImportError("unsupported_format");
  if (
    new TextEncoder().encode(input.content).byteLength >
    MAX_TRANSCRIPT_IMPORT_BYTES
  )
    throw new TranscriptImportError("payload_too_large");
  const title = string(input.title);
  const startedMs = Date.parse(input.occurredAt);
  const emails = [
    ...new Set(
      input.participantEmails.map((email) => email.trim().toLowerCase()),
    ),
  ];
  if (
    !title ||
    !Number.isFinite(startedMs) ||
    emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw new TranscriptImportError("invalid_metadata");
  const content = input.content.trim();
  if (!content) throw new TranscriptImportError("empty");
  const segments =
    input.format === "json"
      ? parseJson(content)
      : input.format === "vtt" || input.format === "srt"
        ? parseCues(input.format, content)
        : [
            {
              externalSegmentId: "text:0",
              ordinal: 0,
              evidenceKind: "verbatim_transcript" as const,
              speakerExternalId: null,
              speakerLabel: "Unknown speaker",
              startMs: null,
              endMs: null,
              text: content,
            },
          ];
  const externalCallId = `manual-${sha256Hex(
    JSON.stringify({
      title,
      occurredAt: new Date(startedMs).toISOString(),
      emails,
      format: input.format,
      content,
    }),
  )}`;
  const call = {
    providerKey: "manual-transcript",
    connectionKey: input.connectionKey,
    externalCallId,
    revisionOrder: {
      kind: "reconciliation_epoch",
      epoch: 1,
    },
    title,
    startedAt: new Date(startedMs).toISOString(),
    endedAt: null,
    durationMs: null,
    organizer: null,
    participants: emails.map((email) => ({
      externalParticipantId: email,
      displayName: email,
      email,
      domain: email.split("@").at(-1) ?? null,
    })),
    segments,
    sourceUrl: "",
    recordingUrl: null,
    providerSummary: null,
    providerMetadataJson: JSON.stringify({ format: input.format }),
    deleted: false,
  } satisfies Omit<CanonicalCallTranscript, "externalRevisionId">;
  return { ...call, externalRevisionId: canonicalTranscriptRevision(call) };
};
