import { TestConfect } from "@confect/test";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import refs from "../confect/_generated/refs";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { publishPageRevisionEffect } from "../confect/brain/retrievalPublication.impl";
import { rebuildPageBatchEffect } from "../confect/brain/retrievalPublication.impl";
import {
  enqueueRetrievalPublicationJobEffect,
  publishSlackRevisionEffect,
  publishTranscriptRevisionEffect,
  rebuildSlackBatchEffect,
  rebuildTranscriptBatchEffect,
  runPublicationJobEffect,
  sweepPublicationJobsEffect,
} from "../confect/brain/retrievalPublication.impl";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const organizationKey = `ag_${brainKey.slice(3)}`;
const pageKey = "pag_company_context";
const revisionKey = "rev_company_context_1";

// TestConfect decodes heterogeneous setup/effect payloads through this harness.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AnyResult = Schema.Any as unknown as Schema.Schema<any>;

const seedPage = Effect.gen(function* () {
  const writer = yield* DatabaseWriter;
  const userId = yield* writer
    .table("users")
    .insert({
      subject: "publisher",
      email: "publisher@example.com",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const organizationId = yield* writer
    .table("organizations")
    .insert({
      ownerUserId: userId,
      workosOrganizationId: "org_publisher",
      agencyKey: organizationKey,
      slug: "apero",
      name: "Apero",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const workspaceId = yield* writer
    .table("workspaces")
    .insert({
      organizationId,
      ownerUserId: userId,
      brainKey,
      name: "Apero Brain",
      slug: "apero-brain",
      kind: "agency",
      status: "active",
      dataClassification: "internal",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("organizationMembers")
    .insert({
      organizationId,
      userId,
      role: "viewer",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("workspaceMembers")
    .insert({
      workspaceId,
      userId,
      role: "viewer",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const lifecycle = {
    state: "active" as const,
    generation: 1,
    updatedAt: now,
    purgeAfter: null,
  };
  yield* writer
    .table("brainPages")
    .insert({
      workspaceId,
      organizationId,
      slug: "company-context",
      title: "Company Context",
      markdown:
        "# ICP\n\nApero helps agencies build qualified pipeline.\n\n## Economics\n\nRevenue follows close rate.",
      sourceKind: "markdown",
      updatedAt: now,
      pageKey,
      parentPageKey: null,
      siblingSlug: "company-context",
      sortKey: "0000000001",
      favorite: false,
      status: "active",
      currentRevisionKey: revisionKey,
      lifecycle,
      createdAt: now,
      schemaVersion: 1,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("pageRevisions")
    .insert({
      workspaceId,
      organizationId,
      pageKey,
      revisionKey,
      priorRevisionKey: null,
      blockNoteJson: "",
      markdown:
        "# ICP\n\nApero helps agencies build qualified pipeline.\n\n## Economics\n\nRevenue follows close rate.",
      contentHash: "page-hash-1",
      causation: "import",
      actor: { kind: "migration", id: "apero-bootstrap" },
      modelReceiptKey: null,
      effectKey: "apero-bootstrap:1",
      state: "published",
      lifecycle,
      createdAt: now,
      schemaVersion: 1,
    })
    .pipe(Effect.orDie);
  return { organizationId, workspaceId };
});

const publicationArgs = (workspaceId: GenericId<"workspaces">) => ({
  organizationKey,
  workspaceId,
  brainKey,
  pageKey,
  revisionKey,
  authority: "derived" as const,
  authorityPolicyKey: "company-pages",
  policyGeneration: 1,
  caller: {
    kind: "system" as const,
    name: "retrieval-publication-test",
    surface: "internal" as const,
  },
  now,
});

describe("retrieval publication persistence", () => {
  it("atomically publishes an exact page revision and is idempotent", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedPage,
          AnyResult,
        );
        const first = yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          AnyResult,
        );
        const duplicate = yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          AnyResult,
        );
        const search = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "qualified pipeline economics",
          },
        );
        const publicReader = confect.withIdentity({
          subject: "publisher",
          email: "publisher@example.com",
          emailVerified: true,
          workosOrganizationId: "org_publisher",
        });
        const publicSearch = yield* publicReader.query(
          refs.public.brain.readApi.sourcesSearch,
          { brainKey, query: "qualified pipeline economics" },
        );
        const context = yield* confect.query(
          refs.internal.brain.readApi.headlessContextGet,
          {
            organizationId,
            workspaceId,
            brainKey,
            question: "What is the pipeline economics model?",
          },
        );
        const firstResult = search.results[0];
        if (firstResult === undefined) throw new Error("missing search result");
        const source = yield* publicReader.query(
          refs.public.brain.readApi.sourcesGet,
          {
            brainKey,
            publicationSetKey: firstResult.publicationSetKey,
            entryKey: firstResult.entryKey,
          },
        );
        const missingTuple = yield* confect
          .query(refs.internal.brain.readApi.headlessSourcesGet, {
            organizationId,
            workspaceId,
            brainKey,
            entryKey: firstResult.entryKey,
          })
          .pipe(Effect.flip);
        const stored = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const sets = yield* reader
              .table("retrievalPublicationSets")
              .index("by_workspace_brain_state_publication_set", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("state", "current"),
              )
              .collect()
              .pipe(Effect.orDie);
            const entries = yield* reader
              .table("retrievalEntries")
              .index("by_workspace_brain_state_entry", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("state", "published"),
              )
              .collect()
              .pipe(Effect.orDie);
            return { sets, entries };
          }),
          AnyResult,
        );
        return {
          first,
          duplicate,
          search,
          publicSearch,
          source,
          missingTuple,
          context,
          stored,
        };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.first).toMatchObject({
      outcome: "published",
      publicationGeneration: 1,
      entryCount: 1,
    });
    expect(result.duplicate).toEqual({
      ...result.first,
      outcome: "duplicate",
    });
    expect(result.stored.sets).toHaveLength(1);
    expect(result.stored.entries).toHaveLength(1);
    expect(result.stored.entries[0]).toMatchObject({
      brainKey,
      sourceKey: pageKey,
      sourceRevisionKey: revisionKey,
      origin: { kind: "page", pageKey, revisionKey },
      state: "published",
    });
    expect(result.search.results).toEqual([
      expect.objectContaining({
        sourceKey: pageKey,
        sourceRevisionKey: revisionKey,
        entryKey: expect.stringMatching(/^rent_/),
        publicationSetKey: result.first.publicationSetKey,
        passageKey: expect.stringMatching(/^rpass_/),
        contentHash: expect.stringMatching(/^sha256:/),
        authority: "derived",
        freshness: "stale",
        citationKey: `citation:${result.first.publicationSetKey}:${result.search.results[0]?.entryKey}`,
      }),
    ]);
    expect(result.publicSearch).toEqual(result.search);
    expect(result.source).toMatchObject({
      publicationSetKey: result.first.publicationSetKey,
      entryKey: result.search.results[0]?.entryKey,
      excerpt:
        "# ICP\n\nApero helps agencies build qualified pipeline.\n\n## Economics\n\nRevenue follows close rate.",
      status: "published",
    });
    expect(result.missingTuple).toMatchObject({
      _tag: "ValidationFailed",
      field: "publicationSetKey",
    });
    expect(result.context).toMatchObject({
      organizationKey,
      brainKey,
      question: "What is the pipeline economics model?",
      freshness: { status: "stale" },
      entries: [
        {
          sourceRevisionKey: revisionKey,
          entryKey: result.search.results[0]?.entryKey,
          publicationSetKey: result.first.publicationSetKey,
          passageKey: result.search.results[0]?.passageKey,
        },
      ],
      coverage: [{ sourceKind: "brain-pages", status: "partial" }],
    });
  });

  it("does not publish a stale revision", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, AnyResult);
        return yield* confect.run(
          publishPageRevisionEffect({
            ...publicationArgs(workspaceId),
            revisionKey: "rev_not_current",
          }),
          AnyResult,
        );
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toEqual({ outcome: "stale", entryCount: 0, tokenCount: 0 });
  });

  it("replaces the current revision without exposing the retired set", async () => {
    const nextRevisionKey = "rev_company_context_2";
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedPage,
          AnyResult,
        );
        const first = yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          AnyResult,
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const page = yield* reader
              .table("brainPages")
              .index("by_workspace_page_key", (query) =>
                query.eq("workspaceId", workspaceId).eq("pageKey", pageKey),
              )
              .first()
              .pipe(Effect.orDie);
            if (page._tag === "None") throw new Error("missing page");
            const lifecycle = {
              state: "active" as const,
              generation: 2,
              updatedAt: now + 1,
              purgeAfter: null,
            };
            yield* writer
              .table("pageRevisions")
              .insert({
                workspaceId,
                organizationId,
                pageKey,
                revisionKey: nextRevisionKey,
                priorRevisionKey: revisionKey,
                blockNoteJson: "",
                markdown:
                  "# ICP\n\nApero helps agencies build durable qualified pipeline and stronger economics.",
                contentHash: "page-hash-2",
                causation: "human-edit",
                actor: { kind: "user", id: "publisher" },
                modelReceiptKey: null,
                effectKey: "page-edit:2",
                state: "published",
                lifecycle,
                createdAt: now + 1,
                schemaVersion: 1,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("brainPages")
              .patch(page.value._id, {
                currentRevisionKey: nextRevisionKey,
                markdown:
                  "# ICP\n\nApero helps agencies build durable qualified pipeline and stronger economics.",
                lifecycle,
                updatedAt: now + 1,
              })
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        const second = yield* confect.run(
          publishPageRevisionEffect({
            ...publicationArgs(workspaceId),
            revisionKey: nextRevisionKey,
            now: now + 1,
          }),
          AnyResult,
        );
        const search = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "durable pipeline economics",
          },
        );
        const sets = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            return yield* reader
              .table("retrievalPublicationSets")
              .index("by_workspace_brain_source_state_generation", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("originTable", "pageRevisions")
                  .eq("sourceKey", pageKey),
              )
              .collect()
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        return { first, second, search, sets };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.first.publicationGeneration).toBe(1);
    expect(result.second).toMatchObject({
      outcome: "published",
      publicationGeneration: 2,
    });
    expect(result.search.results).toEqual([
      expect.objectContaining({ sourceRevisionKey: nextRevisionKey }),
    ]);
    expect(
      result.sets.map(({ state }: { state: string }) => state).sort(),
    ).toEqual(["current", "retired"]);
  });

  it("keeps a policy-only republication searchable and removes retired postings", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedPage,
          AnyResult,
        );
        const first = yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          AnyResult,
        );
        const second = yield* confect.run(
          publishPageRevisionEffect({
            ...publicationArgs(workspaceId),
            authority: "authoritative",
            authorityPolicyKey: "company-pages-reviewed",
            policyGeneration: 2,
            now: now + 1,
          }),
          AnyResult,
        );
        const search = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "qualified pipeline economics",
          },
        );
        const currentResult = search.results[0];
        if (currentResult === undefined)
          throw new Error("missing search result");
        const currentSource = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesGet,
          {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: currentResult.publicationSetKey,
            entryKey: currentResult.entryKey,
          },
        );
        const retiredSource = yield* confect
          .query(refs.internal.brain.readApi.headlessSourcesGet, {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: first.publicationSetKey,
            entryKey: currentResult.entryKey,
          })
          .pipe(Effect.flip);
        const stored = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const tokens = yield* reader
              .table("retrievalTokens")
              .index("by_workspace_entry", (query) =>
                query.eq("workspaceId", workspaceId),
              )
              .collect()
              .pipe(Effect.orDie);
            const entries = yield* reader
              .table("retrievalEntries")
              .index("by_workspace_brain_publication_set_entry", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .collect()
              .pipe(Effect.orDie);
            return { tokens, entries };
          }),
          AnyResult,
        );
        return { first, second, search, currentSource, retiredSource, stored };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.second).toMatchObject({
      outcome: "published",
      publicationGeneration: 2,
      entryCount: result.first.entryCount,
      tokenCount: result.first.tokenCount,
    });
    expect(result.search.results).toEqual([
      expect.objectContaining({
        sourceRevisionKey: revisionKey,
        authority: "authoritative",
        authorityPolicyKey: "company-pages-reviewed",
      }),
    ]);
    expect(result.search.results[0]?.entryKey).toBe(
      result.currentSource.entryKey,
    );
    expect(result.currentSource.publicationSetKey).toBe(
      result.second.publicationSetKey,
    );
    expect(result.retiredSource).toMatchObject({
      _tag: "ValidationFailed",
      field: "publicationSetKey",
    });
    expect(
      new Set(
        result.stored.tokens.map(
          ({ publicationSetKey }: { publicationSetKey: string }) =>
            publicationSetKey,
        ),
      ),
    ).toEqual(new Set([result.second.publicationSetKey]));
    expect(result.stored.entries).toHaveLength(2);
    expect(
      new Set(
        result.stored.entries.map(
          ({ entryKey }: { entryKey: string }) => entryKey,
        ),
      ),
    ).toEqual(new Set([result.search.results[0]?.entryKey]));
  });

  it("rejects copied projection text that no longer matches the page ledger", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedPage,
          AnyResult,
        );
        yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          AnyResult,
        );
        const search = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "qualified pipeline",
          },
        );
        const entry = search.results[0];
        if (entry === undefined) throw new Error("missing search result");
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const stored = yield* reader
              .table("retrievalEntries")
              .index("by_workspace_brain_publication_set_entry", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("publicationSetKey", entry.publicationSetKey)
                  .eq("entryKey", entry.entryKey),
              )
              .first()
              .pipe(Effect.orDie);
            if (stored._tag === "None") throw new Error("missing entry");
            yield* writer
              .table("retrievalEntries")
              .patch(stored.value._id, { text: "corrupted projection text" })
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        return yield* confect
          .query(refs.internal.brain.readApi.headlessSourcesGet, {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: entry.publicationSetKey,
            entryKey: entry.entryKey,
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toMatchObject({
      _tag: "CitationIntegrityFailure",
      reason: "content_mismatch",
    });
  });

  it("persists a missing-origin failure and succeeds on a later sweep retry", async () => {
    const delayedRevisionKey = "rev_company_context_delayed";
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId, organizationId } = yield* confect.run(
          seedPage,
          AnyResult,
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const page = yield* reader
              .table("brainPages")
              .index("by_workspace_page_key", (query) =>
                query.eq("workspaceId", workspaceId).eq("pageKey", pageKey),
              )
              .first()
              .pipe(Effect.orDie);
            if (page._tag === "None") throw new Error("missing page");
            yield* writer
              .table("brainPages")
              .patch(page.value._id, {
                currentRevisionKey: delayedRevisionKey,
              })
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        const jobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "page",
              sourceKey: pageKey,
              sourceRevisionKey: delayedRevisionKey,
              requestGeneration: 2,
              page: {
                authority: "derived",
                authorityPolicyKey: "company-pages",
                policyGeneration: 1,
              },
            },
            now,
          ),
          AnyResult,
        );
        const swept = yield* confect.run(
          sweepPublicationJobsEffect({
            limit: 5,
            caller: {
              kind: "system",
              name: "publication-sweeper-test",
              surface: "internal",
            },
            now,
          }),
          AnyResult,
        );
        const first = yield* confect.run(
          runPublicationJobEffect({
            jobKey,
            caller: {
              kind: "system",
              name: "publication-job-test",
              surface: "internal",
            },
            now,
          }),
          AnyResult,
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const page = yield* reader
              .table("brainPages")
              .index("by_workspace_page_key", (query) =>
                query.eq("workspaceId", workspaceId).eq("pageKey", pageKey),
              )
              .first()
              .pipe(Effect.orDie);
            if (page._tag === "None") throw new Error("missing page");
            const lifecycle = {
              state: "active" as const,
              generation: 2,
              updatedAt: now + 1,
              purgeAfter: null,
            };
            yield* writer
              .table("pageRevisions")
              .insert({
                workspaceId,
                organizationId,
                pageKey,
                revisionKey: delayedRevisionKey,
                priorRevisionKey: revisionKey,
                blockNoteJson: "",
                markdown:
                  "# ICP\n\nDelayed evidence is now durable and searchable.",
                contentHash: "page-hash-delayed",
                causation: "human-edit",
                actor: { kind: "user", id: "publisher" },
                modelReceiptKey: null,
                effectKey: "page-edit:delayed",
                state: "published",
                lifecycle,
                createdAt: now + 1,
                schemaVersion: 1,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("brainPages")
              .patch(page.value._id, {
                markdown:
                  "# ICP\n\nDelayed evidence is now durable and searchable.",
                lifecycle,
                updatedAt: now + 1,
              })
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        const second = yield* confect.run(
          runPublicationJobEffect({
            jobKey,
            caller: {
              kind: "system",
              name: "publication-job-test",
              surface: "internal",
            },
            now: first.nextAttemptAt,
          }),
          AnyResult,
        );
        return { swept, first, second };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.swept).toEqual({
      scheduled: 1,
      jobKeys: [result.first.jobKey],
    });
    expect(result.first).toMatchObject({
      status: "retry_wait",
      attemptCount: 1,
      lastErrorTag: "RetrievalOriginUnavailable",
    });
    expect(result.second).toMatchObject({
      status: "succeeded",
      attemptCount: 2,
    });
  });

  it("revokes current retrieval when the page is archived", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedPage,
          AnyResult,
        );
        yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          AnyResult,
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const page = yield* reader
              .table("brainPages")
              .index("by_workspace_page_key", (query) =>
                query.eq("workspaceId", workspaceId).eq("pageKey", pageKey),
              )
              .first()
              .pipe(Effect.orDie);
            if (page._tag === "None") throw new Error("missing page");
            yield* writer
              .table("brainPages")
              .patch(page.value._id, {
                status: "archived",
                lifecycle: {
                  state: "archived",
                  generation: 2,
                  updatedAt: now + 1,
                  purgeAfter: null,
                },
              })
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        const revoked = yield* confect.run(
          publishPageRevisionEffect({
            ...publicationArgs(workspaceId),
            now: now + 1,
          }),
          AnyResult,
        );
        const search = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "qualified pipeline",
          },
        );
        return { revoked, search };
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.revoked).toEqual({
      outcome: "revoked",
      entryCount: 0,
      tokenCount: 0,
    });
    expect(result.search.results).toEqual([]);
  });

  it("rebuilds active pages in bounded batches", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, AnyResult);
        return yield* confect.run(
          rebuildPageBatchEffect({
            organizationKey,
            workspaceId,
            brainKey,
            limit: 1,
            caller: {
              kind: "system",
              name: "rebuild-test",
              surface: "internal",
            },
            now,
          }),
          AnyResult,
        );
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toMatchObject({
      processed: 1,
      published: 1,
      hasMore: false,
      nextAfterPageKey: pageKey,
    });
  });

  it("continues a durable page rebuild until every batch succeeds", async () => {
    const secondPageKey = "pag_company_context_z";
    const secondRevisionKey = "rev_company_context_2";
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId, organizationId } = yield* confect.run(
          seedPage,
          AnyResult,
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            const lifecycle = {
              state: "active" as const,
              generation: 1,
              updatedAt: now,
              purgeAfter: null,
            };
            yield* writer
              .table("brainPages")
              .insert({
                workspaceId,
                organizationId,
                slug: "company-context-two",
                title: "Company Context Two",
                markdown: "# Market\n\nApero serves growth-minded agencies.",
                sourceKind: "markdown",
                updatedAt: now,
                pageKey: secondPageKey,
                parentPageKey: null,
                siblingSlug: "company-context-two",
                sortKey: "0000000002",
                favorite: false,
                status: "active",
                currentRevisionKey: secondRevisionKey,
                lifecycle,
                createdAt: now,
                schemaVersion: 1,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("pageRevisions")
              .insert({
                workspaceId,
                organizationId,
                pageKey: secondPageKey,
                revisionKey: secondRevisionKey,
                priorRevisionKey: null,
                blockNoteJson: "",
                markdown: "# Market\n\nApero serves growth-minded agencies.",
                contentHash: "page-hash-2",
                causation: "import",
                actor: { kind: "migration", id: "apero-bootstrap" },
                modelReceiptKey: null,
                effectKey: "apero-bootstrap:2",
                state: "published",
                lifecycle,
                createdAt: now,
                schemaVersion: 1,
              })
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        const firstJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "page_rebuild",
              sourceKey: "corpus:pages",
              sourceRevisionKey: "rebuild:1",
              requestGeneration: 1,
              rebuild: { limit: 1 },
            },
            now,
          ),
          AnyResult,
        );
        const first = yield* confect.run(
          runPublicationJobEffect({
            jobKey: firstJobKey,
            caller: {
              kind: "system",
              name: "page-rebuild-test",
              surface: "internal",
            },
            now,
          }),
          AnyResult,
        );
        const nextJobKey = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const jobs = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_origin_target", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("originKind", "page_rebuild")
                  .eq("sourceRevisionKey", "rebuild:1"),
              )
              .take(3)
              .pipe(Effect.orDie);
            const pending = jobs.find(({ status }) => status === "pending");
            if (pending === undefined) throw new Error("missing continuation");
            return pending.jobKey;
          }),
          AnyResult,
        );
        const second = yield* confect.run(
          runPublicationJobEffect({
            jobKey: nextJobKey,
            caller: {
              kind: "system",
              name: "page-rebuild-test",
              surface: "internal",
            },
            now,
          }),
          AnyResult,
        );
        const publishedEntries = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            return yield* reader
              .table("retrievalEntries")
              .index("by_workspace_brain_state_entry", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("state", "published"),
              )
              .take(10)
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        return { first, second, publishedEntries };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.first).toMatchObject({
      status: "succeeded",
      attemptCount: 1,
    });
    expect(result.second).toMatchObject({
      status: "succeeded",
      attemptCount: 1,
    });
    expect(
      new Set(
        result.publishedEntries.map(
          ({ sourceKey }: { sourceKey: string }) => sourceKey,
        ),
      ),
    ).toEqual(new Set([pageKey, secondPageKey]));
  });

  it("publishes a routed Slack revision with its immutable origin", async () => {
    const sourceKey = "src_slack.message.1";
    const sourceRevisionKey = `srev_${"a".repeat(64)}`;
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedPage,
          AnyResult,
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            const lifecycle = {
              state: "active" as const,
              generation: 1,
              updatedAt: now,
              purgeAfter: null,
            };
            yield* writer
              .table("providerConnections")
              .insert({
                provider: "nango",
                providerConfigKey: "slack",
                organizationKey,
                connectionKey: "conn_slack",
                connectionGeneration: 1,
                status: "active",
                connectSessionId: "session_slack",
                nangoConnectionId: "nango_slack",
                nangoEndUserId: "user_slack",
                nangoOrganizationId: "org_slack",
                correlationTag: "slack:test",
                attemptId: "attempt_slack",
                attemptExpiresAt: now + 60_000,
                completedAt: now,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("sourceArtifacts")
              .insert({
                schemaVersion: 1,
                organizationKey,
                connectionKey: "conn_slack",
                connectionGeneration: 1,
                channelKey: "channel_sales",
                externalChannelId: "C_SALES",
                providerObjectId: "C_SALES:1",
                sourceKey,
                threadKey: "thread_1",
                latestSourceRevisionKey: sourceRevisionKey,
                latestProviderOrder: "1",
                lifecycle,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("sourceRevisions")
              .insert({
                schemaVersion: 1,
                organizationKey,
                connectionKey: "conn_slack",
                connectionGeneration: 1,
                channelKey: "channel_sales",
                sourceKey,
                sourceRevisionKey,
                observationKey: "observation_1",
                providerOrder: "1",
                providerRevisionId: "1",
                sourceCreatedAt: now,
                sourceTimestamp: "2026-08-21T10:00:00.000Z",
                authorSnapshot: {
                  providerUserId: "U_1",
                  displayName: "Apero teammate",
                },
                normalizedText:
                  "Our ICP is agencies that need a repeatable qualified pipeline.",
                blocksJson: "[]",
                permalink: "https://slack.example/archives/C_SALES/p1",
                contentHash: `sha256:${"b".repeat(64)}`,
                tombstone: false,
                lifecycle,
                createdAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("channelRoutingPolicies")
              .insert({
                organizationKey,
                connectionKey: "conn_slack",
                connectionGeneration: 1,
                channelKey: "channel_sales",
                policyEpoch: 1,
                active: true,
                mode: "direct",
                targetBrainKeys: [brainKey],
                historicalBackfillStartAt: now - 1_000,
                statusAfterApply: "streaming",
                createdByRole: "owner",
                createdAt: now,
              })
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        const published = yield* confect.run(
          publishSlackRevisionEffect({
            organizationKey,
            workspaceId,
            brainKey,
            sourceRevisionKey,
            caller: {
              kind: "system",
              name: "slack-test",
              surface: "internal",
            },
            now,
          }),
          AnyResult,
        );
        const search = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "repeatable qualified pipeline",
          },
        );
        const resultEntry = search.results[0];
        if (resultEntry === undefined) throw new Error("missing Slack result");
        const source = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesGet,
          {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: resultEntry.publicationSetKey,
            entryKey: resultEntry.entryKey,
          },
        );
        const rebuilt = yield* confect.run(
          rebuildSlackBatchEffect({
            organizationKey,
            workspaceId,
            brainKey,
            limit: 1,
            caller: {
              kind: "system",
              name: "slack-rebuild-test",
              surface: "internal",
            },
            now: now + 1,
          }),
          AnyResult,
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const connection = yield* reader
              .table("providerConnections")
              .index("by_connection_key", (query) =>
                query.eq("connectionKey", "conn_slack"),
              )
              .first()
              .pipe(Effect.orDie);
            if (connection._tag === "None")
              throw new Error("missing connection");
            yield* writer
              .table("providerConnections")
              .patch(connection.value._id, {
                status: "revoked",
                updatedAt: now + 2,
              })
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        const revoked = yield* confect.run(
          publishSlackRevisionEffect({
            organizationKey,
            workspaceId,
            brainKey,
            sourceRevisionKey,
            caller: {
              kind: "system",
              name: "slack-revoke-test",
              surface: "internal",
            },
            now: now + 2,
          }),
          AnyResult,
        );
        const afterRevocation = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "repeatable qualified pipeline",
          },
        );
        return { published, search, source, rebuilt, revoked, afterRevocation };
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.published).toMatchObject({
      outcome: "published",
      entryCount: 1,
    });
    expect(result.search.results).toEqual([
      expect.objectContaining({
        sourceRevisionKey,
        kind: "source",
        locator: "https://slack.example/archives/C_SALES/p1",
        authority: "advisory",
      }),
    ]);
    expect(result.source).toMatchObject({
      publicationSetKey: result.published.publicationSetKey,
      sourceRevisionKey,
      excerpt: "Our ICP is agencies that need a repeatable qualified pipeline.",
      locator: "https://slack.example/archives/C_SALES/p1",
      status: "published",
    });
    expect(result.rebuilt).toMatchObject({
      processed: 1,
      published: 1,
      revoked: 0,
      hasMore: false,
      nextAfterSourceKey: sourceKey,
    });
    expect(result.revoked).toMatchObject({ outcome: "revoked" });
    expect(result.afterRevocation.results).toEqual([]);
  });

  it("publishes every segment from an accepted transcript route", async () => {
    const unitKey = `sunit_${"c".repeat(64)}`;
    const unitRevisionKey = `surev_${"d".repeat(64)}`;
    const segmentKey = `seg_${"e".repeat(64)}`;
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedPage,
          AnyResult,
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            yield* writer
              .table("providerConnections")
              .insert({
                provider: "nango",
                providerConfigKey: "fireflies",
                organizationKey,
                connectionKey: "conn_calls",
                connectionGeneration: 1,
                status: "active",
                connectSessionId: "session_calls",
                nangoConnectionId: "nango_calls",
                nangoEndUserId: "user_calls",
                nangoOrganizationId: "org_calls",
                correlationTag: "calls:test",
                attemptId: "attempt_calls",
                attemptExpiresAt: now + 60_000,
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
                connectionKey: "conn_calls",
                connectionGeneration: 1,
                providerKey: "fireflies",
                externalCallId: "call_1",
                unitKey,
                currentUnitRevisionKey: unitRevisionKey,
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
                unitKey,
                unitRevisionKey,
                externalRevisionId: "call_revision_1",
                title: "Pipeline review",
                startedAt: "2026-08-21T10:00:00.000Z",
                endedAt: "2026-08-21T10:30:00.000Z",
                durationMs: 1_800_000,
                organizer: null,
                participants: [],
                sourceUrl: "https://calls.example/call_1",
                recordingUrl: null,
                providerSummary: null,
                providerMetadataJson: "{}",
                contentHash: `sha256:${"f".repeat(64)}`,
                tombstone: false,
                createdAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("sourceSegments")
              .insert({
                schemaVersion: 1,
                organizationKey,
                unitKey,
                unitRevisionKey,
                segmentKey,
                externalSegmentId: "segment_1",
                ordinal: 0,
                evidenceKind: "verbatim_transcript",
                speakerExternalId: null,
                speakerLabel: "Founder",
                startMs: 0,
                endMs: 2_000,
                text: "The close-rate target is thirty percent for qualified pipeline.",
                contentHash: `sha256:${"1".repeat(64)}`,
                createdAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("callRoutingProposals")
              .insert({
                schemaVersion: 1,
                organizationKey,
                proposalKey: "callroute_1",
                unitKey,
                unitRevisionKey,
                sourceLifecycleGeneration: 1,
                routeGeneration: 1,
                outcome: "routed",
                brainKey,
                candidateBrainKeys: [brainKey],
                reason: "explicit",
                status: "accepted",
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        const published = yield* confect.run(
          publishTranscriptRevisionEffect({
            organizationKey,
            workspaceId,
            brainKey,
            sourceRevisionKey: unitRevisionKey,
            caller: {
              kind: "system",
              name: "transcript-test",
              surface: "internal",
            },
            now,
          }),
          AnyResult,
        );
        const context = yield* confect.query(
          refs.internal.brain.readApi.headlessContextGet,
          {
            organizationId,
            workspaceId,
            brainKey,
            question: "What is the qualified pipeline close-rate target?",
          },
        );
        const resultEntry = context.entries[0];
        if (resultEntry === undefined)
          throw new Error("missing transcript result");
        const source = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesGet,
          {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: resultEntry.publicationSetKey,
            entryKey: resultEntry.entryKey,
          },
        );
        const rebuilt = yield* confect.run(
          rebuildTranscriptBatchEffect({
            organizationKey,
            workspaceId,
            brainKey,
            limit: 1,
            caller: {
              kind: "system",
              name: "transcript-rebuild-test",
              surface: "internal",
            },
            now: now + 1,
          }),
          AnyResult,
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const connection = yield* reader
              .table("providerConnections")
              .index("by_connection_key", (query) =>
                query.eq("connectionKey", "conn_calls"),
              )
              .first()
              .pipe(Effect.orDie);
            if (connection._tag === "None")
              throw new Error("missing connection");
            yield* writer
              .table("providerConnections")
              .patch(connection.value._id, {
                connectionGeneration: 2,
                updatedAt: now + 2,
              })
              .pipe(Effect.orDie);
          }),
          AnyResult,
        );
        const revoked = yield* confect.run(
          publishTranscriptRevisionEffect({
            organizationKey,
            workspaceId,
            brainKey,
            sourceRevisionKey: unitRevisionKey,
            caller: {
              kind: "system",
              name: "transcript-generation-test",
              surface: "internal",
            },
            now: now + 2,
          }),
          AnyResult,
        );
        const afterGenerationChange = yield* confect.query(
          refs.internal.brain.readApi.headlessContextGet,
          {
            organizationId,
            workspaceId,
            brainKey,
            question: "What is the qualified pipeline close-rate target?",
          },
        );
        return {
          published,
          context,
          source,
          rebuilt,
          revoked,
          afterGenerationChange,
        };
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.published).toMatchObject({
      outcome: "published",
      entryCount: 1,
    });
    expect(result.context.entries).toEqual([
      expect.objectContaining({
        sourceRevisionKey: unitRevisionKey,
        unitKey,
        segmentKey,
        locator: `https://calls.example/call_1#segment=${segmentKey}`,
      }),
    ]);
    expect(result.source).toMatchObject({
      publicationSetKey: result.published.publicationSetKey,
      sourceRevisionKey: unitRevisionKey,
      unitKey,
      segmentKey,
      excerpt:
        "The close-rate target is thirty percent for qualified pipeline.",
      locator: `https://calls.example/call_1#segment=${segmentKey}`,
      status: "published",
    });
    expect(result.rebuilt).toMatchObject({
      processed: 1,
      published: 1,
      revoked: 0,
      hasMore: false,
      nextAfterSourceKey: unitKey,
    });
    expect(result.revoked).toMatchObject({ outcome: "revoked" });
    expect(result.afterGenerationChange.entries).toEqual([]);
  });
});
