import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import { PageNotFound, StaleRevision } from "./pageTree";
import { toPublicPageSummary, type BrainPage } from "./pageSchemas";
import { requireBrainAccess } from "./pages.impl";
import pilot from "./pilot.spec";
import {
  buildAskResponse,
  type AskCitation,
  type AskPage,
  type AskRevision,
} from "./retrieval";

const unsafeAssumeClockProvided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const sourceKeyFor = (input: {
  brainKey: string;
  submittedAt: number;
  title: string;
  markdown: string;
}) => `src_${sha256Hex(JSON.stringify(input))}`;

const validateText = (field: "title" | "markdown" | "query", value: string) =>
  value.trim().length === 0
    ? new ValidationFailed({ field, message: `${field} is required.` })
    : null;

const submitNote = FunctionImpl.make(
  databaseSchema,
  pilot,
  "submitNote",
  (args) =>
    Effect.gen(function* () {
      const title = args.title.trim();
      const markdown = args.markdown.trim();
      const invalid =
        validateText("title", title) ?? validateText("markdown", markdown);
      if (invalid !== null) return yield* invalid;
      const brain = yield* requireBrainAccess(args.brainKey, "editor");
      const submittedAt = yield* unsafeAssumeClockProvided(
        Clock.currentTimeMillis,
      );
      const sourceKey = sourceKeyFor({
        brainKey: brain.brainKey,
        submittedAt,
        title,
        markdown,
      });
      const writer = yield* DatabaseWriter;
      yield* writer
        .table("brainSources")
        .insert({
          workspaceId: brain.workspaceId,
          organizationId: brain.organizationId,
          sourceKey,
          title,
          markdown,
          status: "pending_review",
          submittedAt,
          schemaVersion: 1,
        })
        .pipe(Effect.orDie);
      return { sourceKey, status: "pending_review" as const };
    }),
);

const reviewNote = FunctionImpl.make(
  databaseSchema,
  pilot,
  "reviewNote",
  (args) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "editor");
      const reader = yield* DatabaseReader;
      const source = yield* reader
        .table("brainSources")
        .index("by_workspace_source_key", (q) =>
          q
            .eq("workspaceId", brain.workspaceId)
            .eq("sourceKey", args.sourceKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull))
        .pipe(Effect.orDie);
      if (source === null)
        return yield* new ValidationFailed({
          field: "sourceKey",
          message: "Source not found.",
        });
      if (source.status !== "pending_review")
        return yield* new ValidationFailed({
          field: "sourceKey",
          message: "Source has already been reviewed.",
        });
      const status = args.decision === "approve" ? "published" : "rejected";
      const reviewedAt = yield* unsafeAssumeClockProvided(
        Clock.currentTimeMillis,
      );
      const writer = yield* DatabaseWriter;
      if (status === "published") {
        const pageKey = `pag_${sha256Hex(`brain-page:${source.sourceKey}`).slice(0, 32)}`;
        const revisionKey = `rev_${sha256Hex(`brain-revision:${source.sourceKey}`).slice(0, 32)}`;
        const siblingSlug = `note-${source.sourceKey.slice(4, 12)}`;
        const sortKey = `0000000001.${source.sourceKey.slice(4, 12)}`;
        const lifecycle = {
          state: "active" as const,
          generation: 1,
          updatedAt: reviewedAt,
          purgeAfter: null,
        };
        yield* writer
          .table("brainPages")
          .insert({
            workspaceId: brain.workspaceId,
            organizationId: brain.organizationId,
            slug: siblingSlug,
            title: source.title,
            markdown: source.markdown,
            sourceKind: "note",
            updatedAt: reviewedAt,
            pageKey,
            parentPageKey: null,
            siblingSlug,
            sortKey,
            favorite: false,
            status: "active",
            currentRevisionKey: revisionKey,
            lifecycle,
            createdAt: reviewedAt,
            schemaVersion: 1,
          })
          .pipe(Effect.orDie);
        yield* writer
          .table("pageRevisions")
          .insert({
            workspaceId: brain.workspaceId,
            organizationId: brain.organizationId,
            pageKey,
            revisionKey,
            priorRevisionKey: null,
            blockNoteJson: "",
            markdown: source.markdown,
            contentHash: sha256Hex(
              JSON.stringify({
                title: source.title,
                markdown: source.markdown,
              }),
            ),
            causation: "import",
            actor: { kind: "user", id: brain.actorId },
            modelReceiptKey: null,
            effectKey: `brain.pages.create:${pageKey}:${revisionKey}`,
            state: "published",
            lifecycle,
            createdAt: reviewedAt,
            schemaVersion: 1,
          })
          .pipe(Effect.orDie);
        yield* writer
          .table("citations")
          .insert({
            workspaceId: String(brain.workspaceId),
            citationId: `citation:${source.sourceKey}`,
            claimId: `source:${source.sourceKey}`,
            sourceId: source.sourceKey,
            sourceKind: "note",
            sourceTitle: source.title,
            quotedText: source.markdown,
            startOffset: 0,
            endOffset: source.markdown.length,
            pageKey,
            revisionKey,
            createdAt: reviewedAt,
          })
          .pipe(Effect.orDie);
      }
      yield* writer
        .table("brainSources")
        .patch(source._id, {
          status,
          reviewedAt,
        })
        .pipe(Effect.orDie);
      return { sourceKey: source.sourceKey, status };
    }),
);

