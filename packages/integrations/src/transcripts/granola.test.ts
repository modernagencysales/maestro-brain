import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  decodeGranolaNotePage,
  GranolaDecodeError,
  granolaNotesEndpoint,
  normalizeGranolaNote,
} from "./granola";

const note = JSON.parse(
  readFileSync(
    new URL("./fixtures/granola-note.json", import.meta.url),
    "utf8",
  ),
) as unknown;

describe("Granola transcript adapter", () => {
  it("decodes cursor pages and honors Granola's page ceiling", () => {
    expect(
      decodeGranolaNotePage({
        notes: [note],
        hasMore: true,
        cursor: "next page",
      }),
    ).toEqual({ records: [note], nextCursor: "next page" });
    expect(granolaNotesEndpoint(null)).toBe("/v1/notes?page_size=30");
    expect(granolaNotesEndpoint("next page")).toContain("cursor=next+page");
  });

  it("keeps provider notes distinct from verbatim transcript evidence", () => {
    const normalized = normalizeGranolaNote({
      connectionKey: "connection-1",
      note,
    });

    expect(normalized).toMatchObject({
      providerKey: "granola",
      externalCallId: "not_1d3tmYTlCICgjy",
      revisionOrder: {
        kind: "provider_timestamp",
        timestamp: "2026-08-04T16:01:00.000Z",
        source: "updated_at",
      },
      startedAt: "2026-08-04T15:00:00.000Z",
      endedAt: "2026-08-04T16:00:00.000Z",
      durationMs: 3_600_000,
      providerSummary: "## Notes\nA redacted provider note.",
    });
    expect(normalized.segments).toEqual([
      expect.objectContaining({
        evidenceKind: "provider_notes",
        text: "## Notes\nA redacted provider note.",
      }),
      expect.objectContaining({
        evidenceKind: "verbatim_transcript",
        speakerLabel: "Host",
        startMs: 5_000,
      }),
      expect.objectContaining({
        evidenceKind: "verbatim_transcript",
        speakerLabel: "Speaker A",
        startMs: 8_000,
      }),
    ]);
  });

  it("cannot turn summary-only notes into transcript quotes", () => {
    const normalized = normalizeGranolaNote({
      connectionKey: "connection-1",
      note: { ...(note as Record<string, unknown>), transcript: null },
    });

    expect(normalized.segments).toHaveLength(1);
    expect(normalized.segments[0]?.evidenceKind).toBe("provider_notes");
    expect(
      normalized.segments.some(
        (segment) => segment.evidenceKind === "verbatim_transcript",
      ),
    ).toBe(false);
  });

  it("keeps revisions stable and emits tombstones", () => {
    const first = normalizeGranolaNote({ connectionKey: "one", note });
    const second = normalizeGranolaNote({ connectionKey: "two", note });
    expect(second.externalRevisionId).toBe(first.externalRevisionId);
    expect(
      normalizeGranolaNote({
        connectionKey: "one",
        note: {
          ...(note as Record<string, unknown>),
          _nango_metadata: { deleted_at: "2026-08-05T00:00:00Z" },
        },
      }),
    ).toMatchObject({
      deleted: true,
      segments: [],
      revisionOrder: {
        timestamp: "2026-08-05T00:00:00.000Z",
        source: "_nango_metadata.deleted_at",
      },
    });
  });

  it("rejects malformed notes without exposing payload text", () => {
    const privateText = "PRIVATE_GRANOLA_PAYLOAD";
    expect(() =>
      normalizeGranolaNote({
        connectionKey: "connection-1",
        note: {
          id: "not-a-note-id",
          title: privateText,
          created_at: "2026-08-04T15:00:00Z",
          transcript: null,
        },
      }),
    ).toThrow(GranolaDecodeError);
    try {
      normalizeGranolaNote({
        connectionKey: "connection-1",
        note: {
          id: "not-a-note-id",
          title: privateText,
          created_at: "2026-08-04T15:00:00Z",
          transcript: null,
        },
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(privateText);
    }
  });
});
