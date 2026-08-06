import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { transcriptAdapterConformance } from "./conformance";
import { normalizeFathomCall } from "./fathom";
import { normalizeFirefliesCall } from "./fireflies";
import { normalizeGongCall } from "./gong";
import { normalizeGranolaNote } from "./granola";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );

const firefliesTranscript = fixture("fireflies-transcript.json");
const firefliesSentences = fixture("fireflies-sentences.json");
const gongCall = fixture("gong-call.json");
const gongTranscript = fixture("gong-transcript.json");
const fathomMeeting = fixture("fathom-meeting.json");
const granolaNote = fixture("granola-note.json");
const privateMarker = "private conformance marker";

describe("transcript adapter conformance", () => {
  const cases: readonly (readonly [string, () => void])[] = [
    [
      "fireflies",
      () =>
        transcriptAdapterConformance("fireflies", normalizeFirefliesCall, {
          valid: {
            connectionKey: "connection-one",
            transcript: firefliesTranscript,
            sentences: firefliesSentences,
          },
          invalid: {
            connectionKey: "connection-one",
            transcript: { id: "", title: privateMarker },
            sentences: [],
          },
          privateMarker,
        }),
    ],
    [
      "gong",
      () =>
        transcriptAdapterConformance("gong", normalizeGongCall, {
          valid: {
            connectionKey: "connection-one",
            call: gongCall,
            transcript: gongTranscript,
          },
          invalid: {
            connectionKey: "connection-one",
            call: gongCall,
            transcript: {
              ...(gongTranscript as Record<string, unknown>),
              callId: "different-call",
              transcript: [{ sentences: [{ text: privateMarker }] }],
            },
          },
          privateMarker,
        }),
    ],
    [
      "fathom",
      () =>
        transcriptAdapterConformance("fathom", normalizeFathomCall, {
          valid: {
            connectionKey: "connection-one",
            meeting: fathomMeeting,
            transcript: fathomMeeting,
          },
          invalid: {
            connectionKey: "connection-one",
            meeting: {
              recording_id: "invalid",
              title: privateMarker,
              created_at: "2026-08-03T14:00:00Z",
            },
            transcript: { transcript: [] },
          },
          privateMarker,
        }),
    ],
    [
      "granola",
      () =>
        transcriptAdapterConformance("granola", normalizeGranolaNote, {
          valid: { connectionKey: "connection-one", note: granolaNote },
          invalid: {
            connectionKey: "connection-one",
            note: {
              id: "invalid",
              title: privateMarker,
              created_at: "2026-08-04T15:00:00Z",
            },
          },
          privateMarker,
        }),
    ],
  ];

  it.each(cases)("keeps %s canonical and redacted", (_name, run) => {
    expect(run).not.toThrow();
  });
});
