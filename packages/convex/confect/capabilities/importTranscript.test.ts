import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import importTranscriptGroup, {
  importTranscriptArgs,
  manifest,
} from "./importTranscript.spec";

describe("importTranscript public capability", () => {
  it("registers a typed public mutation", () => {
    expect(importTranscriptGroup.functions.importTranscript).toMatchObject({
      name: "importTranscript",
      functionVisibility: "public",
      runtimeAndFunctionType: { functionType: "mutation" },
    });
    expect(manifest).toContainEqual(
      expect.objectContaining({
        operationId: "capabilities.importTranscript.importTranscript",
        surfaces: ["web"],
      }),
    );
  });

  it("accepts only supported import metadata", () => {
    expect(
      Schema.decodeUnknownSync(importTranscriptArgs)({
        brainKey: "br_agency",
        format: "vtt",
        content: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello",
        title: "Customer call",
        occurredAt: "2026-08-05T14:00:00Z",
        participantEmails: ["buyer@example.com"],
        targetBrainKey: "br_client",
      }),
    ).toMatchObject({ format: "vtt", targetBrainKey: "br_client" });
    expect(() =>
      Schema.decodeUnknownSync(importTranscriptArgs)({
        brainKey: "br_agency",
        format: "pdf",
        content: "payload",
        title: "Customer call",
        occurredAt: "2026-08-05T14:00:00Z",
        participantEmails: [],
      }),
    ).toThrow();
  });
});
