import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  decodeFathomMeetingPage,
  FathomDecodeError,
  fathomMeetingsEndpoint,
  normalizeFathomCall,
} from "./fathom";

const meeting = JSON.parse(
  readFileSync(
    new URL("./fixtures/fathom-meeting.json", import.meta.url),
    "utf8",
  ),
) as unknown;

describe("Fathom transcript adapter", () => {
  it("decodes cursor pages and builds the next endpoint", () => {
    expect(
      decodeFathomMeetingPage({ items: [meeting], next_cursor: "next page" }),
    ).toEqual({ records: [meeting], nextCursor: "next page" });
    expect(fathomMeetingsEndpoint(null)).toBe(
      "/external/v1/meetings?limit=100&include_summary=true",
    );
    expect(fathomMeetingsEndpoint("next page")).toContain("cursor=next+page");
  });

  it("normalizes participants, relative timestamps, and provider summary", () => {
    const normalized = normalizeFathomCall({
      connectionKey: "connection-1",
      meeting,
      transcript: meeting,
    });

    expect(normalized).toMatchObject({
      providerKey: "fathom",
      externalCallId: "123456789",
      revisionOrder: {
        kind: "provider_timestamp",
        timestamp: "2026-08-03T14:29:00.000Z",
        source: "recording_end_time",
      },
      startedAt: "2026-08-03T14:01:00.000Z",
      endedAt: "2026-08-03T14:29:00.000Z",
      durationMs: 1_680_000,
      providerSummary: "## Summary\nA redacted provider summary.",
      sourceUrl: "https://fathom.video/share/redacted-123",
    });
    expect(normalized.participants).toEqual([
      expect.objectContaining({ email: "host@agency.test" }),
      expect.objectContaining({ email: "buyer@client.test" }),
    ]);
    expect(normalized.segments).toEqual([
      expect.objectContaining({
        ordinal: 0,
        speakerLabel: "Host",
        startMs: 5_000,
        text: "First retained sentence.",
      }),
      expect.objectContaining({
        ordinal: 1,
        speakerLabel: "Buyer",
        startMs: 62_000,
        text: "Second retained sentence.",
      }),
    ]);
  });

  it("keeps revisions stable and emits tombstones", () => {
    const input = {
      connectionKey: "connection-1",
      meeting,
      transcript: meeting,
    };
    expect(normalizeFathomCall(input).externalRevisionId).toBe(
      normalizeFathomCall({ ...input, connectionKey: "connection-2" })
        .externalRevisionId,
    );
    expect(
      normalizeFathomCall({
        ...input,
        meeting: {
          ...(meeting as Record<string, unknown>),
          _nango_metadata: {
            last_action: "DELETED",
            deleted_at: "2026-08-05T00:00:00Z",
          },
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
    expect(() =>
      normalizeFathomCall({
        ...input,
        meeting: {
          ...(meeting as Record<string, unknown>),
          _nango_metadata: { last_action: "DELETED" },
        },
      }),
    ).toThrow(FathomDecodeError);
  });

  it("rejects malformed IDs without exposing payload text", () => {
    const privateText = "PRIVATE_FATHOM_PAYLOAD";
    expect(() =>
      normalizeFathomCall({
        connectionKey: "connection-1",
        meeting: {
          recording_id: "not-a-recording-id",
          title: privateText,
          created_at: "2026-08-03T14:00:00Z",
        },
        transcript: { transcript: [] },
      }),
    ).toThrow(FathomDecodeError);
    try {
      normalizeFathomCall({
        connectionKey: "connection-1",
        meeting: {
          recording_id: "not-a-recording-id",
          title: privateText,
          created_at: "2026-08-03T14:00:00Z",
        },
        transcript: { transcript: [] },
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(privateText);
    }
  });
});
