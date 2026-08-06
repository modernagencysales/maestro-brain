import { TestConfect } from "@confect/test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";

import databaseSchema from "../_generated/schema";
import { Id } from "../_generated/id";
import refs from "../_generated/refs";
import { DatabaseWriter } from "../_generated/services";
import { buildStandardClientBriefPages } from "../brain/clientBrief";
import { buildCallSourceUnitRows } from "../sources/sourceUnit";
import { testConfectLayer } from "../../test/support/confect";

const now = 1_000;
const organizationKey = "agency_acme";
const caller = {
  kind: "system",
  name: "source-maintenance",
  surface: "workflow",
} as const;
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
        speakerLabel: "Buyer",
        startMs: 0,
        endMs: 2_000,
        text: "Alex owns launch by Friday.",
      },
    ],
    sourceUrl: "https://app.fireflies.ai/view/call_1",
    recordingUrl: null,
    providerSummary: null,
    providerMetadataJson: "{}",
    deleted: false,
  },
  { organizationKey, connectionGeneration: 1, receivedAt: now },
);
const segment = rows.segments[0];
if (!segment) throw new TypeError("expected transcript fixture segment");

type SeedOptions = {
  readonly sourceState?: "active" | "redacted";
  readonly routeStatus?: "current" | "accepted" | "superseded";
  readonly routeBrainKey?: string;
  readonly omitPageKey?: string;
  readonly includeSegments?: boolean;
};

const seed = (options: SeedOptions = {}) =>
  Effect.gen(function* () {
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
    const unitId = yield* writer
      .table("sourceUnits")
      .insert(rows.unit)
      .pipe(Effect.orDie);
    yield* writer
      .table("sourceUnitRevisions")
      .insert(rows.revision)
      .pipe(Effect.orDie);
    if (options.includeSegments !== false)
      yield* writer.table("sourceSegments").insert(segment).pipe(Effect.orDie);
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
        brainKey: options.routeBrainKey ?? "br_acme",
        candidateBrainKeys: ["br_acme"],
        reason: "participant_domain",
        status: options.routeStatus ?? "current",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("sourceProcessingJobs")
      .insert({
        schemaVersion: 1,
        organizationKey,
        unitKey: rows.unit.unitKey,
        stage: "routed",
        executionStatus: "queued",
        effectKey: "source-unit-ingest:call_1",
        policyGeneration: 7,
        routeGeneration: 4,
        lifecycleGeneration: 1,
        emergencyGeneration: 0,
        leaseGeneration: 0,
        attempt: 0,
        maxAttempts: 3,
        nextRetryAt: now,
        attemptReceipts: [],
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    for (const page of buildStandardClientBriefPages("br_acme")) {
      if (page.pageKey === options.omitPageKey) continue;
      const revisionKey = `rev_${page.pageKey.slice(4)}_1`;
      yield* writer
        .table("brainPages")
        .insert({
          workspaceId,
          organizationId,
          slug: page.slug,
          title: page.title,
          markdown: page.markdown,
          sourceKind: "markdown",
          updatedAt: now,
          pageKey: page.pageKey,
          parentPageKey: null,
          siblingSlug: page.slug,
          sortKey: page.sortKey,
          favorite: false,
          status: "active",
          currentRevisionKey: revisionKey,
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
          pageKey: page.pageKey,
          revisionKey,
          priorRevisionKey: null,
          blockNoteJson: "{}",
          markdown: page.markdown,
          contentHash: `sha256:${page.slug}`,
          causation: "migration",
          actor: { kind: "migration", id: "test" },
          modelReceiptKey: null,
          effectKey: `seed:${page.slug}`,
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
    }
    if (options.sourceState === "redacted") {
      yield* writer
        .table("sourceUnits")
        .patch(unitId, {
          lifecycle: { ...rows.unit.lifecycle, state: "redacted" },
        })
        .pipe(Effect.orDie);
    }
    return workspaceId;
  });

describe("gather maintenance context", () => {
  it.each(["current", "accepted"] as const)(
    "loads %s routed transcript evidence and current Brain pages",
    async (routeStatus) => {
      const program = Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const workspaceId = yield* confect.run(
          seed({ routeStatus }),
          Id("workspaces"),
        );
        return yield* confect.query(
          refs.internal.capabilities.gatherMaintenanceContext
            .gatherMaintenanceContext,
          {
            workspaceId,
            unitRevisionKey: rows.revision.unitRevisionKey,
            caller,
          },
        );
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testConfectLayer())),
      );
      expect(result).toMatchObject({
        organizationKey,
        brainKey: "br_acme",
        unitKey: rows.unit.unitKey,
        unitRevisionKey: rows.revision.unitRevisionKey,
        sourceLifecycleGeneration: 1,
        routeGeneration: 4,
        policyGeneration: 7,
        workspaceLifecycleGeneration: 3,
        pages: expect.arrayContaining([
          expect.objectContaining({
            pageKey: "pag_br_acme_overview",
            currentRevisionKey: "rev_br_acme_overview_1",
            markdown:
              "# Overview\n\nCapture the client's context, goals, and positioning.",
          }),
        ]),
        citations: [
          {
            citationKey: `cite_${segment.segmentKey}`,
            segmentKey: segment.segmentKey,
            evidenceKind: "verbatim_transcript",
            quote: "Alex owns launch by Friday.",
          },
        ],
      });
      expect(result.pages).toHaveLength(6);
    },
  );

  it.each([
    ["stale route", { routeStatus: "superseded" }, "stale_route"],
    ["revoked source", { sourceState: "redacted" }, "revoked_source"],
    ["foreign workspace", { routeBrainKey: "br_other" }, "foreign_workspace"],
    [
      "missing current page",
      { omitPageKey: "pag_br_acme_overview" },
      "missing_current_page",
    ],
    [
      "zero readable citations",
      { includeSegments: false },
      "no_readable_citations",
    ],
  ] as const)("rejects %s", async (_label, options, reason) => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const workspaceId = yield* confect.run(seed(options), Id("workspaces"));
      return yield* confect.query(
        refs.internal.capabilities.gatherMaintenanceContext
          .gatherMaintenanceContext,
        {
          workspaceId,
          unitRevisionKey: rows.revision.unitRevisionKey,
          caller,
        },
      );
    });
    const exit = await Effect.runPromiseExit(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit))
      expect(Cause.pretty(exit.cause)).toContain(reason);
  });
});
