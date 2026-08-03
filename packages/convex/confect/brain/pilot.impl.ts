import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import { requireBrainAccess } from "./pages.impl";
import pilot from "./pilot.spec";

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

const search = FunctionImpl.make(databaseSchema, pilot, "search", (args) =>
  Effect.gen(function* () {
    const query = args.query.trim().toLowerCase();
    const invalid = validateText("query", query);
    if (invalid !== null) return yield* invalid;
    const brain = yield* requireBrainAccess(args.brainKey, "viewer");
    const reader = yield* DatabaseReader;
    const sources = yield* reader
      .table("brainSources")
      .index("by_workspace_status", (q) =>
        q.eq("workspaceId", brain.workspaceId).eq("status", "published"),
      )
      .collect()
      .pipe(Effect.orDie);
    return {
      brainKey: brain.brainKey,
      results: sources
        .filter((source) =>
          `${source.title}\n${source.markdown}`.toLowerCase().includes(query),
        )
        .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
        .map((source) => ({
          sourceKey: source.sourceKey,
          citationKey: `citation:${source.sourceKey}`,
          title: source.title,
          excerpt: source.markdown,
        })),
    };
  }),
);

export default GroupImpl.make(databaseSchema, pilot).pipe(
  Layer.provide(submitNote),
  Layer.provide(reviewNote),
  Layer.provide(search),
  GroupImpl.finalize,
);
