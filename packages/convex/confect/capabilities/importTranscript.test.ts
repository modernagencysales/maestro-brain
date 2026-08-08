import type { GenericId } from "convex/values";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { Scheduler } from "../_generated/services";
import { scheduleManualTranscriptMaintenance } from "./importTranscript.impl";
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

  it("queues maintenance for an explicitly routed import", async () => {
    let scheduled: unknown;
    const runAfter = ((delay, _ref, args) =>
      Effect.sync(() => {
        scheduled = { delayMs: Duration.toMillis(delay), args };
        return "scheduled";
      })) as Scheduler["runAfter"];

    await Effect.runPromise(
      scheduleManualTranscriptMaintenance(runAfter, {
        workspaceId: "workspace_client" as GenericId<"workspaces">,
        proposalKey: "callroute_1",
        unitRevisionKey: "surev_1",
      }),
    );

    expect(scheduled).toMatchObject({
      delayMs: 0,
      args: {
        workspaceId: "workspace_client",
        unitRevisionKey: "surev_1",
        idempotencyKey: expect.stringMatching(/^maintenance\./),
        caller: {
          kind: "system",
          name: "manual-transcript-import",
          surface: "internal",
        },
      },
    });
  });
});
