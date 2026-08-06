import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader } from "../_generated/services";
import { ValidationFailed } from "../errors";
import { SubsystemDisabled } from "../ops/brainOperations.spec";
import { requireBrainAccess, requireHeadlessBrainAccess } from "./pages.impl";
import {
  buildAskResponse,
  loadTranscriptCitations,
  type AskCitation,
  type AskPage,
  type AskRevision,
  type ResolvedTranscriptCitation,
} from "./retrieval";
import readApi from "./readApi.spec";
import {
  operationPolicyFromRecord,
  operationPolicyKey,
} from "../ops/brainOperationPolicy";

const now = () =>
  Clock.currentTimeMillis as Effect.Effect<number, never, never>;

const ensureOperationEnabled = (workspaceId: string, subsystem: "ask") =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("policies")
      .index("by_workspace_kind_status", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("kind", "agent.config")
          .eq("status", "active"),
      )
      .collect()
      .pipe(Effect.orDie);
    const row = rows.find(
      (candidate) =>
        candidate.policyKey === operationPolicyKey(workspaceId, subsystem),
    );
    if (row === undefined) return;
    const policy = operationPolicyFromRecord(row);
    if (policy.state === "disabled")
      return yield* new SubsystemDisabled({ subsystem });
  });

const toTranscriptResult = (citation: ResolvedTranscriptCitation) => ({
  sourceKey: citation.sourceKey,
  sourceRevisionKey: citation.sourceRevisionKey,
  citationKey: citation.citationKey,
  title: citation.title,
  excerpt: citation.quotedText,
  locator: citation.locator,
  citationLabel: citation.label,
  permalink: citation.permalink,
  freshness: citation.freshness,
  state: citation.state,
});

const currentTranscriptCitations = (
  citations: readonly ResolvedTranscriptCitation[],
  pages: readonly {
    readonly pageKey?: string | undefined;
    readonly currentRevisionKey?: string | null | undefined;
    readonly status?: string | undefined;
    readonly lifecycle?: { readonly state: string } | undefined;
  }[],
) => {
  const currentRevisions = new Set(
    pages
      .filter(
        (page) =>
          page.status === "active" && page.lifecycle?.state === "active",
      )
      .map((page) => `${page.pageKey}:${page.currentRevisionKey}`),
  );
  return citations.filter((citation) =>
    currentRevisions.has(`${citation.pageKey}:${citation.revisionKey}`),
  );
};

type ReadSelector = {
  readonly brainKey: string;
  readonly organizationId?: GenericId<"organizations">;
  readonly workspaceId?: GenericId<"workspaces">;
};

const loadTranscriptReadContext = (selector: ReadSelector) =>
  Effect.gen(function* () {
    const brain = yield* selector.organizationId !== undefined &&
    selector.workspaceId !== undefined
      ? requireHeadlessBrainAccess({
          organizationId: selector.organizationId,
          workspaceId: selector.workspaceId,
          brainKey: selector.brainKey,
        })
      : requireBrainAccess(selector.brainKey, "viewer");
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
    const transcripts = currentTranscriptCitations(
      yield* loadTranscriptCitations({
        workspaceId: String(brain.workspaceId),
        organizationKey: brain.organizationKey,
        citations,
      }),
      pages,
    );
    const replacedSourceKeys = new Set(
      citations
        .filter(({ sourceKind }) => sourceKind === "call_transcript")
        .flatMap(({ citationId, claimId }) => [
          citationId.startsWith("citation:")
            ? citationId.slice("citation:".length)
            : "",
          claimId.startsWith("source:") ? claimId.slice("source:".length) : "",
        ]),
    );
    return { brain, reader, pages, citations, transcripts, replacedSourceKeys };
  });

const searchSources = (
  args: { readonly brainKey: string; readonly query: string },
  selector: ReadSelector,
) =>
  Effect.gen(function* () {
    const { brain, reader, transcripts, replacedSourceKeys } =
      yield* loadTranscriptReadContext(selector);
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
      results: [
        ...rows
          .filter((row) => !replacedSourceKeys.has(row.sourceKey))
          .filter((row) =>
            `${row.title}\n${row.markdown}`.toLowerCase().includes(query),
          )
          .map((row) => ({
            sourceKey: row.sourceKey,
            citationKey: `citation:${row.sourceKey}`,
            title: row.title,
            excerpt: row.markdown,
          })),
        ...transcripts
          .filter((citation) =>
            `${citation.title}\n${citation.quotedText}`
              .toLowerCase()
              .includes(query),
          )
          .map(toTranscriptResult),
      ].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
    };
  });

const sourcesSearch = FunctionImpl.make(
  databaseSchema,
  readApi,
  "sourcesSearch",
  (args) => searchSources(args, { brainKey: args.brainKey }),
);
const headlessSourcesSearch = FunctionImpl.make(
  databaseSchema,
  readApi,
  "headlessSourcesSearch",
  (args) => searchSources(args, args),
);

