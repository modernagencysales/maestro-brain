import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import refs from "../confect/_generated/refs";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { buildCallSourceUnitRows } from "../confect/sources/sourceUnit";
import { testConfectLayer } from "./support/confect";

const now = 1_000;
const organizationKey = "agency_acme";
const rows = buildCallSourceUnitRows(
  {
    providerKey: "fireflies",
    connectionKey: "conn_fireflies_1",
    externalCallId: "call_1",
    externalRevisionId: "revision_1",
    title: "Acme weekly",
    startedAt: "2026-08-05T14:00:00.000Z",
    endedAt: "2026-08-05T14:30:00.000Z",
    durationMs: 1_800_000,
    organizer: null,
    participants: [],
    segments: [
      {
        externalSegmentId: "call_1:0",
        ordinal: 0,
        evidenceKind: "verbatim_transcript",
        speakerExternalId: "buyer_1",
        speakerLabel: "Alex",
        startMs: 0,
        endMs: 2_000,
        text: "Alex owns launch by Friday.",
      },
    ],
    sourceUrl: "https://example.test/call_1",
    recordingUrl: null,
    providerSummary: null,
    providerMetadataJson: "{}",
    deleted: false,
  },
  { organizationKey, connectionGeneration: 1, receivedAt: now },
);

