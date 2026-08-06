import { TestConfect } from "@confect/test";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "../confect/access/roles";
import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { buildCallSourceUnitRows } from "../confect/sources/sourceUnit";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const organizationKey = "ag_0123456789ABCDEFGHJKMNPQRS";
const identity = {
  subject: "call-reviewer",
  email: "reviewer@example.com",
  emailVerified: true,
  workosOrganizationId: "org_call_review",
};
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
    participants: [
      {
        externalParticipantId: "buyer_1",
        displayName: "Alex",
        email: "alex@acme.com",
        domain: "acme.com",
      },
    ],
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
const unrelatedRevisionRows = buildCallSourceUnitRows(
  {
    providerKey: "fireflies",
    connectionKey: "conn_fireflies_1",
    externalCallId: "unrelated_call",
    externalRevisionId: "unrelated_revision",
    title: "Unrelated call",
    startedAt: "2026-08-05T15:00:00.000Z",
    endedAt: "2026-08-05T15:01:00.000Z",
    durationMs: 60_000,
    organizer: null,
    participants: [],
    segments: [
      {
        externalSegmentId: "unrelated_call:0",
        ordinal: 0,
        evidenceKind: "verbatim_transcript",
        speakerExternalId: null,
        speakerLabel: "Unknown speaker",
        startMs: 0,
        endMs: 1_000,
        text: "This evidence belongs to another call.",
      },
    ],
    sourceUrl: "https://example.test/unrelated_call",
    recordingUrl: null,
    providerSummary: null,
    providerMetadataJson: "{}",
    deleted: false,
  },
  { organizationKey, connectionGeneration: 1, receivedAt: now },
);

type Seeded = {
  readonly agencyWorkspaceId: GenericId<"workspaces">;
  readonly clientWorkspaceId: GenericId<"workspaces">;
};

