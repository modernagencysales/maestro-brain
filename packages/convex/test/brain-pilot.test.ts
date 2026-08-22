import { TestConfect } from "@confect/test";
import type { GenericId, Value } from "convex/values";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import { Id } from "../confect/_generated/id";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import type {
  BrainPagesDoc,
  CitationsDoc,
  PageRevisionsDoc,
} from "../confect/_generated/docs";
import type { Role } from "../confect/access/roles";
import { Forbidden } from "../confect/errors";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";

type SeededBrain = {
  readonly organizationId: GenericId<"organizations">;
  readonly workspaceId: GenericId<"workspaces">;
};

const SeededBrainSchema = Schema.Struct({
  organizationId: Id("organizations"),
  workspaceId: Id("workspaces"),
});

const seedBrain = (input: {
  readonly role: Role;
  readonly subject: string;
  readonly email: string;
  readonly brainKey: string;
}): Effect.Effect<SeededBrain, never, DatabaseWriter> =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const userId = yield* writer
      .table("users")
      .insert({
        subject: input.subject,
        email: input.email,
        displayName: input.subject,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: userId,
        name: input.brainKey,
        slug: input.brainKey.toLowerCase(),
        status: "active",
        workosOrganizationId: `org_${input.subject}`,
        agencyKey: `ag_${input.brainKey.slice(3)}`,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("organizationMembers")
      .insert({
        organizationId,
        userId,
        role: input.role,
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const workspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: userId,
        brainKey: input.brainKey,
        name: input.brainKey,
        slug: `${input.brainKey.toLowerCase()}-workspace`,
        status: "active",
        dataClassification: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaceMembers")
      .insert({
        workspaceId,
        userId,
        role: input.role,
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return { organizationId, workspaceId };
  });

const actor = (
  confect: TestConfect.TestConfect<typeof databaseSchema>,
  subject: string,
  email: string,
) =>
  confect.withIdentity({
    subject,
    email,
    emailVerified: true,
    workosOrganizationId: `org_${subject}`,
  });

type WithoutConvexMetadata<T> = Omit<T, "_id" | "_creationTime">;

type PublishedStateValue = {
  readonly pages: WithoutConvexMetadata<BrainPagesDoc>[];
  readonly revisions: WithoutConvexMetadata<PageRevisionsDoc>[];
  readonly citations: WithoutConvexMetadata<CitationsDoc>[];
};

const PublishedState = Schema.Any as unknown as Schema.Schema<
  PublishedStateValue,
  Value,
  never
>;

const publishedState = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const pages = yield* reader
      .table("brainPages")
      .index("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect()
      .pipe(Effect.orDie);
    const revisions = yield* reader
      .table("pageRevisions")
      .index("by_page_created", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("pageKey", pages[0]?.pageKey ?? "missing"),
      )
      .collect()
      .pipe(Effect.orDie);
    const citations = yield* reader
      .table("citations")
      .index("by_workspace", (q) => q.eq("workspaceId", String(workspaceId)))
      .collect()
      .pipe(Effect.orDie);
    return {
      pages: pages.map(({ _id, _creationTime, ...row }) => {
        void _id;
        void _creationTime;
        return {
          ...row,
          workspaceId: row.workspaceId as GenericId<"workspaces">,
        };
      }),
      revisions: revisions.map(({ _id, _creationTime, ...row }) => {
        void _id;
        void _creationTime;
        return row;
      }),
      citations: citations.map(({ _id, _creationTime, ...row }) => {
        void _id;
        void _creationTime;
        return row;
      }),
    };
  });

const transcriptKeys = {
  unitKey: `sunit_${"a".repeat(64)}`,
  unitRevisionKey: `surev_${"b".repeat(64)}`,
  segmentKey: `seg_${"c".repeat(64)}`,
  connectionKey: "conn_fireflies_1",
} as const;

const seedTranscriptCitation = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly pageKey: string;
  readonly pageRevisionKey: string;
  readonly manual?: boolean;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const organizationKey = `ag_${brainKey.slice(3)}`;
    const connectionKey = input.manual
      ? `manual_${organizationKey}`
      : transcriptKeys.connectionKey;
    const connectionGeneration = input.manual ? 1 : 2;
    const citation = yield* reader
      .table("citations")
      .index("by_workspace_page", (query) =>
        query
          .eq("workspaceId", String(input.workspaceId))
          .eq("pageKey", input.pageKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (citation === null) throw new Error("expected approved note citation");
    if (!input.manual)
      yield* writer
        .table("providerConnections")
        .insert({
          provider: "nango",
          providerConfigKey: "fireflies",
          organizationKey,
          connectionKey,
          connectionGeneration,
          status: "active",
          connectSessionId: "session_transcript_1",
          nangoConnectionId: "nango_transcript_1",
          nangoEndUserId: "end_user_transcript_1",
          nangoOrganizationId: "nango_org_transcript_1",
          correlationTag: "transcript:session_1",
          attemptId: "attempt_transcript_1",
          attemptExpiresAt: now + 10_000,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    yield* writer
      .table("sourceUnits")
      .insert({
        schemaVersion: 1,
        organizationKey,
        connectionKey,
        connectionGeneration,
        providerKey: input.manual ? "manual-transcript" : "fireflies",
        externalCallId: "call_1",
        unitKey: transcriptKeys.unitKey,
        currentUnitRevisionKey: transcriptKeys.unitRevisionKey,
        lifecycle: {
          state: "active",
          generation: 1,
          updatedAt: now,
          purgeAfter: null,
        },
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("sourceUnitRevisions")
      .insert({
        schemaVersion: 1,
        organizationKey,
        unitKey: transcriptKeys.unitKey,
        unitRevisionKey: transcriptKeys.unitRevisionKey,
        externalRevisionId: "revision_1",
        title: "Acme weekly",
        startedAt: "2026-08-05T14:00:00.000Z",
        endedAt: "2026-08-05T14:30:00.000Z",
        durationMs: 1_800_000,
        organizer: null,
        participants: [],
        sourceUrl: "https://app.fireflies.ai/view/call_1",
        recordingUrl: null,
        providerSummary: null,
        providerMetadataJson: "{}",
        contentHash: `sha256:${"d".repeat(64)}`,
        tombstone: false,
        createdAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("sourceSegments")
      .insert({
        schemaVersion: 1,
        organizationKey,
        unitKey: transcriptKeys.unitKey,
        unitRevisionKey: transcriptKeys.unitRevisionKey,
        segmentKey: transcriptKeys.segmentKey,
        externalSegmentId: "call_1:0",
        ordinal: 0,
        evidenceKind: "verbatim_transcript",
        speakerExternalId: "speaker_1",
        speakerLabel: "Alex",
        startMs: 12_000,
        endMs: 15_400,
        text: "We will launch on Friday.",
        contentHash: `sha256:${"e".repeat(64)}`,
        createdAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("citations")
      .patch(citation._id, {
        sourceId: transcriptKeys.unitKey,
        sourceKind: "call_transcript",
        sourceTitle: "Acme weekly",
        quotedText: "We will launch on Friday.",
        startOffset: 0,
        endOffset: 25,
        pageKey: input.pageKey,
        revisionKey: input.pageRevisionKey,
        sourceUnitRevisionKey: transcriptKeys.unitRevisionKey,
        segmentKey: transcriptKeys.segmentKey,
        startMs: 12_000,
        endMs: 15_400,
      })
      .pipe(Effect.orDie);
    return true;
  });

const revokeTranscriptConnection = Effect.gen(function* () {
  const reader = yield* DatabaseReader;
  const writer = yield* DatabaseWriter;
  const connection = yield* reader
    .table("providerConnections")
    .index("by_connection_key", (query) =>
      query.eq("connectionKey", transcriptKeys.connectionKey),
    )
    .first()
    .pipe(Effect.map(Option.getOrNull), Effect.orDie);
  if (connection === null) throw new Error("expected transcript connection");
  yield* writer
    .table("providerConnections")
    .patch(connection._id, { status: "revoked", updatedAt: now + 1 })
    .pipe(Effect.orDie);
  return true;
});

describe("Brain pilot contract", () => {
  it("keeps submitted notes pending until an editor approves them", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "editor",
            email: "editor@example.com",
            brainKey,
          }),
          SeededBrainSchema,
        );
        const editor = actor(confect, "editor", "editor@example.com");
        const submitted = yield* editor.mutation(
          refs.public.brain.pilot.submitNote,
          {
            brainKey,
            title: "Founder interview",
            markdown: "The product is source-backed.",
          },
        );
        const reviewed = yield* editor.mutation(
          refs.public.brain.pilot.reviewNote,
          {
            brainKey,
            sourceKey: submitted.sourceKey,
            decision: "approve",
          },
        );
        const state = yield* confect.run(
          publishedState(seeded.workspaceId),
          PublishedState,
        );
        return { submitted, reviewed, ...state };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.submitted.status).toBe("pending_review");
    expect(result.reviewed).toEqual({
      sourceKey: result.submitted.sourceKey,
      status: "published",
    });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({
      title: "Founder interview",
      markdown: "The product is source-backed.",
      sourceKind: "note",
      status: "active",
    });
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({
      pageKey: result.pages[0]?.pageKey,
      revisionKey: result.pages[0]?.currentRevisionKey,
      markdown: "The product is source-backed.",
      state: "published",
    });
    expect(result.citations).toEqual([
      expect.objectContaining({
        citationId: `citation:${result.submitted.sourceKey}`,
        sourceId: result.submitted.sourceKey,
        pageKey: result.pages[0]?.pageKey,
        revisionKey: result.pages[0]?.currentRevisionKey,
      }),
    ]);
  });

  it("rejects review and prevents rejected notes from search", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "rejector",
            email: "rejector@example.com",
            brainKey,
          }),
          SeededBrainSchema,
        );
        const editor = actor(confect, "rejector", "rejector@example.com");
        const submitted = yield* editor.mutation(
          refs.public.brain.pilot.submitNote,
          {
            brainKey,
            title: "Secret",
            markdown: "Should not be searchable.",
          },
        );
        const rejected = yield* editor.mutation(
          refs.public.brain.pilot.reviewNote,
          {
            brainKey,
            sourceKey: submitted.sourceKey,
            decision: "reject",
          },
        );
        const search = yield* editor.query(refs.public.brain.pilot.search, {
          brainKey,
          query: "searchable",
        });
        const state = yield* confect.run(
          publishedState(seeded.workspaceId),
          PublishedState,
        );
        return { rejected, search, ...state };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.rejected.status).toBe("rejected");
    expect(result.search.results).toEqual([]);
    expect(result.pages).toEqual([]);
    expect(result.citations).toEqual([]);
  });

  it("updates the approved page and searches its current cited revision", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "page-editor",
            email: "page-editor@example.com",
            brainKey,
          }),
          SeededBrainSchema,
        );
        const editor = actor(confect, "page-editor", "page-editor@example.com");
        const submitted = yield* editor.mutation(
          refs.public.brain.pilot.submitNote,
          {
            brainKey,
            title: "Editable note",
            markdown: "Original text.",
          },
        );
        yield* editor.mutation(refs.public.brain.pilot.reviewNote, {
          brainKey,
          sourceKey: submitted.sourceKey,
          decision: "approve",
        });
        const before = yield* confect.run(
          publishedState(seeded.workspaceId),
          PublishedState,
        );
        const page = before.pages[0];
        if (
          page === undefined ||
          page.pageKey === undefined ||
          page.currentRevisionKey === undefined ||
          page.currentRevisionKey === null
        )
          throw new Error("Published page is incomplete");
        const updated = yield* editor.mutation(
          refs.public.brain.pilot.updatePage,
          {
            brainKey,
            pageKey: page.pageKey,
            expectedCurrentRevisionKey: page.currentRevisionKey,
            markdown: "Edited text.",
          },
        );
        const after = yield* confect.run(
          publishedState(seeded.workspaceId),
          PublishedState,
        );
        const search = yield* editor.query(refs.public.brain.pilot.search, {
          brainKey,
          query: "edited",
        });
        return { before, updated, after, search };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.after.pages).toHaveLength(1);
    expect(result.after.pages[0]?.pageKey).toBe(
      result.before.pages[0]?.pageKey,
    );
    expect(result.after.pages[0]?.markdown).toBe("Edited text.");
    expect(result.after.pages[0]?.currentRevisionKey).not.toBe(
      result.before.pages[0]?.currentRevisionKey,
    );
    expect(result.after.revisions).toHaveLength(2);
    expect(result.after.citations[0]).toMatchObject({
      pageKey: result.after.pages[0]?.pageKey,
      revisionKey: result.after.pages[0]?.currentRevisionKey,
      quotedText: "Edited text.",
    });
    expect(result.updated.currentRevisionKey).toBe(
      result.after.pages[0]?.currentRevisionKey,
    );
    expect(result.search.results).toEqual([
      expect.objectContaining({
        sourceKey: result.search.results[0]?.sourceKey,
        title: "Editable note",
        excerpt: "Edited text.",
        citationKey: `citation:${result.search.results[0]?.sourceKey}`,
      }),
    ]);
  });

  it("returns deterministic citations and isolates tenants", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "tenant-a",
            email: "tenant-a@example.com",
            brainKey,
          }),
        );
        yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "tenant-b",
            email: "tenant-b@example.com",
            brainKey: "br_1123456789ABCDEFGHJKMNPQRS",
          }),
        );
        const tenantA = actor(confect, "tenant-a", "tenant-a@example.com");
        const submitted = yield* tenantA.mutation(
          refs.public.brain.pilot.submitNote,
          {
            brainKey,
            title: "Alpha",
            markdown: "Shared phrase.",
          },
        );
        yield* tenantA.mutation(refs.public.brain.pilot.reviewNote, {
          brainKey,
          sourceKey: submitted.sourceKey,
          decision: "approve",
        });
        const first = yield* tenantA.query(refs.public.brain.pilot.search, {
          brainKey,
          query: "shared",
        });
        const second = yield* tenantA.query(refs.public.brain.pilot.search, {
          brainKey,
          query: "shared",
        });
        const tenantB = actor(confect, "tenant-b", "tenant-b@example.com");
        const isolated = yield* tenantB.query(refs.public.brain.pilot.search, {
          brainKey: "br_1123456789ABCDEFGHJKMNPQRS",
          query: "shared",
        });
        return { first, second, isolated };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.first).toEqual(result.second);
    expect(result.first.results[0]).toMatchObject({
      citationKey: `citation:${result.first.results[0]?.sourceKey}`,
      title: "Alpha",
      excerpt: "Shared phrase.",
    });
    expect(result.isolated.results).toEqual([]);
  });

  it("reads exact live transcript citations and hides them after revocation", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "transcript-reader",
            email: "transcript-reader@example.com",
            brainKey,
          }),
          SeededBrainSchema,
        );
        yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "transcript-isolated",
            email: "transcript-isolated@example.com",
            brainKey: "br_2123456789ABCDEFGHJKMNPQRS",
          }),
          SeededBrainSchema,
        );
        const editor = actor(
          confect,
          "transcript-reader",
          "transcript-reader@example.com",
        );
        const submitted = yield* editor.mutation(
          refs.public.brain.pilot.submitNote,
          {
            brainKey,
            title: "Call-backed brief",
            markdown: "We will launch on Friday.",
          },
        );
        yield* editor.mutation(refs.public.brain.pilot.reviewNote, {
          brainKey,
          sourceKey: submitted.sourceKey,
          decision: "approve",
        });
        const state = yield* confect.run(
          publishedState(seeded.workspaceId),
          PublishedState,
        );
        const page = state.pages[0];
        if (!page?.pageKey || !page.currentRevisionKey)
          throw new Error("expected published page");
        yield* confect.run(
          seedTranscriptCitation({
            workspaceId: seeded.workspaceId,
            pageKey: page.pageKey,
            pageRevisionKey: page.currentRevisionKey,
          }),
          Schema.Boolean,
        );
        yield* editor.mutation(refs.public.brain.pilot.updatePage, {
          brainKey,
          pageKey: page.pageKey,
          expectedCurrentRevisionKey: page.currentRevisionKey,
          markdown: "Friday launch remains on track.",
        });
        const search = yield* editor.query(refs.public.brain.pilot.search, {
          brainKey,
          query: "launch",
        });
        const ask = yield* editor.query(refs.public.brain.pilot.ask, {
          brainKey,
          query: "launch",
        });
        const apiSearchDefault = yield* editor.query(
          refs.public.brain.readApi.sourcesSearch,
          { brainKey, query: "launch" },
        );
        const apiSearch = yield* editor.query(
          refs.public.brain.readApi.sourcesSearch,
          { brainKey, query: "launch", compatibilityMode: "legacy" },
        );
        const apiGet = yield* editor.query(
          refs.public.brain.readApi.sourcesGet,
          {
            brainKey,
            sourceRevisionKey: transcriptKeys.unitRevisionKey,
            compatibilityMode: "legacy",
          },
        );
        const apiGetDefault = yield* editor.query(
          refs.public.brain.readApi.sourcesGet,
          {
            brainKey,
            sourceRevisionKey: transcriptKeys.unitRevisionKey,
          },
        );
        const legacySourceAvailable = yield* editor
          .query(refs.public.brain.readApi.sourcesGet, {
            brainKey,
            sourceRevisionKey: submitted.sourceKey,
            compatibilityMode: "legacy",
          })
          .pipe(
            Effect.as(true),
            Effect.catchAll(() => Effect.succeed(false)),
          );
        const context = yield* editor.query(
          refs.public.brain.readApi.contextGet,
          {
            brainKey,
            pageKeys: [page.pageKey],
            compatibilityMode: "legacy",
          },
        );
        const contextDefault = yield* editor.query(
          refs.public.brain.readApi.contextGet,
          {
            brainKey,
            pageKeys: [page.pageKey],
          },
        );
        const apiAsk = yield* editor.query(
          refs.public.brain.readApi.answersAsk,
          {
            brainKey,
            question: "launch",
          },
        );
        const isolated = yield* actor(
          confect,
          "transcript-isolated",
          "transcript-isolated@example.com",
        ).query(refs.public.brain.readApi.sourcesSearch, {
          brainKey: "br_2123456789ABCDEFGHJKMNPQRS",
          query: "launch",
        });
        yield* confect.run(revokeTranscriptConnection, Schema.Boolean);
        const afterRevoke = yield* editor.query(
          refs.public.brain.pilot.search,
          { brainKey, query: "launch" },
        );
        const apiAfterRevoke = yield* editor.query(
          refs.public.brain.readApi.sourcesSearch,
          { brainKey, query: "launch" },
        );
        const contextAfterRevoke = yield* editor.query(
          refs.public.brain.readApi.contextGet,
          {
            brainKey,
            pageKeys: [page.pageKey],
            compatibilityMode: "legacy",
          },
        );
        return {
          search,
          ask,
          apiSearch,
          apiSearchDefault,
          apiGet,
          apiGetDefault,
          legacySourceAvailable,
          context,
          contextDefault,
          apiAsk,
          isolated,
          afterRevoke,
          apiAfterRevoke,
          contextAfterRevoke,
        };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.search.results).toEqual([
      expect.objectContaining({
        sourceKey: transcriptKeys.unitKey,
        sourceRevisionKey: transcriptKeys.unitRevisionKey,
        locator: "timestamp:12000-15400",
        citationLabel: "Alex · 00:12",
        permalink: "https://app.fireflies.ai/view/call_1",
        excerpt: "We will launch on Friday.",
        freshness: "fresh",
        state: "resolved",
      }),
    ]);
    expect(result.ask.response).toMatchObject({
      status: "answered",
      evidence: [
        expect.objectContaining({ excerpt: "We will launch on Friday." }),
      ],
    });
    const transcriptResult = {
      sourceKey: transcriptKeys.unitKey,
      sourceRevisionKey: transcriptKeys.unitRevisionKey,
      title: "Acme weekly",
      excerpt: "We will launch on Friday.",
      locator: "timestamp:12000-15400",
      citationLabel: "Alex · 00:12",
      permalink: "https://app.fireflies.ai/view/call_1",
      freshness: "unknown",
      state: "resolved",
    };
    expect(result.apiSearch.results).toEqual([
      expect.objectContaining(transcriptResult),
    ]);
    expect(result.apiSearchDefault).toEqual(result.apiSearch);
    expect(result.apiGet).toMatchObject({
      ...transcriptResult,
      revisionKey: transcriptKeys.unitRevisionKey,
      status: "published",
    });
    expect(result.apiGetDefault).toEqual(result.apiGet);
    expect(result.legacySourceAvailable).toBe(false);
    expect(result.context.entries).toEqual([
      expect.objectContaining(transcriptResult),
    ]);
    expect(result.contextDefault).toMatchObject({
      brainKey: result.context.brainKey,
      organizationKey: result.context.organizationKey,
      question: result.context.question,
      freshness: result.context.freshness,
      coverage: result.context.coverage,
      entries: result.context.entries,
      omissions: result.context.omissions,
      conflicts: result.context.conflicts,
    });
    expect(result.apiAsk).toMatchObject({
      response: {
        status: "answered",
        evidence: [
          expect.objectContaining({
            citationKey: result.search.results[0]?.citationKey,
            excerpt: "We will launch on Friday.",
          }),
        ],
      },
    });
    expect(result.isolated.results).toEqual([]);
    expect(result.afterRevoke.results).toEqual([]);
    expect(result.apiAfterRevoke.results).toEqual([]);
    expect(result.contextAfterRevoke.entries).toEqual([]);
  });

  it("searches cited manual transcripts without an external provider connection", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "manual-transcript-reader",
            email: "manual-transcript-reader@example.com",
            brainKey,
          }),
          SeededBrainSchema,
        );
        const editor = actor(
          confect,
          "manual-transcript-reader",
          "manual-transcript-reader@example.com",
        );
        const submitted = yield* editor.mutation(
          refs.public.brain.pilot.submitNote,
          {
            brainKey,
            title: "Manual call-backed brief",
            markdown: "We will launch on Friday.",
          },
        );
        yield* editor.mutation(refs.public.brain.pilot.reviewNote, {
          brainKey,
          sourceKey: submitted.sourceKey,
          decision: "approve",
        });
        const state = yield* confect.run(
          publishedState(seeded.workspaceId),
          PublishedState,
        );
        const page = state.pages[0];
        if (!page?.pageKey || !page.currentRevisionKey)
          throw new Error("expected published page");
        yield* confect.run(
          seedTranscriptCitation({
            workspaceId: seeded.workspaceId,
            pageKey: page.pageKey,
            pageRevisionKey: page.currentRevisionKey,
            manual: true,
          }),
          Schema.Boolean,
        );
        return yield* editor.query(refs.public.brain.pilot.search, {
          brainKey,
          query: "launch",
        });
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.results).toEqual([
      expect.objectContaining({
        sourceKey: transcriptKeys.unitKey,
        sourceRevisionKey: transcriptKeys.unitRevisionKey,
        excerpt: "We will launch on Friday.",
        freshness: "fresh",
        state: "resolved",
      }),
    ]);
  });

  it("does not let retired postings consume the current retrieval budget", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(
          seedBrain({
            role: "viewer",
            subject: "capacity-reader",
            email: "capacity-reader@example.com",
            brainKey,
          }),
          SeededBrainSchema,
        );
        const currentTokenId = yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            const organizationKey = `ag_${brainKey.slice(3)}`;
            const retiredSetKey = `rset_${"a".repeat(64)}`;
            const currentSetKey = `rset_${"f".repeat(64)}`;
            const retiredEntryKey = `rent_${"a".repeat(64)}`;
            const currentEntryKey = `rent_${"f".repeat(64)}`;
            const baseSet = {
              schemaVersion: 1 as const,
              organizationKey,
              workspaceId: seeded.workspaceId,
              brainKey,
              corpusKey: "capacity-test",
              publicationGeneration: 1,
              originKind: "projection" as const,
              originTable: "brainSources",
              routeGeneration: 1,
              lifecycleGeneration: 1,
              policyGeneration: 1,
              expectedEntryCount: 1,
              expectedTokenCount: 1,
              manifestHash: `sha256:${"b".repeat(64)}`,
              createdAt: now,
            };
            yield* writer
              .table("retrievalPublicationSets")
              .insert({
                ...baseSet,
                publicationSetKey: retiredSetKey,
                sourceKey: "retired-capacity-source",
                sourceRevisionKey: "retired-capacity-revision",
                state: "retired",
                retiredAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("retrievalPublicationSets")
              .insert({
                ...baseSet,
                publicationSetKey: currentSetKey,
                sourceKey: "current-capacity-source",
                sourceRevisionKey: "current-capacity-revision",
                state: "current",
                activatedAt: now,
              })
              .pipe(Effect.orDie);
            const insertEntry = (input: {
              readonly publicationSetKey: string;
              readonly entryKey: string;
              readonly sourceKey: string;
              readonly sourceRevisionKey: string;
              readonly text: string;
              readonly fill: string;
            }) =>
              writer.table("retrievalEntries").insert({
                schemaVersion: 1,
                organizationKey,
                workspaceId: seeded.workspaceId,
                brainKey,
                publicationSetKey: input.publicationSetKey,
                publicationGeneration: 1,
                entryKey: input.entryKey,
                kind: "projection",
                corpusKey: "capacity-test",
                origin: {
                  kind: "projection",
                  projectionKey: input.sourceKey,
                  revisionKey: input.sourceRevisionKey,
                },
                originTable: "brainSources",
                sourceKey: input.sourceKey,
                sourceRevisionKey: input.sourceRevisionKey,
                passageKey: `rpass_${input.fill.repeat(64)}`,
                startOffset: 0,
                endOffset: input.text.length,
                title: input.text,
                headingPath: null,
                text: input.text,
                contentHash: `sha256:${input.fill.repeat(64)}`,
                observedAt: now,
                indexedAt: now,
                authority: "derived",
                authorityPolicyKey: "capacity-test",
                policyGeneration: 1,
                lifecycleGeneration: 1,
                routeGeneration: 1,
                state: "published",
              });
            yield* insertEntry({
              publicationSetKey: retiredSetKey,
              entryKey: retiredEntryKey,
              sourceKey: "retired-capacity-source",
              sourceRevisionKey: "retired-capacity-revision",
              text: "retired capacity evidence",
              fill: "a",
            }).pipe(Effect.orDie);
            yield* insertEntry({
              publicationSetKey: currentSetKey,
              entryKey: currentEntryKey,
              sourceKey: "current-capacity-source",
              sourceRevisionKey: "current-capacity-revision",
              text: "current capacity evidence",
              fill: "f",
            }).pipe(Effect.orDie);
            for (let index = 0; index < 1_001; index += 1)
              yield* writer
                .table("retrievalTokens")
                .insert({
                  schemaVersion: 1,
                  organizationKey,
                  workspaceId: seeded.workspaceId,
                  brainKey,
                  publicationSetKey: retiredSetKey,
                  publicationState: "retired",
                  tokenizerVersion: 1,
                  token: "capacity",
                  entryKey: retiredEntryKey,
                  authorityRank: 2,
                  termFrequency: 1,
                  inTitle: false,
                  inHeading: false,
                })
                .pipe(Effect.orDie);
            return yield* writer
              .table("retrievalTokens")
              .insert({
                schemaVersion: 1,
                organizationKey,
                workspaceId: seeded.workspaceId,
                brainKey,
                publicationSetKey: currentSetKey,
                publicationState: "current",
                tokenizerVersion: 1,
                token: "capacity",
                entryKey: currentEntryKey,
                authorityRank: 2,
                termFrequency: 1,
                inTitle: true,
                inHeading: false,
              })
              .pipe(Effect.orDie);
          }),
          Id("retrievalTokens"),
        );
        const classified = yield* confect.query(
          refs.internal.brain.readApi.validationSourcesSearch,
          {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey,
            query: "capacity",
          },
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            yield* writer
              .table("retrievalTokens")
              .delete(currentTokenId)
              .pipe(Effect.orDie);
            yield* writer
              .table("retrievalTokens")
              .insert({
                schemaVersion: 1,
                organizationKey: `ag_${brainKey.slice(3)}`,
                workspaceId: seeded.workspaceId,
                brainKey,
                publicationSetKey: `rset_${"f".repeat(64)}`,
                tokenizerVersion: 1,
                token: "capacity",
                entryKey: `rent_${"f".repeat(64)}`,
                authorityRank: 2,
                termFrequency: 1,
                inTitle: true,
                inHeading: false,
              })
              .pipe(Effect.orDie);
            return true;
          }),
          Schema.Boolean,
        );
        const legacy = yield* confect.query(
          refs.internal.brain.readApi.validationSourcesSearch,
          {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey,
            query: "capacity",
          },
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            for (let index = 0; index < 5_001; index += 1)
              yield* writer
                .table("retrievalTokens")
                .insert({
                  schemaVersion: 1,
                  organizationKey: `ag_${brainKey.slice(3)}`,
                  workspaceId: seeded.workspaceId,
                  brainKey,
                  publicationSetKey: `rset_${"f".repeat(64)}`,
                  publicationState: "current",
                  tokenizerVersion: 1,
                  token: "overflow",
                  entryKey: `rent_${"f".repeat(64)}`,
                  authorityRank: 2,
                  termFrequency: 1,
                  inTitle: false,
                  inHeading: false,
                })
                .pipe(Effect.orDie);
            return true;
          }),
          Schema.Boolean,
        );
        const overflow = yield* confect
          .query(refs.internal.brain.readApi.validationSourcesSearch, {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey,
            query: "overflow",
          })
          .pipe(
            Effect.match({
              onFailure: (error) => ({
                kind: "failure" as const,
                tag: error._tag,
                ...(error._tag === "RetrievalCapacityExceeded"
                  ? {
                      resource: error.resource,
                      limit: error.limit,
                      observedAtLeast: error.observedAtLeast,
                    }
                  : {}),
              }),
              onSuccess: () => ({ kind: "success" as const }),
            }),
          );
        return { classified, legacy, overflow };
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.classified.results).toEqual([
      expect.objectContaining({
        publicationSetKey: `rset_${"f".repeat(64)}`,
        sourceKey: "current-capacity-source",
        excerpt: "current capacity evidence",
      }),
    ]);
    expect(result.classified.omissions).toEqual([]);
    expect(result.legacy.results).toEqual(result.classified.results);
    expect(result.legacy.omissions).toEqual([]);
    expect(result.overflow).toMatchObject({
      kind: "failure",
      tag: "RetrievalCapacityExceeded",
      resource: "current_postings",
      limit: 5_000,
      observedAtLeast: 5_001,
    });
  });

  it("denies viewers from submitting or reviewing notes", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        yield* confect.run(
          seedBrain({
            role: "viewer",
            subject: "viewer",
            email: "viewer@example.com",
            brainKey,
          }),
        );
        const viewer = actor(confect, "viewer", "viewer@example.com");
        const submitted = yield* viewer
          .mutation(refs.public.brain.pilot.submitNote, {
            brainKey,
            title: "Nope",
            markdown: "Nope",
          })
          .pipe(Effect.flip);
        const reviewed = yield* viewer
          .mutation(refs.public.brain.pilot.reviewNote, {
            brainKey,
            sourceKey:
              "src_0000000000000000000000000000000000000000000000000000000000000000",
            decision: "approve",
          })
          .pipe(Effect.flip);
        return { submitted, reviewed };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.submitted).toBeInstanceOf(Forbidden);
    expect(result.reviewed).toBeInstanceOf(Forbidden);
  });
});
