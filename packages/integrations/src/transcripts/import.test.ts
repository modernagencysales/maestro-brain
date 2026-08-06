import { describe, expect, it } from "vitest";

import {
  MAX_TRANSCRIPT_IMPORT_BYTES,
  parseTranscriptImport,
  TranscriptImportError,
} from "./import";

const base = {
  connectionKey: "manual:user-1",
  title: "Customer call",
  occurredAt: "2026-08-05T14:00:00Z",
  participantEmails: ["buyer@client.test"],
} as const;

describe("parseTranscriptImport", () => {
  it("parses VTT cues with multiline text and duplicate cue IDs", () => {
    const parsed = parseTranscriptImport({
      ...base,
      format: "vtt",
      content: `WEBVTT

cue
00:00:01.000 --> 00:00:02.500
First line
continues

cue
00:00:03.000 --> 00:00:04.000
Second cue`,
    });

    expect(parsed.segments).toEqual([
      expect.objectContaining({
        externalSegmentId: "cue:0",
        startMs: 1_000,
        endMs: 2_500,
        speakerLabel: "Unknown speaker",
        text: "First line\ncontinues",
      }),
      expect.objectContaining({
        externalSegmentId: "cue:1",
        startMs: 3_000,
        endMs: 4_000,
        text: "Second cue",
      }),
    ]);
  });

  it("parses SRT comma timestamps and multiline cues", () => {
    const parsed = parseTranscriptImport({
      ...base,
      format: "srt",
      content: `1
00:00:05,250 --> 00:00:06,750
Hello
world`,
    });

    expect(parsed.segments).toEqual([
      expect.objectContaining({
        startMs: 5_250,
        endMs: 6_750,
        text: "Hello\nworld",
      }),
    ]);
  });

  it.each([
    ["txt", "Buyer: UTF-8 works — ✅"],
    ["markdown", "## Call\n\nBuyer: keep exact markdown"],
  ] as const)("keeps %s text intact", (format, content) => {
    const parsed = parseTranscriptImport({ ...base, format, content });

    expect(parsed.segments).toEqual([
      expect.objectContaining({
        text: content,
        evidenceKind: "verbatim_transcript",
      }),
    ]);
  });

  it("accepts canonical JSON segments", () => {
    const parsed = parseTranscriptImport({
      ...base,
      format: "json",
      content: JSON.stringify({
        segments: [
          {
            externalSegmentId: "segment-1",
            speakerExternalId: "buyer",
            speakerLabel: "Buyer",
            startMs: 100,
            endMs: 200,
            text: "A retained quote.",
          },
        ],
      }),
    });

    expect(parsed).toMatchObject({
      providerKey: "manual-transcript",
      title: "Customer call",
      startedAt: "2026-08-05T14:00:00.000Z",
      participants: [expect.objectContaining({ email: "buyer@client.test" })],
      segments: [
        expect.objectContaining({
          externalSegmentId: "segment-1",
          speakerLabel: "Buyer",
          startMs: 100,
          endMs: 200,
          text: "A retained quote.",
        }),
      ],
    });
  });

  it.each([
    ["json", "{not-json", "invalid_json"],
    ["json", JSON.stringify({ segments: [] }), "empty"],
    ["vtt", "WEBVTT\n\n", "empty"],
    ["txt", "   ", "empty"],
    ["pdf", "unsupported", "unsupported_format"],
  ] as const)("rejects invalid %s input", (format, content, reason) => {
    expect(() =>
      parseTranscriptImport({
        ...base,
        format: format as never,
        content,
      }),
    ).toThrow(expect.objectContaining({ reason }) as TranscriptImportError);
  });

  it("enforces the UTF-8 payload limit", () => {
    expect(() =>
      parseTranscriptImport({
        ...base,
        format: "txt",
        content: "a".repeat(MAX_TRANSCRIPT_IMPORT_BYTES + 1),
      }),
    ).toThrow(
      expect.objectContaining({
        reason: "payload_too_large",
      }) as TranscriptImportError,
    );
  });
});
