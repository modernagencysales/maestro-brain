import { TestConfect } from "@confect/test";
import type { GenericId, Value } from "convex/values";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import refs from "../confect/_generated/refs";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { publishPageRevisionEffect } from "../confect/brain/retrievalPublication.impl";
import { rebuildPageBatchEffect } from "../confect/brain/retrievalPublication.impl";
import {
  enqueueOrganizationCorpusRebuildsEffect,
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

// TestConfect needs a Convex-value encoder while the handler determines the
// decoded result type. Preserve that inferred type instead of widening every
// setup/effect result to `any`.
const resultSchema = <Result>(): Schema.Schema<Result, Value> =>
  Schema.Any as unknown as Schema.Schema<Result, Value>;

const expectCitationFailure = (value: unknown, reason: string) =>
  expect(value).toMatchObject({
    _tag: "Left",
    left: {
      _tag: "CitationIntegrityFailure",
      reason,
    },
  });

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
          resultSchema(),
        );
        const first = yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          resultSchema(),
        );
        const duplicate = yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          resultSchema(),
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
          resultSchema(),
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
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        return yield* confect.run(
          publishPageRevisionEffect({
            ...publicationArgs(workspaceId),
            revisionKey: "rev_not_current",
          }),
          resultSchema(),
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
          resultSchema(),
        );
        const first = yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          resultSchema(),
        );
        if (first.outcome !== "published") {
          throw new Error("expected initial page publication");
        }
        const beforeUpdate = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "qualified pipeline economics",
          },
        );
        const originalEntry = beforeUpdate.results[0];
        if (originalEntry === undefined)
          throw new Error("missing original entry");
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
          resultSchema(),
        );
        const second = yield* confect.run(
          publishPageRevisionEffect({
            ...publicationArgs(workspaceId),
            revisionKey: nextRevisionKey,
            now: now + 1,
          }),
          resultSchema(),
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
        const originalSource = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesGet,
          {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: first.publicationSetKey,
            entryKey: originalEntry.entryKey,
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
          resultSchema(),
        );
        return { first, second, search, originalSource, sets };
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
    expect(result.originalSource).toMatchObject({
      publicationSetKey: result.first.publicationSetKey,
      sourceRevisionKey: revisionKey,
      status: "superseded",
      excerpt: expect.stringContaining(
        "Apero helps agencies build qualified pipeline",
      ),
    });
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
          resultSchema(),
        );
        const first = yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          resultSchema(),
        );
        const second = yield* confect.run(
          publishPageRevisionEffect({
            ...publicationArgs(workspaceId),
            authority: "authoritative",
            authorityPolicyKey: "company-pages-reviewed",
            policyGeneration: 2,
            now: now + 1,
          }),
          resultSchema(),
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
        const retiredSource = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesGet,
          {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: first.publicationSetKey,
            entryKey: currentResult.entryKey,
          },
        );
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
          resultSchema(),
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
      publicationSetKey: result.first.publicationSetKey,
      sourceRevisionKey: revisionKey,
      status: "superseded",
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
          resultSchema(),
        );
        const published = yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          resultSchema(),
        );
        if (published.outcome !== "published") {
          throw new Error("expected page publication");
        }
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
          resultSchema(),
        );
        const sourceAttempt = yield* confect
          .query(refs.internal.brain.readApi.headlessSourcesGet, {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: entry.publicationSetKey,
            entryKey: entry.entryKey,
          })
          .pipe(Effect.either);
        const searchAttempt = yield* confect
          .query(refs.internal.brain.readApi.headlessSourcesSearch, {
            organizationId,
            workspaceId,
            brainKey,
            query: "qualified pipeline",
          })
          .pipe(Effect.either);
        const contextAttempt = yield* confect
          .query(refs.internal.brain.readApi.headlessContextGet, {
            organizationId,
            workspaceId,
            brainKey,
            question: "What is the qualified pipeline?",
          })
          .pipe(Effect.either);
        return { sourceAttempt, searchAttempt, contextAttempt };
      }).pipe(Effect.provide(testConfectLayer())),
    );
    for (const attempt of [
      result.sourceAttempt,
      result.searchAttempt,
      result.contextAttempt,
    ]) {
      expect(attempt).toMatchObject({
        _tag: "Left",
        left: {
          _tag: "CitationIntegrityFailure",
          reason: "content_mismatch",
        },
      });
    }
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
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

  it("fails page retrieval closed immediately when cleanup is lost", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedPage,
          resultSchema(),
        );
        const published = yield* confect.run(
          publishPageRevisionEffect(publicationArgs(workspaceId)),
          resultSchema(),
        );
        if (published.outcome !== "published") {
          throw new Error("expected page publication");
        }
        const beforeArchive = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "qualified pipeline",
          },
        );
        const entryKey = beforeArchive.results[0]?.entryKey;
        if (entryKey === undefined) throw new Error("missing page entry");
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
          resultSchema(),
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
        const sourceAttempt = yield* confect
          .query(refs.internal.brain.readApi.headlessSourcesGet, {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: published.publicationSetKey,
            entryKey,
          })
          .pipe(Effect.either);
        return { search, sourceAttempt };
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.search.results).toEqual([]);
    expect(Either.isLeft(result.sourceAttempt)).toBe(true);
    if (Either.isRight(result.sourceAttempt)) {
      throw new Error("expected archived citation to fail closed");
    }
    expect(result.sourceAttempt.left).toMatchObject({
      _tag: "CitationIntegrityFailure",
      reason: "origin_mismatch",
    });
  });

  it("rebuilds active pages in bounded batches", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
        );
        const state = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const publishedEntries = yield* reader
              .table("retrievalEntries")
              .index("by_workspace_brain_state_entry", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("state", "published"),
              )
              .take(10)
              .pipe(Effect.orDie);
            const health = yield* reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("corpusKey", "brain-pages")
                  .eq("connectorScopeKey", undefined),
              )
              .first()
              .pipe(Effect.orDie);
            return { publishedEntries, health };
          }),
          resultSchema(),
        );
        return { first, second, ...state };
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
    if (Option.isNone(result.health)) throw new Error("missing corpus health");
    expect(result.health.value).toMatchObject({
      coverageStatus: "complete",
      reconciliationGeneration: 1,
      lastReconciledAt: now,
      discoveredCount: 2,
      publishedCount: 2,
      failedCount: 0,
    });
  });

  it("records a terminal publication failure in corpus health", async () => {
    const missingRevisionKey = "rev_company_context_missing";
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
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
                currentRevisionKey: missingRevisionKey,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const jobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "page",
              sourceKey: pageKey,
              sourceRevisionKey: missingRevisionKey,
              requestGeneration: 1,
              page: {
                authority: "derived",
                authorityPolicyKey: "company-pages",
                policyGeneration: 1,
              },
            },
            now,
          ),
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const job = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_job_key", (query) => query.eq("jobKey", jobKey))
              .first()
              .pipe(Effect.orDie);
            if (job._tag === "None") throw new Error("missing job");
            yield* writer
              .table("retrievalPublicationJobs")
              .patch(job.value._id, { maxAttempts: 1 })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const failed = yield* confect.run(
          runPublicationJobEffect({
            jobKey,
            caller: {
              kind: "system",
              name: "publication-dead-letter-test",
              surface: "internal",
            },
            now,
          }),
          resultSchema(),
        );
        const health = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            return yield* reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("corpusKey", "brain-pages")
                  .eq("connectorScopeKey", undefined),
              )
              .first()
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        return { failed, health };
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.failed).toMatchObject({
      status: "dead_letter",
      lastErrorTag: "RetrievalOriginUnavailable",
    });
    if (Option.isNone(result.health)) throw new Error("missing corpus health");
    expect(result.health.value).toMatchObject({
      coverageStatus: "partial",
      failedCount: 1,
      degradedReason: expect.stringContaining("RetrievalOriginUnavailable"),
    });
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
        );
        const policyOverflow = yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            const duplicatePolicyId = yield* writer
              .table("channelRoutingPolicies")
              .insert({
                organizationKey,
                connectionKey: "conn_slack",
                connectionGeneration: 1,
                channelKey: "channel_sales",
                policyEpoch: 2,
                active: true,
                mode: "direct",
                targetBrainKeys: [brainKey],
                historicalBackfillStartAt: now - 1_000,
                statusAfterApply: "streaming",
                createdByRole: "owner",
                createdAt: now + 1,
              })
              .pipe(Effect.orDie);
            const attempt = yield* publishSlackRevisionEffect({
              organizationKey,
              workspaceId,
              brainKey,
              sourceRevisionKey,
              caller: {
                kind: "system",
                name: "slack-policy-overflow-test",
                surface: "internal",
              },
              now: now + 1,
            }).pipe(
              Effect.match({
                onFailure: (error) => ({
                  outcome: "failure" as const,
                  errorTag: error._tag,
                  entryCount:
                    error._tag === "RetrievalPublicationCapacityExceeded"
                      ? error.entryCount
                      : 0,
                  tokenCount:
                    error._tag === "RetrievalPublicationCapacityExceeded"
                      ? error.tokenCount
                      : 0,
                }),
                onSuccess: () => ({
                  outcome: "success" as const,
                  errorTag: null,
                  entryCount: 0,
                  tokenCount: 0,
                }),
              }),
            );
            yield* writer
              .table("channelRoutingPolicies")
              .patch(duplicatePolicyId, { active: false })
              .pipe(Effect.orDie);
            return attempt;
          }),
          resultSchema(),
        );
        const policyId = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const policy = yield* reader
              .table("channelRoutingPolicies")
              .index("by_channel_active", (query) =>
                query.eq("channelKey", "channel_sales").eq("active", true),
              )
              .first()
              .pipe(Effect.orDie);
            if (policy._tag === "None") throw new Error("missing policy");
            yield* writer
              .table("channelRoutingPolicies")
              .patch(policy.value._id, { active: false })
              .pipe(Effect.orDie);
            return policy.value._id;
          }),
          resultSchema(),
        );
        const afterPolicyRemoval = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "repeatable qualified pipeline",
          },
        );
        const contextAfterPolicyRemoval = yield* confect.query(
          refs.internal.brain.readApi.headlessContextGet,
          {
            organizationId,
            workspaceId,
            brainKey,
            question: "What is the repeatable qualified pipeline?",
          },
        );
        const sourceAfterPolicyRemoval = yield* confect
          .query(refs.internal.brain.readApi.headlessSourcesGet, {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: resultEntry.publicationSetKey,
            entryKey: resultEntry.entryKey,
          })
          .pipe(Effect.either);
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            yield* writer
              .table("channelRoutingPolicies")
              .patch(policyId, { active: true })
              .pipe(Effect.orDie);
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
          resultSchema(),
        );
        const afterConnectionRevocation = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "repeatable qualified pipeline",
          },
        );
        const contextAfterConnectionRevocation = yield* confect.query(
          refs.internal.brain.readApi.headlessContextGet,
          {
            organizationId,
            workspaceId,
            brainKey,
            question: "What is the repeatable qualified pipeline?",
          },
        );
        const sourceAfterConnectionRevocation = yield* confect
          .query(refs.internal.brain.readApi.headlessSourcesGet, {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: resultEntry.publicationSetKey,
            entryKey: resultEntry.entryKey,
          })
          .pipe(Effect.either);
        return {
          published,
          policyOverflow,
          search,
          source,
          rebuilt,
          afterPolicyRemoval,
          contextAfterPolicyRemoval,
          sourceAfterPolicyRemoval,
          afterConnectionRevocation,
          contextAfterConnectionRevocation,
          sourceAfterConnectionRevocation,
        };
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.published).toMatchObject({
      outcome: "published",
      entryCount: 1,
    });
    expect(result.policyOverflow).toEqual({
      outcome: "failure",
      errorTag: "RetrievalPublicationCapacityExceeded",
      entryCount: 2,
      tokenCount: 0,
    });
    if (result.published.outcome !== "published") {
      throw new Error("expected Slack publication");
    }
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
    expect(result.afterPolicyRemoval.results).toEqual([]);
    expect(result.contextAfterPolicyRemoval.entries).toEqual([]);
    expectCitationFailure(result.sourceAfterPolicyRemoval, "origin_mismatch");
    expect(result.afterConnectionRevocation.results).toEqual([]);
    expect(result.contextAfterConnectionRevocation.entries).toEqual([]);
    expectCitationFailure(
      result.sourceAfterConnectionRevocation,
      "origin_mismatch",
    );
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
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
          resultSchema(),
        );
        const routeId = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const route = yield* reader
              .table("callRoutingProposals")
              .index("by_org_revision", (query) =>
                query
                  .eq("organizationKey", organizationKey)
                  .eq("unitRevisionKey", unitRevisionKey),
              )
              .first()
              .pipe(Effect.orDie);
            if (route._tag === "None") throw new Error("missing route");
            yield* writer
              .table("callRoutingProposals")
              .patch(route.value._id, {
                status: "rejected",
                updatedAt: now + 2,
              })
              .pipe(Effect.orDie);
            return route.value._id;
          }),
          resultSchema(),
        );
        const afterRouteRejection = yield* confect.query(
          refs.internal.brain.readApi.headlessContextGet,
          {
            organizationId,
            workspaceId,
            brainKey,
            question: "What is the qualified pipeline close-rate target?",
          },
        );
        const searchAfterRouteRejection = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "qualified pipeline close-rate target",
          },
        );
        const sourceAfterRouteRejection = yield* confect
          .query(refs.internal.brain.readApi.headlessSourcesGet, {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: resultEntry.publicationSetKey,
            entryKey: resultEntry.entryKey,
          })
          .pipe(Effect.either);
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            yield* writer
              .table("callRoutingProposals")
              .patch(routeId, { status: "accepted", updatedAt: now + 3 })
              .pipe(Effect.orDie);
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
                updatedAt: now + 3,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
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
        const searchAfterGenerationChange = yield* confect.query(
          refs.internal.brain.readApi.headlessSourcesSearch,
          {
            organizationId,
            workspaceId,
            brainKey,
            query: "qualified pipeline close-rate target",
          },
        );
        const sourceAfterGenerationChange = yield* confect
          .query(refs.internal.brain.readApi.headlessSourcesGet, {
            organizationId,
            workspaceId,
            brainKey,
            publicationSetKey: resultEntry.publicationSetKey,
            entryKey: resultEntry.entryKey,
          })
          .pipe(Effect.either);
        return {
          published,
          context,
          source,
          rebuilt,
          afterRouteRejection,
          searchAfterRouteRejection,
          sourceAfterRouteRejection,
          afterGenerationChange,
          searchAfterGenerationChange,
          sourceAfterGenerationChange,
        };
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.published).toMatchObject({
      outcome: "published",
      entryCount: 1,
    });
    if (result.published.outcome !== "published") {
      throw new Error("expected transcript publication");
    }
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
    expect(result.afterRouteRejection.entries).toEqual([]);
    expect(result.searchAfterRouteRejection.results).toEqual([]);
    expectCitationFailure(result.sourceAfterRouteRejection, "origin_mismatch");
    expect(result.afterGenerationChange.entries).toEqual([]);
    expect(result.searchAfterGenerationChange.results).toEqual([]);
    expectCitationFailure(
      result.sourceAfterGenerationChange,
      "origin_mismatch",
    );
  });

  it("enumerates every active workspace or returns a visible capacity failure", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { organizationId } = yield* confect.run(seedPage, resultSchema());
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            for (let index = 0; index < 10; index += 1)
              yield* writer
                .table("workspaces")
                .insert({
                  organizationId,
                  ownerUserId: "archived-owner",
                  brainKey: `br_archived_${index}`,
                  name: `Archived ${index}`,
                  slug: `archived-${index}`,
                  kind: "client",
                  status: "archived",
                  dataClassification: "internal",
                  createdAt: now + index + 1,
                  updatedAt: now + index + 1,
                })
                .pipe(Effect.orDie);
            for (let index = 0; index < 25; index += 1)
              yield* writer
                .table("workspaces")
                .insert({
                  organizationId,
                  ownerUserId: "active-owner",
                  brainKey: `br_active_${index}`,
                  name: `Active ${index}`,
                  slug: `active-${index}`,
                  kind: "client",
                  status: "active",
                  dataClassification: "internal",
                  createdAt: now + index + 20,
                  updatedAt: now + index + 20,
                })
                .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const jobKeys = yield* confect.run(
          enqueueOrganizationCorpusRebuildsEffect({
            organizationKey,
            originKind: "transcript_rebuild",
            sourceKey: "organization-rebuild",
            sourceRevisionKey: "organization-rebuild-1",
            requestGeneration: 1,
            now,
          }),
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            yield* writer
              .table("workspaces")
              .insert({
                organizationId,
                ownerUserId: "overflow-owner",
                brainKey: "br_active_overflow",
                name: "Active overflow",
                slug: "active-overflow",
                kind: "client",
                status: "active",
                dataClassification: "internal",
                createdAt: now + 100,
                updatedAt: now + 100,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const overflow = yield* confect.run(
          enqueueOrganizationCorpusRebuildsEffect({
            organizationKey,
            originKind: "transcript_rebuild",
            sourceKey: "organization-rebuild-overflow",
            sourceRevisionKey: "organization-rebuild-overflow-1",
            requestGeneration: 2,
            now: now + 1,
          }).pipe(
            Effect.match({
              onFailure: (error) => ({
                kind: "failure" as const,
                tag: error._tag,
                field: error.field,
              }),
              onSuccess: (jobKeys) => ({
                kind: "success" as const,
                jobKeys,
              }),
            }),
          ),
          resultSchema(),
        );
        return { jobKeys, overflow };
      }).pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.jobKeys).toHaveLength(26);
    expect(result.overflow).toMatchObject({
      kind: "failure",
      tag: "ValidationFailed",
      field: "organizationKey",
    });
  });
});
