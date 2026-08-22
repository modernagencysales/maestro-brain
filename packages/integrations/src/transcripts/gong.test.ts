import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { GongDecodeError, normalizeGongCall } from "./gong";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );

const call = fixture("gong-call.json");
const transcript = fixture("gong-transcript.json");

describe("normalizeGongCall", () => {
  it("flattens and orders Gong transcript sentences", () => {
    const normalized = normalizeGongCall({
      connectionKey: "connection-1",
      call,
      transcript,
    });

    expect(normalized).toMatchObject({
      providerKey: "gong",
      connectionKey: "connection-1",
      externalCallId: "gong-call-001",
      revisionOrder: {
        kind: "provider_timestamp",
        timestamp: "2026-08-02T16:00:00.000Z",
        source: "started",
      },
      title: "Redacted account call",
      startedAt: "2026-08-02T16:00:00.000Z",
      endedAt: "2026-08-02T16:03:00.000Z",
      durationMs: 180_000,
      deleted: false,
      sourceUrl: "https://app.gong.io/call?id=gong-call-001",
      recordingUrl: "https://media.example.test/gong-call-001.mp3",
    });
    expect(normalized.organizer).toEqual(
      expect.objectContaining({ externalParticipantId: "gong-party-host" }),
    );
    expect(normalized.segments).toEqual([
      expect.objectContaining({
        ordinal: 0,
        speakerExternalId: "speaker-host",
        speakerLabel: "Host",
        startMs: 1000,
        endMs: 2500,
        text: "First retained sentence.",
      }),
      expect.objectContaining({
        ordinal: 1,
        speakerExternalId: "speaker-buyer",
        speakerLabel: "Buyer",
        startMs: 5000,
        endMs: 7500,
        text: "Second retained sentence.",
      }),
    ]);
  });

  it("emits deterministic revisions and changes them with content", () => {
    const input = { connectionKey: "connection-1", call, transcript };
    const first = normalizeGongCall(input);
    const second = normalizeGongCall(input);
    const reconnected = normalizeGongCall({
      ...input,
      connectionKey: "connection-2",
    });
    const changed = normalizeGongCall({
      ...input,
      call: { ...(call as Record<string, unknown>), title: "Changed title" },
    });

    expect(first.externalRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.externalRevisionId).toBe(first.externalRevisionId);
    expect(reconnected.externalRevisionId).toBe(first.externalRevisionId);
    expect(changed.externalRevisionId).not.toBe(first.externalRevisionId);
  });

  it("keeps absent sentence timing null", () => {
    const normalized = normalizeGongCall({
      connectionKey: "connection-1",
      call,
      transcript: {
        ...(transcript as Record<string, unknown>),
        transcript: [
          {
            speakerId: "speaker-host",
            sentences: [
              { start: null, end: "", text: "Sentence without timing." },
            ],
          },
        ],
      },
    });

    expect(normalized.segments[0]).toMatchObject({
      startMs: null,
      endMs: null,
    });
  });

  it("emits a segment-free tombstone for deleted records", () => {
    const deleted = normalizeGongCall({
      connectionKey: "connection-1",
      call: {
        ...(call as Record<string, unknown>),
        _nango_metadata: { deleted_at: "2026-08-03T00:00:00.000Z" },
      },
      transcript,
    });

    expect(deleted.deleted).toBe(true);
    expect(deleted.segments).toEqual([]);
    expect(deleted.revisionOrder).toEqual({
      kind: "provider_timestamp",
      timestamp: "2026-08-03T00:00:00.000Z",
      source: "call._nango_metadata.deleted_at",
    });
  });

  it("rejects mismatched call IDs without exposing payload text", () => {
    const privateText = "PRIVATE_GONG_PAYLOAD";
    const malformedTranscript = {
      ...(transcript as Record<string, unknown>),
      callId: "different-call",
      transcript: [{ speakerId: "x", sentences: [{ text: privateText }] }],
    };

    expect(() =>
      normalizeGongCall({
        connectionKey: "connection-1",
        call,
        transcript: malformedTranscript,
      }),
    ).toThrow(GongDecodeError);

    try {
      normalizeGongCall({
        connectionKey: "connection-1",
        call,
        transcript: malformedTranscript,
      });
    } catch (error) {
      expect(String(error)).not.toContain(privateText);
      expect(JSON.stringify(error)).not.toContain(privateText);
    }
  });
});