const seed = (
  role: Role,
  maintenanceReady: boolean,
  maintenanceCitationKey = `cite_${rows.segments[0]!.segmentKey}`,
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const userId = yield* writer
      .table("users")
      .insert({
        subject: identity.subject,
        email: identity.email,
        displayName: "Reviewer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: userId,
        name: "Agency",
        slug: "agency",
        status: "active",
        workosOrganizationId: identity.workosOrganizationId,
        agencyKey: organizationKey,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("organizationMembers")
      .insert({
        organizationId,
        userId,
        role,
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const agencyWorkspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: userId,
        name: "Agency",
        slug: "agency",
        kind: "agency",
        status: "active",
        dataClassification: "confidential",
        lifecycleGeneration: 1,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const clientWorkspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: userId,
        brainKey,
        name: "Acme",
        slug: "acme",
        kind: "client",
        status: "active",
        dataClassification: "confidential",
        lifecycleGeneration: 1,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    for (const workspaceId of [agencyWorkspaceId, clientWorkspaceId])
      yield* writer
        .table("workspaceMembers")
        .insert({
          workspaceId,
          userId,
          role,
          status: "active",
          acceptedAt: now,
          revokedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
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
    if (maintenanceCitationKey !== `cite_${rows.segments[0]!.segmentKey}`)
      yield* writer
        .table("sourceSegments")
        .insert(unrelatedRevisionRows.segments[0]!)
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
        outcome: maintenanceReady ? "routed" : "awaiting_review",
        brainKey: maintenanceReady ? brainKey : null,
        candidateBrainKeys: [brainKey],
        reason: maintenanceReady ? "review_accept" : "no_exact_match",
        status: maintenanceReady ? "accepted" : "current",
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
        stage: maintenanceReady ? "routed" : "awaiting_classification_review",
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

    if (maintenanceReady) {
      yield* writer
        .table("brainPages")
        .insert({
          workspaceId: clientWorkspaceId,
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
          workspaceId: clientWorkspaceId,
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
      yield* writer
        .table("brainMaintenanceProposals")
        .insert({
          workspaceId: clientWorkspaceId,
          brainKey,
          pageKey: "pag_br_acme_overview",
          proposalKey: "brainmaint_1",
          status: "awaiting_review",
          expectedRevisionKey: "rev_br_acme_overview_1",
          routeGeneration: 4,
          lifecycleGeneration: 1,
          policyGeneration: 7,
          modelPromptPair: "openrouter/test@call-maintenance-v1",
          citationKeys: [maintenanceCitationKey],
          unitKey: rows.unit.unitKey,
          unitRevisionKey: rows.revision.unitRevisionKey,
          workspaceLifecycleGeneration: 1,
          modelReceiptKey: "mine_call_1",
          summary: "Acme approved Friday launch.",
          itemCount: 1,
          idempotencyKey: "mine_call_1",
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      yield* writer
        .table("brainMaintenanceProposalItems")
        .insert({
          workspaceId: clientWorkspaceId,
          brainKey,
          proposalKey: "brainmaint_1",
          itemKey: "brainmaintitem_1",
          pageKey: "pag_br_acme_overview",
          expectedRevisionKey: "rev_br_acme_overview_1",
          pageLifecycleGeneration: 2,
          title: "Overview",
          markdown: "# Overview\n\nLaunch Friday.",
          citationKeys: [maintenanceCitationKey],
          status: "awaiting_review",
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    }
    return { agencyWorkspaceId, clientWorkspaceId } satisfies Seeded;
  });

const actor = (confect: TestConfect.TestConfect<typeof databaseSchema>) =>
  confect.withIdentity(identity);

describe("call routing and maintenance review", () => {
  it("lets an admin resolve one route, learn an explicit mapping, and queue maintenance", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(seed("admin", false), Schema.Any);
      const admin = actor(confect);
      const queue = yield* admin.query(
        refs.public.brain.callReview.listCallRoutingQueue,
        { workspaceId: seeded.agencyWorkspaceId },
      );
      const reviewed = yield* admin.mutation(
        refs.public.brain.callReview.reviewCallRoute,
        {
          workspaceId: seeded.agencyWorkspaceId,
          proposalKey: "callroute_1",
          action: "change_brain",
          targetBrainKey: brainKey,
          learnScope: "domain",
          learnValue: "acme.com",
          attemptKey: "route_review_1",
          expectedUnitRevisionKey: rows.revision.unitRevisionKey,
          expectedRouteGeneration: 4,
          expectedSourceLifecycleGeneration: 1,
        },
      );
      yield* confect.finishInProgressScheduledFunctions();
      const state = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          return {
            routes: yield* reader
              .table("callRoutingProposals")
              .index("by_proposal_key", (query) =>
                query
                  .eq("organizationKey", organizationKey)
                  .eq("proposalKey", "callroute_1"),
              )
              .collect()
              .pipe(Effect.orDie),
            mappings: yield* reader
              .table("callRouteMappings")
              .index("by_org_status", (query) =>
                query
                  .eq("organizationKey", organizationKey)
                  .eq("status", "active"),
              )
              .collect()
              .pipe(Effect.orDie),
          };
        }),
        Schema.Any,
      );
      return { queue, reviewed, state };
    });

    try {
      await expect(
        Effect.runPromise(program.pipe(Effect.provide(testConfectLayer()))),
      ).resolves.toMatchObject({
        queue: {
          items: [{ proposalKey: "callroute_1", title: "Acme weekly" }],
        },
        reviewed: {
          status: "accepted",
          outcome: "routed",
          brainKey,
          maintenanceQueued: true,
        },
        state: {
          routes: [
            {
              status: "accepted",
              outcome: "routed",
              brainKey,
              reviewAttemptKey: "route_review_1",
            },
          ],
          mappings: [{ kind: "domain", value: "acme.com", brainKey }],
        },
      });
      expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(
        "idempotencyKey must contain only URL-safe",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("lets an editor publish a grouped proposal atomically and replay the attempt", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seed("editor", true), Schema.Any);
      const editor = actor(confect);
      const queue = yield* editor.query(
        refs.public.brain.callReview.listCallMaintenanceQueue,
        { brainKey },
      );
      const args = {
        brainKey,
        proposalKey: "brainmaint_1",
        action: "accept" as const,
        attemptKey: "maintenance_review_1",
        expectedRouteGeneration: 4,
        expectedSourceLifecycleGeneration: 1,
        expectedWorkspaceLifecycleGeneration: 1,
        edits: [],
      };
      const accepted = yield* editor.mutation(
        refs.public.brain.callReview.reviewCallMaintenance,
        args,
      );
      const duplicate = yield* editor.mutation(
        refs.public.brain.callReview.reviewCallMaintenance,
        args,
      );
      const state = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          return {
            pages: yield* reader
              .table("brainPages")
              .index("by_workspace_page_key", (query) =>
                query.eq("workspaceId", queue.workspaceId),
              )
              .collect()
              .pipe(Effect.orDie),
            revisions: yield* reader
              .table("pageRevisions")
              .index("by_page_created", (query) =>
                query.eq("workspaceId", queue.workspaceId),
              )
              .collect()
              .pipe(Effect.orDie),
            citations: yield* reader
              .table("citations")
              .index("by_workspace", (query) =>
                query.eq("workspaceId", String(queue.workspaceId)),
              )
              .collect()
              .pipe(Effect.orDie),
          };
        }),
        Schema.Any,
      );
      return { queue, accepted, duplicate, state };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.queue.items).toHaveLength(1);
    expect(result.accepted).toEqual(result.duplicate);
    expect(result.accepted).toMatchObject({
      status: "published",
      publishedItemCount: 1,
    });
    expect(result.state.pages[0]).toMatchObject({
      markdown: "# Overview\n\nLaunch Friday.",
    });
    expect(result.state.revisions).toHaveLength(2);
    expect(result.state.citations).toEqual([
      expect.objectContaining({
        sourceKind: "call_transcript",
        sourceUnitRevisionKey: rows.revision.unitRevisionKey,
        segmentKey: rows.segments[0]!.segmentKey,
        quotedText: "Alex owns launch by Friday.",
      }),
    ]);
  });

  it("rejects a citation from another source revision", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(
        seed(
          "editor",
          true,
          `cite_${unrelatedRevisionRows.segments[0]!.segmentKey}`,
        ),
        Schema.Any,
      );
      return yield* actor(confect)
        .mutation(refs.public.brain.callReview.reviewCallMaintenance, {
          brainKey,
          proposalKey: "brainmaint_1",
          action: "accept",
          attemptKey: "maintenance_review_wrong_revision",
          expectedRouteGeneration: 4,
          expectedSourceLifecycleGeneration: 1,
          expectedWorkspaceLifecycleGeneration: 1,
          edits: [],
        })
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(error._tag).toBe("ValidationFailed");
  });

  it("denies viewers both review queues", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(seed("viewer", true), Schema.Any);
      const viewer = actor(confect);
      return yield* Effect.all([
        viewer
          .query(refs.public.brain.callReview.listCallRoutingQueue, {
            workspaceId: seeded.agencyWorkspaceId,
          })
          .pipe(Effect.flip),
        viewer
          .query(refs.public.brain.callReview.listCallMaintenanceQueue, {
            brainKey,
          })
          .pipe(Effect.flip),
      ]);
    });
    const errors = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(errors).toHaveLength(2);
  });
});
