import { TestConfect } from "@confect/test";
import type { GenericId, Value } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type {
  BrainPagesDoc,
  PageRevisionsDoc,
  RetrievalPublicationJobsDoc,
} from "../confect/_generated/docs";
import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { sweepPublicationJobsEffect } from "../confect/brain/retrievalPublication.impl";
import { buildCallSourceUnitRows } from "../confect/sources/sourceUnit";
import { testConfectLayer } from "./support/confect";

const seedTime = 1_782_924_800_000;
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const organizationKey = "ag_0123456789ABCDEFGHJKMNPQRS";
const editorIdentity = {
  subject: "page-publication-editor",
  email: "page-publication-editor@example.com",
  emailVerified: true,
  workosOrganizationId: "org_page_publication",
} as const;

const PUBLIC_PAGE_WRITE_SURFACES = [
  "brain.pages.create",
  "brain.pages.rename",
  "brain.pages.move",
  "brain.pages.favorite",
  "brain.pages.archive",
  "brain.pages.restore",
  "brain.pilot.reviewNote:approve",
  "brain.pilot.updatePage",
  "brain.callReview.reviewCallMaintenance:accept|edit",
  "access.provisioning.createClientBrain",
] as const;

type PublicationState = {
  readonly pages: readonly BrainPagesDoc[];
  readonly revisions: readonly PageRevisionsDoc[];
  readonly jobs: readonly RetrievalPublicationJobsDoc[];
};

const PublicationStateSchema = Schema.Any as unknown as Schema.Schema<
  PublicationState,
  Value,
  never
>;

const resultSchema = <Result>(): Schema.Schema<Result, Value, never> =>
  Schema.Any as unknown as Schema.Schema<Result, Value, never>;

