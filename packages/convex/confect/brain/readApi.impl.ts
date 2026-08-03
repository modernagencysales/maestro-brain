import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader } from "../_generated/services";
import { ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import { requireBrainAccess } from "./pages.impl";
import {
  buildAskResponse,
  type AskCitation,
  type AskPage,
  type AskRevision,
} from "./retrieval";
import readApi from "./readApi.spec";

const now = () =>
  Clock.currentTimeMillis as Effect.Effect<number, never, never>;

const sourcesSearch = FunctionImpl.make(
  databaseSchema,
  readApi,
  "sourcesSearch",
  (args) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "viewer");
      const reader = yield* DatabaseReader;
      const query = args.query.trim().toLowerCase();
      if (!query)
        return yield* new ValidationFailed({
          field: "query",
          message: "query is required.",
        });
      const rows = yield* reader
        .table("brainSources")
        .index("by_workspace_status", (q) =>
          q.eq("workspaceId", brain.workspaceId).eq("status", "published"),
        )
        .collect()
        .pipe(Effect.orDie);
      return {
        brainKey: brain.brainKey,
        results: rows
          .filter((row) =>
            `${row.title}\n${row.markdown}`.toLowerCase().includes(query),
          )
          .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
          .map((row) => ({
            sourceKey: row.sourceKey,
            citationKey: `citation:${row.sourceKey}`,
            title: row.title,
            excerpt: row.markdown,
          })),
      };
    }),
);

const sourcesGet = FunctionImpl.make(
  databaseSchema,
  readApi,
  "sourcesGet",
  (args) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "viewer");
      const reader = yield* DatabaseReader;
      const source = yield* reader
        .table("brainSources")
        .index("by_workspace_source_key", (q) =>
          q
            .eq("workspaceId", brain.workspaceId)
            .eq("sourceKey", args.sourceRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (source === null || source.status !== "published")
        return yield* new ValidationFailed({
          field: "sourceRevisionKey",
          message: "Source revision is unavailable.",
        });
      return {
        brainKey: brain.brainKey,
        sourceKey: source.sourceKey,
        citationKey: `citation:${source.sourceKey}`,
        title: source.title,
        excerpt: source.markdown,
        revisionKey: source.sourceKey,
        status: source.status,
      };
    }),
);

const contextGet = FunctionImpl.make(
  databaseSchema,
  readApi,
  "contextGet",
  (args) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "viewer");
      const reader = yield* DatabaseReader;
      const pages = yield* reader
        .table("brainPages")
        .index("by_workspace", (q) => q.eq("workspaceId", brain.workspaceId))
        .collect()
        .pipe(Effect.orDie);
      const allowed =
        args.pageKeys === undefined ? null : new Set(args.pageKeys);
      let bytes = 0;
      const entries = pages
        .filter(
          (page) =>
            typeof page.pageKey === "string" &&
            page.status === "active" &&
            page.lifecycle?.state === "active" &&
            (allowed === null || allowed.has(page.pageKey)),
        )
        .sort((a, b) => String(a.pageKey).localeCompare(String(b.pageKey)))
        .flatMap((page) => {
          const pageKey = String(page.pageKey);
          const excerpt = page.markdown;
          const size = new TextEncoder().encode(excerpt).byteLength;
          if (bytes + size > (args.maxBytes ?? 100_000)) return [];
          bytes += size;
          return [
            {
              sourceKey: pageKey,
              citationKey: `citation:${pageKey}`,
              title: page.title,
              excerpt,
            },
          ];
        });
      return {
        brainKey: brain.brainKey,
        asOf: yield* now(),
        freshness: { status: "current" as const },
        entries,
      };
    }),
);

const answersAsk = FunctionImpl.make(
  databaseSchema,
  readApi,
  "answersAsk",
  (args) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "viewer");
      const reader = yield* DatabaseReader;
      const question = args.question.trim().toLowerCase();
      if (!question)
        return yield* new ValidationFailed({
          field: "question",
          message: "question is required.",
        });
      const pages = yield* reader
        .table("brainPages")
        .index("by_workspace", (q) => q.eq("workspaceId", brain.workspaceId))
        .collect()
        .pipe(Effect.orDie);
      const revisions = yield* Effect.all(
        pages
          .filter((page) => typeof page.pageKey === "string")
          .map((page) =>
            reader
              .table("pageRevisions")
              .index("by_page_created", (q) =>
                q
                  .eq("workspaceId", brain.workspaceId)
                  .eq("pageKey", String(page.pageKey)),
              )
              .collect()
              .pipe(Effect.orDie),
          ),
      ).pipe(Effect.map((groups) => groups.flat()));
      const citations = yield* reader
        .table("citations")
        .index("by_workspace", (q) =>
          q.eq("workspaceId", String(brain.workspaceId)),
        )
        .collect()
        .pipe(Effect.orDie);
      const response = buildAskResponse({
        query: question,
        pages: pages as unknown as AskPage[],
        revisions: revisions as unknown as AskRevision[],
        citations: citations as unknown as AskCitation[],
      });
      return { brainKey: brain.brainKey, response };
    }),
);

export default GroupImpl.make(databaseSchema, readApi).pipe(
  Layer.provide(sourcesSearch),
  Layer.provide(sourcesGet),
  Layer.provide(contextGet),
  Layer.provide(answersAsk),
  GroupImpl.finalize,
);
