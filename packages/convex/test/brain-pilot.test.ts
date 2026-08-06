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
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const organizationKey = `ag_${brainKey.slice(3)}`;
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
    yield* writer
      .table("providerConnections")
      .insert({
        provider: "nango",
        providerConfigKey: "fireflies",
        organizationKey,
        connectionKey: transcriptKeys.connectionKey,
        connectionGeneration: 2,
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
        connectionKey: transcriptKeys.connectionKey,
        connectionGeneration: 2,
        providerKey: "fireflies",
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
        const apiSearch = yield* editor.query(
          refs.public.brain.readApi.sourcesSearch,
          { brainKey, query: "launch" },
        );
        const apiGet = yield* editor.query(
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
          { brainKey, pageKeys: [page.pageKey] },
        );
        return {
          search,
          ask,
          apiSearch,
          apiGet,
          legacySourceAvailable,
          context,
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
      freshness: "fresh",
      state: "resolved",
    };
    expect(result.apiSearch.results).toEqual([
      expect.objectContaining(transcriptResult),
    ]);
    expect(result.apiGet).toMatchObject({
      ...transcriptResult,
      revisionKey: transcriptKeys.unitRevisionKey,
      status: "published",
    });
    expect(result.legacySourceAvailable).toBe(false);
    expect(result.context.entries).toEqual([
      expect.objectContaining(transcriptResult),
    ]);
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