const getSource = (
  args: { readonly brainKey: string; readonly sourceRevisionKey: string },
  selector: ReadSelector,
) =>
  Effect.gen(function* () {
    const { brain, reader, transcripts, replacedSourceKeys } =
      yield* loadTranscriptReadContext(selector);
    const source = yield* reader
      .table("brainSources")
      .index("by_workspace_source_key", (q) =>
        q
          .eq("workspaceId", brain.workspaceId)
          .eq("sourceKey", args.sourceRevisionKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (
      source !== null &&
      source.status === "published" &&
      !replacedSourceKeys.has(source.sourceKey)
    )
      return {
        brainKey: brain.brainKey,
        sourceKey: source.sourceKey,
        citationKey: `citation:${source.sourceKey}`,
        title: source.title,
        excerpt: source.markdown,
        revisionKey: source.sourceKey,
        status: source.status,
      };
    const transcript = transcripts.find(
      ({ sourceRevisionKey }) => sourceRevisionKey === args.sourceRevisionKey,
    );
    if (transcript === undefined)
      return yield* new ValidationFailed({
        field: "sourceRevisionKey",
        message: "Source revision is unavailable.",
      });
    return {
      brainKey: brain.brainKey,
      ...toTranscriptResult(transcript),
      revisionKey: transcript.sourceRevisionKey,
      status: "published",
    };
  });

const sourcesGet = FunctionImpl.make(
  databaseSchema,
  readApi,
  "sourcesGet",
  (args) => getSource(args, { brainKey: args.brainKey }),
);
const headlessSourcesGet = FunctionImpl.make(
  databaseSchema,
  readApi,
  "headlessSourcesGet",
  (args) => getSource(args, args),
);

const contextGet = FunctionImpl.make(
  databaseSchema,
  readApi,
  "contextGet",
  (args) =>
    Effect.gen(function* () {
      const { brain, pages, citations, transcripts } =
        yield* loadTranscriptReadContext({ brainKey: args.brainKey });
      const allowed =
        args.pageKeys === undefined ? null : new Set(args.pageKeys);
      const transcriptRevisionKeys = new Set(
        citations
          .filter(({ sourceKind }) => sourceKind === "call_transcript")
          .map(({ pageKey, revisionKey }) => `${pageKey}:${revisionKey}`),
      );
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
          const transcript = transcripts.find(
            (citation) =>
              citation.pageKey === pageKey &&
              citation.revisionKey === page.currentRevisionKey,
          );
          if (
            transcript === undefined &&
            transcriptRevisionKeys.has(`${pageKey}:${page.currentRevisionKey}`)
          )
            return [];
          const entry =
            transcript === undefined
              ? {
                  sourceKey: pageKey,
                  citationKey: `citation:${pageKey}`,
                  title: page.title,
                  excerpt: page.markdown,
                }
              : toTranscriptResult(transcript);
          const size = new TextEncoder().encode(entry.excerpt).byteLength;
          if (bytes + size > (args.maxBytes ?? 100_000)) return [];
          bytes += size;
          return [entry];
        });
      return {
        brainKey: brain.brainKey,
        asOf: yield* now(),
        freshness: { status: "current" as const },
        entries,
      };
    }),
);

const askAnswer = (
  args: { readonly brainKey: string; readonly question: string },
  selector: ReadSelector,
) =>
  Effect.gen(function* () {
    const { brain, reader, pages, citations, transcripts } =
      yield* loadTranscriptReadContext(selector);
    yield* ensureOperationEnabled(brain.workspaceId, "ask");
    const question = args.question.trim().toLowerCase();
    if (!question)
      return yield* new ValidationFailed({
        field: "question",
        message: "question is required.",
      });
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
    const response = buildAskResponse({
      query: question,
      pages: pages as unknown as AskPage[],
      revisions: revisions as unknown as AskRevision[],
      citations: citations as unknown as AskCitation[],
      transcriptCitations: transcripts,
    });
    return { brainKey: brain.brainKey, response };
  });

const answersAsk = FunctionImpl.make(
  databaseSchema,
  readApi,
  "answersAsk",
  (args) => askAnswer(args, { brainKey: args.brainKey }),
);
const headlessAnswersAsk = FunctionImpl.make(
  databaseSchema,
  readApi,
  "headlessAnswersAsk",
  (args) => askAnswer(args, args),
);

export default GroupImpl.make(databaseSchema, readApi).pipe(
  Layer.provide(sourcesSearch),
  Layer.provide(sourcesGet),
  Layer.provide(contextGet),
  Layer.provide(answersAsk),
  Layer.provide(headlessSourcesSearch),
  Layer.provide(headlessSourcesGet),
  Layer.provide(headlessAnswersAsk),
  GroupImpl.finalize,
);