const listReviewQueue = FunctionImpl.make(
  databaseSchema,
  pilot,
  "listReviewQueue",
  (args) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "viewer");
      const reader = yield* DatabaseReader;
      const sources = yield* reader
        .table("brainSources")
        .index("by_workspace_status", (q) =>
          q.eq("workspaceId", brain.workspaceId).eq("status", "pending_review"),
        )
        .collect()
        .pipe(Effect.orDie);
      return {
        brainKey: brain.brainKey,
        items: [...sources]
          .sort((left, right) => left.submittedAt - right.submittedAt)
          .map((source) => ({
            sourceKey: source.sourceKey,
            title: source.title,
            submittedAt: source.submittedAt,
            status: source.status,
            route: null,
          })),
      };
    }),
);

const updatePage = FunctionImpl.make(
  databaseSchema,
  pilot,
  "updatePage",
  (args) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "editor");
      const reader = yield* DatabaseReader;
      const pageRow = yield* reader
        .table("brainPages")
        .index("by_workspace_page_key", (q) =>
          q.eq("workspaceId", brain.workspaceId).eq("pageKey", args.pageKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull))
        .pipe(Effect.orDie);
      if (pageRow === null)
        return yield* new PageNotFound({ pageKey: args.pageKey });
      const page = pageRow as unknown as BrainPage;
      if (page.status !== "active" || page.lifecycle.state !== "active")
        return yield* new PageNotFound({ pageKey: args.pageKey });
      if (page.currentRevisionKey !== args.expectedCurrentRevisionKey)
        return yield* new StaleRevision({
          pageKey: page.pageKey,
          expectedCurrentRevisionKey: args.expectedCurrentRevisionKey,
          actualCurrentRevisionKey: page.currentRevisionKey,
        });
      const updatedAt = yield* unsafeAssumeClockProvided(
        Clock.currentTimeMillis,
      );
      const nextRevisionKey = `rev_${sha256Hex(
        JSON.stringify({
          kind: "updatePage",
          pageKey: page.pageKey,
          updatedAt,
        }),
      ).slice(0, 32)}`;
      const lifecycle = {
        ...page.lifecycle,
        generation: page.lifecycle.generation + 1,
        updatedAt,
      };
      const updatedPage = {
        ...page,
        markdown: args.markdown,
        currentRevisionKey: nextRevisionKey,
        updatedAt,
        lifecycle,
      };
      const writer = yield* DatabaseWriter;
      yield* writer
        .table("brainPages")
        .patch(pageRow._id, {
          markdown: args.markdown,
          currentRevisionKey: nextRevisionKey,
          updatedAt,
          lifecycle,
        })
        .pipe(Effect.orDie);
      yield* writer
        .table("pageRevisions")
        .insert({
          workspaceId: brain.workspaceId,
          organizationId: brain.organizationId,
          pageKey: page.pageKey,
          revisionKey: nextRevisionKey,
          priorRevisionKey: page.currentRevisionKey,
          blockNoteJson: "",
          markdown: args.markdown,
          contentHash: sha256Hex(
            JSON.stringify({ title: page.title, markdown: args.markdown }),
          ),
          causation: "human-edit",
          actor: { kind: "user", id: brain.actorId },
          modelReceiptKey: null,
          effectKey: `brain.pages.updatePage:${page.pageKey}:${nextRevisionKey}`,
          state: "published",
          lifecycle: {
            state: "active",
            generation: lifecycle.generation,
            updatedAt,
            purgeAfter: null,
          },
          createdAt: updatedAt,
          schemaVersion: 1,
        })
        .pipe(Effect.orDie);
      const citations = yield* reader
        .table("citations")
        .index("by_workspace_page", (q) =>
          q
            .eq("workspaceId", String(brain.workspaceId))
            .eq("pageKey", page.pageKey),
        )
        .collect()
        .pipe(Effect.orDie);
      for (const citation of citations) {
        yield* writer
          .table("citations")
          .patch(citation._id, {
            revisionKey: nextRevisionKey,
            quotedText: args.markdown,
            endOffset: args.markdown.length,
          })
          .pipe(Effect.orDie);
      }
      return toPublicPageSummary(updatedPage);
    }),
);