const seedEditorBrain = Effect.gen(function* () {
  const writer = yield* DatabaseWriter;
  const userId = yield* writer
    .table("users")
    .insert({
      subject: editorIdentity.subject,
      email: editorIdentity.email,
      displayName: "Publication editor",
      status: "active",
      createdAt: seedTime,
      updatedAt: seedTime,
    })
    .pipe(Effect.orDie);
  const organizationId = yield* writer
    .table("organizations")
    .insert({
      ownerUserId: userId,
      name: "Publication conformance",
      slug: "publication-conformance",
      status: "active",
      workosOrganizationId: editorIdentity.workosOrganizationId,
      agencyKey: organizationKey,
      createdAt: seedTime,
      updatedAt: seedTime,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("organizationMembers")
    .insert({
      organizationId,
      userId,
      role: "editor",
      status: "active",
      acceptedAt: seedTime,
      revokedAt: null,
      createdAt: seedTime,
      updatedAt: seedTime,
    })
    .pipe(Effect.orDie);
  const workspaceId = yield* writer
    .table("workspaces")
    .insert({
      organizationId,
      ownerUserId: userId,
      brainKey,
      name: "Publication conformance",
      slug: "publication-conformance-brain",
      kind: "agency",
      status: "active",
      dataClassification: "internal",
      lifecycleGeneration: 1,
      createdAt: seedTime,
      updatedAt: seedTime,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("workspaceMembers")
    .insert({
      workspaceId,
      userId,
      role: "editor",
      status: "active",
      acceptedAt: seedTime,
      revokedAt: null,
      deletedAt: null,
      createdAt: seedTime,
      updatedAt: seedTime,
    })
    .pipe(Effect.orDie);
  return { organizationId, workspaceId };
});

const readPublicationState = (
  workspaceId: GenericId<"workspaces">,
  stateBrainKey = brainKey,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const [pages, revisions, jobs] = yield* Effect.all([
      reader
        .table("brainPages")
        .index("by_workspace", (query) => query.eq("workspaceId", workspaceId))
        .collect()
        .pipe(Effect.orDie),
      reader
        .table("pageRevisions")
        .index("by_workspace_revision_key", (query) =>
          query.eq("workspaceId", workspaceId),
        )
        .collect()
        .pipe(Effect.orDie),
      reader
        .table("retrievalPublicationJobs")
        .index("by_workspace_brain_job", (query) =>
          query.eq("workspaceId", workspaceId).eq("brainKey", stateBrainKey),
        )
        .collect()
        .pipe(Effect.orDie),
    ]);
    return { pages, revisions, jobs };
  });

const expectAtomicPagePublication = (input: {
  readonly before: PublicationState;
  readonly after: PublicationState;
  readonly pageKey: string;
  readonly revisionKey: string;
  readonly pageDelta: 0 | 1;
  readonly eligible?: boolean;
  readonly expectedBrainKey?: string;
  readonly expectedOrganizationKey?: string;
}) => {
  expect(input.after.pages).toHaveLength(
    input.before.pages.length + input.pageDelta,
  );
  expect(input.after.revisions).toHaveLength(input.before.revisions.length + 1);
  expect(input.after.jobs).toHaveLength(input.before.jobs.length + 1);

  const page = input.after.pages.find(
    ({ pageKey: candidate }) => candidate === input.pageKey,
  );
  const revision = input.after.revisions.find(
    ({ revisionKey: candidate }) => candidate === input.revisionKey,
  );
  const job = input.after.jobs.find(
    ({ sourceRevisionKey }) => sourceRevisionKey === input.revisionKey,
  );
  expect(page).toMatchObject({
    pageKey: input.pageKey,
    currentRevisionKey: input.revisionKey,
  });
  expect(revision).toMatchObject({
    pageKey: input.pageKey,
    revisionKey: input.revisionKey,
    state: "published",
  });
  expect(job).toMatchObject({
    organizationKey: input.expectedOrganizationKey ?? organizationKey,
    workspaceId: page?.workspaceId,
    brainKey: input.expectedBrainKey ?? brainKey,
    originKind: "page",
    effectClass: "direct_publication",
    operation: "publish",
    sourceKey: input.pageKey,
    sourceRevisionKey: input.revisionKey,
    requestGeneration: 1,
    page: {
      authority: "derived",
      authorityPolicyKey: "company-pages",
      policyGeneration: 1,
    },
    status: "pending",
    attemptCount: 0,
  });
  expect(job?.authorityDigest).toMatch(/^raud_[a-f0-9]{64}$/);
  expect(job?.authorityEnvelope).toMatchObject({
    version: 1,
    authorityDigest: job?.authorityDigest,
    configuration: {
      requestGeneration: 1,
      policyGeneration: 1,
    },
    observationFence: { kind: "revision", key: input.revisionKey },
  });
  expect(job?.authorityEnvelope?.publicationSubjectKey).toMatch(
    /^rsub_[a-f0-9]{64}$/,
  );
  expect(job?.authorityEnvelope?.subjectIncarnationKey).toMatch(
    /^rinc_[a-f0-9]{64}$/,
  );
  expect(job?.authorityEnvelope?.stableEffectKey).toMatch(/^rfx_[a-f0-9]{64}$/);
  const lifecycleFence = job?.authorityEnvelope?.eligibilityFences.find(
    ({ kind }) => kind === "lifecycle",
  );
  expect(lifecycleFence).toMatchObject({
    kind: "lifecycle",
    eligible: input.eligible ?? true,
  });
  expect(job?.authorityEnvelope?.configuration.lifecycleGeneration).toBe(
    lifecycleFence?.eligibilityGeneration,
  );
};

const actor = (confect: TestConfect.TestConfect<typeof databaseSchema>) =>
  confect.withIdentity(editorIdentity);

const callRows = buildCallSourceUnitRows(
  {
    providerKey: "fireflies",
    connectionKey: "conn_page_publication_call",
    externalCallId: "page_publication_call",
    externalRevisionId: "page_publication_revision",
    revisionOrder: {
      kind: "provider_timestamp",
      timestamp: "2026-08-05T14:30:00.000Z",
      source: "updated_at",
    },
    title: "Publication conformance call",
    startedAt: "2026-08-05T14:00:00.000Z",
    endedAt: "2026-08-05T14:30:00.000Z",
    durationMs: 1_800_000,
    organizer: null,
    participants: [],
    segments: [
      {
        externalSegmentId: "page_publication_call:0",
        ordinal: 0,
        evidenceKind: "verbatim_transcript",
        speakerExternalId: null,
        speakerLabel: "Buyer",
        startMs: 0,
        endMs: 2_000,
        text: "The launch is approved for Friday.",
      },
    ],
    sourceUrl: "https://example.test/page-publication-call",
    recordingUrl: null,
    providerSummary: null,
    providerMetadataJson: "{}",
    deleted: false,
  },
  { organizationKey, connectionGeneration: 1, receivedAt: seedTime },
);
const callSegment = callRows.segments[0];
if (callSegment === undefined)
  throw new TypeError("Expected the call fixture to contain one segment.");

const callPageKey = "pag_call_publication_overview";
const callRevisionKey = "rev_call_publication_overview_1";
const seedCallMaintenance = Effect.gen(function* () {
  const seeded = yield* seedEditorBrain;
  const writer = yield* DatabaseWriter;
  yield* writer.table("sourceUnits").insert(callRows.unit).pipe(Effect.orDie);
  yield* writer
    .table("sourceUnitRevisions")
    .insert(callRows.revision)
    .pipe(Effect.orDie);
  yield* writer.table("sourceSegments").insert(callSegment).pipe(Effect.orDie);
  yield* writer
    .table("callRoutingProposals")
    .insert({
      schemaVersion: 1,
      organizationKey,
      proposalKey: "callroute_page_publication",
      unitKey: callRows.unit.unitKey,
      unitRevisionKey: callRows.revision.unitRevisionKey,
      sourceLifecycleGeneration: 1,
      routeGeneration: 4,
      outcome: "routed",
      brainKey,
      candidateBrainKeys: [brainKey],
      reason: "review_accept",
      status: "accepted",
      createdAt: seedTime,
      updatedAt: seedTime,
    })
    .pipe(Effect.orDie);
  const lifecycle = {
    state: "active" as const,
    generation: 2,
    updatedAt: seedTime,
    purgeAfter: null,
  };
  yield* writer
    .table("brainPages")
    .insert({
      workspaceId: seeded.workspaceId,
      organizationId: seeded.organizationId,
      slug: "overview",
      title: "Overview",
      markdown: "# Overview\n\nCurrent context.",
      sourceKind: "markdown",
      updatedAt: seedTime,
      pageKey: callPageKey,
      parentPageKey: null,
      siblingSlug: "overview",
      sortKey: "0000000001",
      favorite: false,
      status: "active",
      currentRevisionKey: callRevisionKey,
      lifecycle,
      createdAt: seedTime,
      schemaVersion: 1,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("pageRevisions")
    .insert({
      workspaceId: seeded.workspaceId,
      organizationId: seeded.organizationId,
      pageKey: callPageKey,
      revisionKey: callRevisionKey,
      priorRevisionKey: null,
      blockNoteJson: "{}",
      markdown: "# Overview\n\nCurrent context.",
      contentHash: "sha256:call-publication-seed",
      causation: "migration",
      actor: { kind: "migration", id: "test" },
      modelReceiptKey: null,
      effectKey: "seed:call-publication-overview",
      state: "published",
      lifecycle: { ...lifecycle, generation: 1 },
      createdAt: seedTime,
      schemaVersion: 1,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("brainMaintenanceProposals")
    .insert({
      workspaceId: seeded.workspaceId,
      brainKey,
      pageKey: callPageKey,
      proposalKey: "brainmaint_page_publication",
      status: "awaiting_review",
      expectedRevisionKey: callRevisionKey,
      routeGeneration: 4,
      lifecycleGeneration: 1,
      policyGeneration: 7,
      modelPromptPair: "openrouter/test@call-maintenance-v1",
      citationKeys: [`cite_${callSegment.segmentKey}`],
      unitKey: callRows.unit.unitKey,
      unitRevisionKey: callRows.revision.unitRevisionKey,
      workspaceLifecycleGeneration: 1,
      modelReceiptKey: "mine_page_publication_call",
      summary: "Friday launch approved.",
      itemCount: 1,
      idempotencyKey: "mine_page_publication_call",
      createdAt: seedTime,
      updatedAt: seedTime,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("brainMaintenanceProposalItems")
    .insert({
      workspaceId: seeded.workspaceId,
      brainKey,
      proposalKey: "brainmaint_page_publication",
      itemKey: "brainmaintitem_page_publication",
      pageKey: callPageKey,
      expectedRevisionKey: callRevisionKey,
      pageLifecycleGeneration: 2,
      title: "Overview",
      markdown: "# Overview\n\nLaunch Friday.",
      citationKeys: [`cite_${callSegment.segmentKey}`],
      status: "awaiting_review",
      createdAt: seedTime,
      updatedAt: seedTime,
    })
    .pipe(Effect.orDie);
  return seeded;
});

describe("public page publication conformance", () => {
  it("keeps an explicit inventory of every public page-write mutation", () => {
    expect(PUBLIC_PAGE_WRITE_SURFACES).toEqual([
      "brain.pages.create",
      "brain.pages.rename",
      "brain.pages.move",
      "brain.pages.favorite",
      "brain.pages.archive",
      "brain.pages.restore",
      "brain.pilot.reviewNote:approve",
      "brain.pilot.updatePage",
      "brain.callReview.reviewCallMaintenance:accept|edit",
      "access.provisioning.createClientBrain",
    ]);
  });

  it("atomically persists a page, revision, and authority-bound job for every pages mutation", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(seedEditorBrain, resultSchema());
        const editor = actor(confect);
        const writes: Array<{
          before: PublicationState;
          after: PublicationState;
          pageKey: string;
          revisionKey: string;
          pageDelta: 0 | 1;
          eligible?: boolean;
        }> = [];
        const snapshot = () =>
          confect.run(
            readPublicationState(seeded.workspaceId),
            PublicationStateSchema,
          );

        let before = yield* snapshot();
        const created = yield* editor.mutation(refs.public.brain.pages.create, {
          brainKey,
          parentPageKey: null,
          siblingSlug: "company-context",
          sortKey: "0000000001",
          title: "Company context",
          markdown: "# Company context\n\nInitial publication.",
          expectedCurrentRevisionKey: null,
        });
        let after = yield* snapshot();
        writes.push({
          before,
          after,
          pageKey: created.pageKey,
          revisionKey: created.currentRevisionKey ?? "missing",
          pageDelta: 1,
        });

        before = after;
        const renamed = yield* editor.mutation(refs.public.brain.pages.rename, {
          brainKey,
          pageKey: created.pageKey,
          expectedCurrentRevisionKey: created.currentRevisionKey ?? "missing",
          title: "Renamed company context",
        });
        after = yield* snapshot();
        writes.push({
          before,
          after,
          pageKey: renamed.pageKey,
          revisionKey: renamed.currentRevisionKey ?? "missing",
          pageDelta: 0,
        });

        before = after;
        const moved = yield* editor.mutation(refs.public.brain.pages.move, {
          brainKey,
          pageKey: renamed.pageKey,
          expectedCurrentRevisionKey: renamed.currentRevisionKey ?? "missing",
          parentPageKey: null,
          sortKey: "0000000002",
        });
        after = yield* snapshot();
        writes.push({
          before,
          after,
          pageKey: moved.pageKey,
          revisionKey: moved.currentRevisionKey ?? "missing",
          pageDelta: 0,
        });

        before = after;
        const favored = yield* editor.mutation(
          refs.public.brain.pages.favorite,
          {
            brainKey,
            pageKey: moved.pageKey,
            expectedCurrentRevisionKey: moved.currentRevisionKey ?? "missing",
            favorite: true,
          },
        );
        after = yield* snapshot();
        writes.push({
          before,
          after,
          pageKey: favored.pageKey,
          revisionKey: favored.currentRevisionKey ?? "missing",
          pageDelta: 0,
        });

        before = after;
        const restored = yield* editor.mutation(
          refs.public.brain.pages.restore,
          {
            brainKey,
            pageKey: favored.pageKey,
            expectedCurrentRevisionKey: favored.currentRevisionKey ?? "missing",
            revisionKey: created.currentRevisionKey ?? "missing",
          },
        );
        after = yield* snapshot();
        writes.push({
          before,
          after,
          pageKey: restored.pageKey,
          revisionKey: restored.currentRevisionKey ?? "missing",
          pageDelta: 0,
        });

        before = after;
        const archived = yield* editor.mutation(
          refs.public.brain.pages.archive,
          {
            brainKey,
            pageKey: restored.pageKey,
            expectedCurrentRevisionKey:
              restored.currentRevisionKey ?? "missing",
          },
        );
        after = yield* snapshot();
        writes.push({
          before,
          after,
          pageKey: archived.pageKey,
          revisionKey: archived.currentRevisionKey ?? "missing",
          pageDelta: 0,
          eligible: false,
        });
        return writes;
      }).pipe(Effect.provide(testConfectLayer())),
    );

    for (const write of result) expectAtomicPagePublication(write);
  });

  it("publishes approved notes and pilot page edits through the same durable contract", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(seedEditorBrain, resultSchema());
        const editor = actor(confect);
        const submitted = yield* editor.mutation(
          refs.public.brain.pilot.submitNote,
          {
            brainKey,
            title: "Pilot publication",
            markdown: "A reviewed note becomes durable evidence.",
          },
        );
        const beforeApproval = yield* confect.run(
          readPublicationState(seeded.workspaceId),
          PublicationStateSchema,
        );
        yield* editor.mutation(refs.public.brain.pilot.reviewNote, {
          brainKey,
          sourceKey: submitted.sourceKey,
          decision: "approve",
        });
        const afterApproval = yield* confect.run(
          readPublicationState(seeded.workspaceId),
          PublicationStateSchema,
        );
        const approvedPage = afterApproval.pages.find(
          ({ sourceKind }) => sourceKind === "note",
        );
        if (
          approvedPage === undefined ||
          approvedPage.pageKey === undefined ||
          approvedPage.currentRevisionKey == null
        )
          throw new Error(
            "Approved note did not create a current page revision.",
          );
        const updated = yield* editor.mutation(
          refs.public.brain.pilot.updatePage,
          {
            brainKey,
            pageKey: approvedPage.pageKey,
            expectedCurrentRevisionKey: approvedPage.currentRevisionKey,
            markdown: "The reviewed note remains durable after editing.",
          },
        );
        const afterUpdate = yield* confect.run(
          readPublicationState(seeded.workspaceId),
          PublicationStateSchema,
        );
        return {
          approval: {
            before: beforeApproval,
            after: afterApproval,
            pageKey: approvedPage.pageKey,
            revisionKey: approvedPage.currentRevisionKey,
            pageDelta: 1 as const,
          },
          update: {
            before: afterApproval,
            after: afterUpdate,
            pageKey: updated.pageKey,
            revisionKey: updated.currentRevisionKey ?? "missing",
            pageDelta: 0 as const,
          },
        };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expectAtomicPagePublication(result.approval);
    expectAtomicPagePublication(result.update);
  });

  it("publishes accepted call-maintenance edits through the durable contract", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(seedCallMaintenance, resultSchema());
        const editor = actor(confect);
        const before = yield* confect.run(
          readPublicationState(seeded.workspaceId),
          PublicationStateSchema,
        );
        yield* editor.mutation(
          refs.public.brain.callReview.reviewCallMaintenance,
          {
            brainKey,
            proposalKey: "brainmaint_page_publication",
            action: "accept",
            attemptKey: "maintenance_page_publication_attempt",
            expectedRouteGeneration: 4,
            expectedSourceLifecycleGeneration: 1,
            expectedWorkspaceLifecycleGeneration: 1,
            edits: [],
          },
        );
        const after = yield* confect.run(
          readPublicationState(seeded.workspaceId),
          PublicationStateSchema,
        );
        const page = after.pages.find(({ pageKey }) => pageKey === callPageKey);
        if (
          page === undefined ||
          page.pageKey === undefined ||
          page.currentRevisionKey == null
        )
          throw new Error(
            "Call maintenance did not create a current revision.",
          );
        return { before, after, revisionKey: page.currentRevisionKey };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expectAtomicPagePublication({
      ...result,
      pageKey: callPageKey,
      pageDelta: 0,
    });
  });

  it("publishes every seeded client Brief page in the provisioning transaction", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const identity = {
          subject: "workos|publication-admin",
          name: "Publication admin",
          email: "publication-admin@example.com",
          emailVerified: true,
          organizationId: "org_workos_publication_admin",
        } as const;
        const admin = confect.withIdentity(identity);
        yield* admin.mutation(
          refs.public.access.provisioning.ensureProvisioned,
          {},
        );
        const created = yield* admin.mutation(
          refs.public.access.provisioning.createClientBrain,
          {
            name: "Publication client",
            clientSlug: "publication-client",
            idempotencyKey: "publication-client-01",
          },
        );
        return yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const organization = yield* reader
              .table("organizations")
              .index("by_workos_organization", (query) =>
                query.eq("workosOrganizationId", identity.organizationId),
              )
              .first()
              .pipe(Effect.orDie);
            if (organization._tag === "None")
              throw new Error("Provisioned organization was not durable.");
            const workspaces = yield* reader
              .table("workspaces")
              .index("by_organization_brain_key", (query) =>
                query
                  .eq("organizationId", organization.value._id)
                  .eq("brainKey", created.brainKey),
              )
              .collect()
              .pipe(Effect.orDie);
            const workspace = workspaces[0];
            if (workspace === undefined)
              throw new Error("Provisioned client workspace was not durable.");
            return {
              created,
              organizationKey: organization.value.agencyKey,
              state: yield* readPublicationState(
                workspace._id,
                created.brainKey,
              ),
            };
          }),
          resultSchema(),
        );
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.state.pages).toHaveLength(result.created.pages.length);
    expect(result.state.revisions).toHaveLength(result.created.pages.length);
    expect(result.state.jobs).toHaveLength(result.created.pages.length);
    if (result.organizationKey === undefined)
      throw new Error("Provisioned organization has no stable agency key.");
    for (const page of result.state.pages) {
      if (page.pageKey === undefined || page.currentRevisionKey == null)
        throw new Error(`Seeded page ${page.pageKey} has no current revision.`);
      expectAtomicPagePublication({
        before: { pages: [], revisions: [], jobs: [] },
        after: {
          pages: [page],
          revisions: result.state.revisions.filter(
            ({ pageKey }) => pageKey === page.pageKey,
          ),
          jobs: result.state.jobs.filter(
            ({ sourceKey }) => sourceKey === page.pageKey,
          ),
        },
        pageKey: page.pageKey,
        revisionKey: page.currentRevisionKey,
        pageDelta: 1,
        expectedBrainKey: result.created.brainKey,
        expectedOrganizationKey: result.organizationKey,
      });
    }
  });

  it("rolls back failed writes without orphaning a page, revision, or job", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(seedEditorBrain, resultSchema());
        const before = yield* confect.run(
          readPublicationState(seeded.workspaceId),
          PublicationStateSchema,
        );
        const failure = yield* actor(confect)
          .mutation(refs.public.brain.pages.create, {
            brainKey,
            parentPageKey: null,
            siblingSlug: "must-not-exist",
            sortKey: "0000000001",
            title: "Must not exist",
            markdown: "A stale create cannot leak partial state.",
            expectedCurrentRevisionKey: "rev_stale_create",
          })
          .pipe(Effect.flip);
        const after = yield* confect.run(
          readPublicationState(seeded.workspaceId),
          PublicationStateSchema,
        );
        return { before, after, failure };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.failure).toMatchObject({ _tag: "StaleRevision" });
    expect(result.after).toEqual(result.before);
  });

  it("recovers a durable job when its original scheduler delivery is lost", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(seedEditorBrain, resultSchema());
        const created = yield* actor(confect).mutation(
          refs.public.brain.pages.create,
          {
            brainKey,
            parentPageKey: null,
            siblingSlug: "scheduler-recovery",
            sortKey: "0000000001",
            title: "Scheduler recovery",
            markdown: "The durable job outlives its first delivery.",
            expectedCurrentRevisionKey: null,
          },
        );
        const beforeSweep = yield* confect.run(
          readPublicationState(seeded.workspaceId),
          PublicationStateSchema,
        );
        const swept = yield* confect.run(
          sweepPublicationJobsEffect({
            caller: {
              kind: "system",
              name: "page-publication-conformance-sweeper",
              surface: "internal",
            },
            now: Date.now(),
            limit: 10,
          }),
          resultSchema(),
        );
        return { created, beforeSweep, swept };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    const job = result.beforeSweep.jobs.find(
      ({ sourceRevisionKey }) =>
        sourceRevisionKey === result.created.currentRevisionKey,
    );
    expect(job).toMatchObject({ status: "pending", attemptCount: 0 });
    expect(result.swept).toEqual({
      scheduled: 1,
      jobKeys: [job?.jobKey],
    });
  });
});