const seed = Effect.gen(function* () {
  const writer = yield* DatabaseWriter;
  const organizationId = yield* writer
    .table("organizations")
    .insert({
      ownerUserId: "user_owner",
      agencyKey: organizationKey,
      slug: "agency-acme",
      name: "Agency Acme",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const workspaceId = yield* writer
    .table("workspaces")
    .insert({
      organizationId,
      ownerUserId: "user_owner",
      brainKey: "br_acme",
      slug: "acme",
      name: "Acme",
      kind: "client",
      status: "active",
      dataClassification: "confidential",
      createdAt: now,
      updatedAt: now,
      lifecycleGeneration: 3,
    })
    .pipe(Effect.orDie);
  yield* writer.table("sourceUnits").insert(rows.unit).pipe(Effect.orDie);
  yield* writer
    .table("sourceUnitRevisions")
    .insert(rows.revision)
    .pipe(Effect.orDie);
  yield* writer
    .table("sourceSegments")
    .insert(rows.segments[0]!)
    .pipe(Effect.orDie);
  yield* writer
    .table("callRoutingProposals")
    .insert({
      schemaVersion: 1,
      organizationKey,
      proposalKey: "callroute_1",
      unitKey: rows.unit.unitKey,
      unitRevisionKey: rows.revision.unitRevisionKey,
      sourceLifecycleGeneration: 1,
      routeGeneration: 4,
      outcome: "routed",
      brainKey: "br_acme",
      candidateBrainKeys: ["br_acme"],
      reason: "participant_domain",
      status: "accepted",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("brainPages")
    .insert({
      workspaceId,
      organizationId,
      slug: "overview",
      title: "Overview",
      markdown: "# Overview\n\nCurrent context.",
      sourceKind: "markdown",
      updatedAt: now,
      pageKey: "pag_br_acme_overview",
      parentPageKey: null,
      siblingSlug: "overview",
      sortKey: "0000000001",
      favorite: false,
      status: "active",
      currentRevisionKey: "rev_br_acme_overview_1",
      lifecycle: {
        state: "active",
        generation: 2,
        updatedAt: now,
        purgeAfter: null,
      },
      createdAt: now,
      schemaVersion: 1,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("pageRevisions")
    .insert({
      workspaceId,
      organizationId,
      pageKey: "pag_br_acme_overview",
      revisionKey: "rev_br_acme_overview_1",
      priorRevisionKey: null,
      blockNoteJson: "{}",
      markdown: "# Overview\n\nCurrent context.",
      contentHash: "sha256:overview",
      causation: "migration",
      actor: { kind: "migration", id: "test" },
      modelReceiptKey: null,
      effectKey: "seed:overview",
      state: "published",
      lifecycle: {
        state: "active",
        generation: 1,
        updatedAt: now,
        purgeAfter: null,
      },
      createdAt: now,
      schemaVersion: 1,
    })
    .pipe(Effect.orDie);
  return { organizationId, workspaceId };
});

describe("call maintenance persistence", () => {
  it("stores one grouped proposal, normalized page items, and a hash-only model receipt", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const { organizationId, workspaceId } = yield* confect.run(
        seed,
        Schema.Any,
      );
      const context = {
        workspaceId,
        organizationId,
        organizationKey,
        brainKey: "br_acme",
        unitKey: rows.unit.unitKey,
        unitRevisionKey: rows.revision.unitRevisionKey,
        sourceLifecycleGeneration: 1,
        routeGeneration: 4,
        policyGeneration: 7,
        workspaceLifecycleGeneration: 3,
        source: {
          title: rows.revision.title,
          startedAt: rows.revision.startedAt,
          sourceUrl: rows.revision.sourceUrl,
        },
        pages: [
          {
            pageKey: "pag_br_acme_overview",
            title: "Overview",
            currentRevisionKey: "rev_br_acme_overview_1",
            lifecycleGeneration: 2,
            markdown: "# Overview\n\nCurrent context.",
          },
        ],
        citations: [
          {
            citationKey: `cite_${rows.segments[0]!.segmentKey}`,
            sourceUnitKey: rows.unit.unitKey,
            revisionKey: rows.revision.unitRevisionKey,
            segmentKey: rows.segments[0]!.segmentKey,
            evidenceKind: "verbatim_transcript",
            speakerLabel: "Alex",
            startMs: 0,
            endMs: 2_000,
            quote: "Alex owns launch by Friday.",
          },
        ],
      };
      const mined = {
        output: {
          summary: "Acme approved Friday launch.",
          summaryCitationKeys: [`cite_${rows.segments[0]!.segmentKey}`],
          decisions: [],
          commitments: [],
          risks: [],
          stakeholderChanges: [],
          pageProposals: [
            {
              brainKey: "br_acme",
              pageKey: "pag_br_acme_overview",
              title: "Overview",
              markdown: "# Overview\n\nLaunch Friday.",
              citationKeys: [`cite_${rows.segments[0]!.segmentKey}`],
            },
          ],
        },
        receipt: {
          attemptKey: "mine_call_1",
          organizationId,
          workspaceSlug: workspaceId,
          provider: "openrouter",
          mode: "test",
          model: "openrouter/test",
          region: "us",
          state: "succeeded",
          trustedInstructionVersion: "call-maintenance-v1",
          toolSchemaVersion: "mined-call-v1",
          schemaGeneration: 1,
          policyGeneration: 7,
          lifecycleGeneration: 1,
          redactionState: "none",
          requestHash: "sha256:request",
          responseHash: "sha256:response",
          sourceHash: "sha256:source",
          latencyMs: 10,
          usage: { inputTokens: 100, outputTokens: 50, costCents: 1 },
          generatedAt: "2026-08-05T14:01:00.000Z",
        },
      };
      const result = yield* confect.mutation(
        refs.public.capabilities.maintainBrainPage.maintainBrainPage,
        {
          workspaceSlug: workspaceId,
          contextPackId: "mine_call_1",
          context,
          modelOutput: mined,
          caller: {
            kind: "system",
            name: "sourceToBrainMaintenance",
            surface: "workflow",
          },
        },
      );
      const stored = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          return {
            proposals: yield* reader
              .table("brainMaintenanceProposals")
              .index("by_workspace", (query) =>
                query.eq("workspaceId", workspaceId),
              )
              .collect()
              .pipe(Effect.orDie),
            items: yield* reader
              .table("brainMaintenanceProposalItems")
              .index("by_workspace_proposal", (query) =>
                query.eq("workspaceId", workspaceId),
              )
              .collect()
              .pipe(Effect.orDie),
            receipts: yield* reader
              .table("modelCallReceipts")
              .index("by_workspace_attempt", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("attemptKey", "mine_call_1"),
              )
              .collect()
              .pipe(Effect.orDie),
          };
        }),
        Schema.Any,
      );
      return { result, stored };
    });

    await expect(
      Effect.runPromise(program.pipe(Effect.provide(testConfectLayer()))),
    ).resolves.toMatchObject({
      result: { status: "awaiting_review" },
      stored: {
        proposals: [{ brainKey: "br_acme", itemCount: 1 }],
        items: [
          {
            pageKey: "pag_br_acme_overview",
            expectedRevisionKey: "rev_br_acme_overview_1",
            citationKeys: [expect.stringMatching(/^cite_seg_/)],
          },
        ],
        receipts: [
          {
            requestHash: "sha256:request",
            responseHash: "sha256:response",
          },
        ],
      },
    });
  });
});
