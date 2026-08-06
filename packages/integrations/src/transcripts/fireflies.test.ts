import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { FirefliesDecodeError, normalizeFirefliesCall } from "./fireflies";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );

const transcript = fixture("fireflies-transcript.json");
const sentences = fixture("fireflies-sentences.json");

describe("normalizeFirefliesCall", () => {
  it("sorts and normalizes Fireflies sentences", () => {
    const call = normalizeFirefliesCall({
      connectionKey: "connection-1",
      transcript,
      sentences,
    });

    expect(call).toMatchObject({
      providerKey: "fireflies",
      connectionKey: "connection-1",
      externalCallId: "ff-call-001",
      title: "Redacted discovery call",
      startedAt: "2026-08-01T14:00:00.000Z",
      endedAt: "2026-08-01T14:02:05.500Z",
      durationMs: 125_500,
      deleted: false,
      sourceUrl: "https://app.fireflies.ai/view/ff-call-001",
      recordingUrl: "https://media.example.test/ff-call-001.mp3",
      providerSummary: "A redacted provider summary.",
    });
    expect(call.segments).toEqual([
      expect.objectContaining({
        externalSegmentId: "ff-sentence-1",
        ordinal: 0,
        speakerExternalId: "11",
        startMs: 1000,
        endMs: 2500,
        text: "First retained sentence.",
      }),
      expect.objectContaining({
        externalSegmentId: "ff-sentence-3",
        ordinal: 1,
        speakerExternalId: "22",
        startMs: 4250,
        endMs: 6000,
        text: "Second retained sentence.",
      }),
    ]);
  });

  it("emits deterministic revisions and changes them with content", () => {
    const input = { connectionKey: "connection-1", transcript, sentences };
    const first = normalizeFirefliesCall(input);
    const second = normalizeFirefliesCall(input);
    const reconnected = normalizeFirefliesCall({
      ...input,
      connectionKey: "connection-2",
    });
    const changed = normalizeFirefliesCall({
      ...input,
      sentences: [
        ...(sentences as readonly Record<string, unknown>[]),
        {
          id: "ff-sentence-4",
          transcript_id: "ff-call-001",
          index: 3,
          text: "Changed content.",
        },
      ],
    });

    expect(first.externalRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.externalRevisionId).toBe(first.externalRevisionId);
    expect(reconnected.externalRevisionId).toBe(first.externalRevisionId);
    expect(changed.externalRevisionId).not.toBe(first.externalRevisionId);
  });

  it("keeps absent sentence timing null", () => {
    const normalized = normalizeFirefliesCall({
      connectionKey: "connection-1",
      transcript,
      sentences: [
        {
          id: "ff-sentence-no-timing",
          transcript_id: "ff-call-001",
          index: 0,
          text: "Sentence without timing.",
          start_time: null,
          end_time: "",
        },
      ],
    });

    expect(normalized.segments[0]).toMatchObject({
      startMs: null,
      endMs: null,
    });
  });

  it("emits a segment-free tombstone for deleted records", () => {
    const deleted = normalizeFirefliesCall({
      connectionKey: "connection-1",
      transcript: {
        ...(transcript as Record<string, unknown>),
        _nango_metadata: { deleted_at: "2026-08-03T00:00:00.000Z" },
      },
      sentences,
    });

    expect(deleted.deleted).toBe(true);
    expect(deleted.segments).toEqual([]);
  });

  it("rejects malformed call IDs without exposing payload text", () => {
    const privateText = "PRIVATE_FIREFLIES_PAYLOAD";
    expect(() =>
      normalizeFirefliesCall({
        connectionKey: "connection-1",
        transcript: { id: "", title: privateText },
        sentences: [],
      }),
    ).toThrow(FirefliesDecodeError);

    try {
      normalizeFirefliesCall({
        connectionKey: "connection-1",
        transcript: { id: "", title: privateText },
        sentences: [],
      });
    } catch (error) {
      expect(String(error)).not.toContain(privateText);
      expect(JSON.stringify(error)).not.toContain(privateText);
    }
  });
});