const search = FunctionImpl.make(databaseSchema, pilot, "search", (args) =>
  Effect.gen(function* () {
    const query = args.query.trim().toLowerCase();
    const invalid = validateText("query", query);
    if (invalid !== null) return yield* invalid;
    const brain = yield* requireBrainAccess(args.brainKey, "viewer");
    const reader = yield* DatabaseReader;
    const pages = yield* reader
      .table("brainPages")
      .index("by_workspace", (q) => q.eq("workspaceId", brain.workspaceId))
      .collect()
      .pipe(Effect.orDie);
    const citations = yield* reader
      .table("citations")
      .index("by_workspace", (q) =>
        q.eq("workspaceId", String(brain.workspaceId)),
      )
      .collect()
      .pipe(Effect.orDie);
    return {
      brainKey: brain.brainKey,
      results: pages
        .map((page) => page as unknown as BrainPage)
        .filter(
          (page) =>
            page.status === "active" && page.lifecycle.state === "active",
        )
        .map((page) => ({
          page,
          citation: citations.find(
            (citation) =>
              citation.pageKey === page.pageKey &&
              citation.revisionKey === page.currentRevisionKey,
          ),
        }))
        .filter(({ page }) =>
          `${page.title}\n${page.markdown}`.toLowerCase().includes(query),
        )
        .sort((left, right) =>
          (left.citation?.sourceId ?? left.page.pageKey).localeCompare(
            right.citation?.sourceId ?? right.page.pageKey,
          ),
        )
        .map(({ page, citation }) => ({
          sourceKey: citation?.sourceId ?? page.pageKey,
          citationKey: citation?.citationId ?? `citation:${page.pageKey}`,
          title: page.title,
          excerpt: page.markdown,
          ...(citation?.revisionKey === undefined
            ? { state: "legacy_unresolved" as const }
            : {
                sourceRevisionKey: citation.revisionKey,
                locator: `offsets:${citation.startOffset}-${citation.endOffset}`,
                freshness:
                  citation.revisionKey === page.currentRevisionKey
                    ? ("fresh" as const)
                    : ("stale" as const),
                state: "resolved" as const,
              }),
        })),
    };
  }),
);

const ask = FunctionImpl.make(databaseSchema, pilot, "ask", (args) =>
  Effect.gen(function* () {
    const query = args.query.trim().toLowerCase();
    const invalid = validateText("query", query);
    if (invalid !== null) return yield* invalid;
    const brain = yield* requireBrainAccess(args.brainKey, "viewer");
    const reader = yield* DatabaseReader;
    const pages = yield* reader
      .table("brainPages")
      .index("by_workspace", (q) => q.eq("workspaceId", brain.workspaceId))
      .collect()
      .pipe(Effect.orDie);
    const revisions = [];
    for (const page of pages) {
      if (page.currentRevisionKey === null) continue;
      const pageRevisions = yield* reader
        .table("pageRevisions")
        .index("by_page_created", (q) =>
          q
            .eq("workspaceId", brain.workspaceId)
            .eq("pageKey", page.pageKey ?? "missing"),
        )
        .collect()
        .pipe(Effect.orDie);
      revisions.push(...pageRevisions);
    }
    const citations = yield* reader
      .table("citations")
      .index("by_workspace", (q) =>
        q.eq("workspaceId", String(brain.workspaceId)),
      )
      .collect()
      .pipe(Effect.orDie);
    return {
      brainKey: brain.brainKey,
      response: buildAskResponse({
        query,
        pages: pages as unknown as AskPage[],
        revisions: revisions as unknown as AskRevision[],
        citations: citations as unknown as AskCitation[],
      }),
    };
  }),
);

export default GroupImpl.make(databaseSchema, pilot).pipe(
  Layer.provide(submitNote),
  Layer.provide(reviewNote),
  Layer.provide(listReviewQueue),
  Layer.provide(updatePage),
  Layer.provide(search),
  Layer.provide(ask),
  GroupImpl.finalize,
);
