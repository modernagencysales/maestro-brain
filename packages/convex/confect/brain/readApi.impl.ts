import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import type { RetrievalEntriesDoc } from "../_generated/docs";
import { DatabaseReader } from "../_generated/services";
import { ValidationFailed } from "../errors";
import { SubsystemDisabled } from "../ops/brainOperations.spec";
import { sha256Hex } from "../shared/sha256";
import { requireBrainAccess, requireHeadlessBrainAccess } from "./pages.impl";
import {
  RETRIEVAL_CANDIDATE_LIMIT,
  RETRIEVAL_CONTEXT_ENTRY_LIMIT,
  RETRIEVAL_CONTEXT_MAX_BYTES,
  RETRIEVAL_POSTING_LIMIT,
  retrievalScore,
  uniqueQueryTokens,
} from "./retrievalPublication";
import {
  buildAskResponse,
  loadTranscriptCitations,
  type AskCitation,
  type AskPage,
  type AskRevision,
  type ResolvedTranscriptCitation,
} from "./retrieval";
import readApi, { SearchResult } from "./readApi.spec";
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

const resolveReadBrain = (selector: ReadSelector) =>
  selector.organizationId !== undefined && selector.workspaceId !== undefined
    ? requireHeadlessBrainAccess({
        organizationId: selector.organizationId,
        workspaceId: selector.workspaceId,
        brainKey: selector.brainKey,
      })
    : requireBrainAccess(selector.brainKey, "viewer");

const legacyTranscriptResult = (citation: ResolvedTranscriptCitation) => ({
  sourceKey: citation.sourceKey,
  sourceRevisionKey: citation.sourceRevisionKey,
  entryKey: `legacy:${citation.sourceRevisionKey}:${citation.segmentKey}`,
  passageKey: `legacy:${citation.segmentKey}`,
  startOffset: citation.startOffset,
  endOffset: citation.endOffset,
  contentHash: `sha256:${sha256Hex(citation.quotedText)}`,
  kind: "source" as const,
  unitKey: citation.unitKey,
  segmentKey: citation.segmentKey,
  citationKey: citation.citationKey,
  title: citation.title,
  excerpt: citation.quotedText,
  locator: citation.locator,
  citationLabel: citation.label,
  permalink: citation.permalink,
  authority: "advisory" as const,
  authorityPolicyKey: "legacy-transcript-compatibility",
  observedAt: 0,
  indexedAt: 0,
  freshness: "unknown" as const,
  truncated: false,
  state: "resolved" as const,
});

const PER_TOKEN_POSTING_LIMIT = 1_000;

const freshnessFor = (
  entry: {
    readonly corpusKey: string;
    readonly sourceModifiedAt?: number | undefined;
    readonly observedAt: number;
  },
  at: number,
  healthByCorpus: ReadonlyMap<
    string,
    { readonly freshnessThresholdMs: number }
  >,
) => {
  const health = healthByCorpus.get(entry.corpusKey);
  if (health === undefined) return "unknown" as const;
  const evidenceAt = entry.sourceModifiedAt ?? entry.observedAt;
  return at - evidenceAt <= health.freshnessThresholdMs
    ? ("current" as const)
    : ("stale" as const);
};

const coverageFor = (
  rows: readonly {
    readonly corpusKey: string;
    readonly coverageStatus: "complete" | "partial" | "unavailable" | "unknown";
    readonly lastObservedAt?: number | undefined;
    readonly lastPublishedAt?: number | undefined;
    readonly lastReconciledAt?: number | undefined;
    readonly freshnessThresholdMs: number;
    readonly degradedReason?: string | undefined;
  }[],
  at: number,
) =>
  rows.map((row) => {
    const lastSuccessfulAt = Math.max(
      row.lastObservedAt ?? 0,
      row.lastPublishedAt ?? 0,
      row.lastReconciledAt ?? 0,
    );
    const freshnessVerifiedAt = row.lastReconciledAt ?? row.lastObservedAt ?? 0;
    const freshness =
      freshnessVerifiedAt === 0
        ? ("unknown" as const)
        : at - freshnessVerifiedAt <= row.freshnessThresholdMs
          ? ("current" as const)
          : ("stale" as const);
    return {
      sourceKind: row.corpusKey,
      status: row.coverageStatus,
      freshness,
      ...(lastSuccessfulAt > 0 ? { lastSuccessfulAt } : {}),
      ...(row.degradedReason === undefined
        ? {}
        : { reason: row.degradedReason }),
    };
  });

const contextFreshnessFor = (
  coverage: readonly {
    readonly freshness: "current" | "stale" | "unknown";
  }[],
) => {
  if (coverage.some(({ freshness }) => freshness === "stale"))
    return "stale" as const;
  if (
    coverage.length === 0 ||
    coverage.some(({ freshness }) => freshness === "unknown")
  )
    return "unknown" as const;
  return "current" as const;
};

const toRetrievalResult = (
  entry: {
    readonly kind: "page" | "slack" | "transcript" | "document" | "projection";
    readonly origin:
      | {
          readonly kind: "page";
          readonly pageKey: string;
          readonly revisionKey: string;
        }
      | {
          readonly kind: "slack";
          readonly sourceKey: string;
          readonly sourceRevisionKey: string;
        }
      | {
          readonly kind: "transcript";
          readonly unitKey: string;
          readonly unitRevisionKey: string;
          readonly segmentKey: string;
        }
      | {
          readonly kind: "document";
          readonly connectionKey: string;
          readonly connectorScopeKey: string;
          readonly objectKey: string;
          readonly revisionKey: string;
        }
      | {
          readonly kind: "projection";
          readonly projectionKey: string;
          readonly revisionKey: string;
        };
    readonly sourceKey: string;
    readonly sourceRevisionKey: string;
    readonly entryKey: string;
    readonly passageKey: string;
    readonly startOffset: number;
    readonly endOffset: number;
    readonly contentHash: string;
    readonly title: string;
    readonly text: string;
    readonly locator?: string | undefined;
    readonly authority: "authoritative" | "derived" | "advisory";
    readonly authorityPolicyKey: string;
    readonly sourceModifiedAt?: number | undefined;
    readonly observedAt: number;
    readonly indexedAt: number;
  },
  freshness: "current" | "stale" | "unknown",
) => ({
  sourceKey: entry.sourceKey,
  sourceRevisionKey: entry.sourceRevisionKey,
  entryKey: entry.entryKey,
  passageKey: entry.passageKey,
  startOffset: entry.startOffset,
  endOffset: entry.endOffset,
  contentHash: entry.contentHash,
  kind:
    entry.kind === "page"
      ? ("page" as const)
      : entry.kind === "projection"
        ? ("projection" as const)
        : ("source" as const),
  ...(entry.origin.kind === "transcript"
    ? { unitKey: entry.origin.unitKey, segmentKey: entry.origin.segmentKey }
    : {}),
  citationKey: `citation:${entry.entryKey}`,
  title: entry.title,
  excerpt: entry.text,
  ...(entry.locator === undefined
    ? {}
    : {
        locator: entry.locator,
        permalink: entry.locator,
      }),
  citationLabel: entry.title,
  authority: entry.authority,
  authorityPolicyKey: entry.authorityPolicyKey,
  ...(entry.sourceModifiedAt === undefined
    ? {}
    : { sourceModifiedAt: entry.sourceModifiedAt }),
  observedAt: entry.observedAt,
  indexedAt: entry.indexedAt,
  freshness,
  truncated: false,
  state: "resolved" as const,
});

type SearchResultValue = typeof SearchResult.Type;

const searchProjection = (
  queryText: string,
  selector: ReadSelector,
  entryLimit: number,
) =>
  Effect.gen(function* () {
    const queryTokens = uniqueQueryTokens(queryText);
    if (queryTokens.length === 0)
      return yield* new ValidationFailed({
        field: "query",
        message: "query must contain a searchable term.",
      });
    const brain = yield* resolveReadBrain(selector);
    const reader = yield* DatabaseReader;
    const at = yield* now();
    const [postingGroups, healthRows] = yield* Effect.all([
      Effect.all(
        queryTokens.map((token) =>
          reader
            .table("retrievalTokens")
            .index("by_workspace_brain_token_authority_entry", (index) =>
              index
                .eq("workspaceId", brain.workspaceId)
                .eq("brainKey", brain.brainKey)
                .eq("token", token),
            )
            .take(PER_TOKEN_POSTING_LIMIT + 1)
            .pipe(Effect.orDie),
        ),
      ),
      reader
        .table("brainCorpusHealth")
        .index("by_workspace_brain", (index) =>
          index
            .eq("workspaceId", brain.workspaceId)
            .eq("brainKey", brain.brainKey),
        )
        .take(100)
        .pipe(Effect.orDie),
    ]);
    const omissions: Array<{ reason: string; count: number }> = [];
    const boundedGroups = postingGroups
      .map((postings, index) => ({
        token: queryTokens[index] ?? "",
        postings: postings.slice(0, PER_TOKEN_POSTING_LIMIT),
        overflow: Math.max(0, postings.length - PER_TOKEN_POSTING_LIMIT),
      }))
      .sort(
        (left, right) =>
          left.postings.length - right.postings.length ||
          left.token.localeCompare(right.token),
      );
    const overflow = boundedGroups.reduce(
      (total, group) => total + group.overflow,
      0,
    );
    if (overflow > 0)
      omissions.push({ reason: "per-token posting capacity", count: overflow });
    const postingsByEntry = new Map<
      string,
      (typeof boundedGroups)[number]["postings"]
    >();
    let postingCount = 0;
    for (const group of boundedGroups) {
      for (const posting of group.postings) {
        if (postingCount >= RETRIEVAL_POSTING_LIMIT) break;
        const candidateKey = `${posting.publicationSetKey}\u0000${posting.entryKey}`;
        postingsByEntry.set(candidateKey, [
          ...(postingsByEntry.get(candidateKey) ?? []),
          posting,
        ]);
        postingCount += 1;
      }
      if (postingCount >= RETRIEVAL_POSTING_LIMIT) break;
    }
    if (
      boundedGroups.reduce((sum, group) => sum + group.postings.length, 0) >
      postingCount
    )
      omissions.push({
        reason: "query posting capacity",
        count:
          boundedGroups.reduce((sum, group) => sum + group.postings.length, 0) -
          postingCount,
      });

    const candidateKeys = [...postingsByEntry]
      .sort(([, left], [, right]) => {
        const leftAuthority = Math.min(
          ...left.map(({ authorityRank }) => authorityRank),
        );
        const rightAuthority = Math.min(
          ...right.map(({ authorityRank }) => authorityRank),
        );
        const leftTokens = new Set(left.map(({ token }) => token)).size;
        const rightTokens = new Set(right.map(({ token }) => token)).size;
        return leftAuthority - rightAuthority || rightTokens - leftTokens;
      })
      .map(([candidateKey]) => {
        const separator = candidateKey.indexOf("\u0000");
        return {
          publicationSetKey: candidateKey.slice(0, separator),
          entryKey: candidateKey.slice(separator + 1),
          candidateKey,
        };
      });
    const healthByCorpus = new Map(
      healthRows.map((row) => [row.corpusKey, row] as const),
    );
    const active: Array<{
      entry: RetrievalEntriesDoc;
      score: number;
    }> = [];
    for (
      let offset = 0;
      offset < candidateKeys.length &&
      active.length < RETRIEVAL_CANDIDATE_LIMIT;
      offset += 40
    ) {
      const keys = candidateKeys.slice(offset, offset + 40);
      const rows = yield* Effect.all(
        keys.map(({ publicationSetKey, entryKey }) =>
          reader
            .table("retrievalEntries")
            .index("by_workspace_brain_publication_set_entry", (index) =>
              index
                .eq("workspaceId", brain.workspaceId)
                .eq("brainKey", brain.brainKey)
                .eq("publicationSetKey", publicationSetKey)
                .eq("entryKey", entryKey),
            )
            .first()
            .pipe(Effect.map(Option.getOrNull), Effect.orDie),
        ),
      );
      for (let index = 0; index < rows.length; index += 1) {
        const entry = rows[index];
        if (
          entry === undefined ||
          entry === null ||
          entry.state !== "published"
        )
          continue;
        const publicationSet = yield* reader
          .table("retrievalPublicationSets")
          .index("by_workspace_publication_set", (index) =>
            index
              .eq("workspaceId", brain.workspaceId)
              .eq("publicationSetKey", entry.publicationSetKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie);
        if (publicationSet?.state !== "current") continue;
        const freshness = freshnessFor(entry, at, healthByCorpus);
        active.push({
          entry,
          score: retrievalScore({
            queryTokens,
            postings:
              postingsByEntry.get(keys[index]?.candidateKey ?? "") ?? [],
            authority: entry.authority,
            freshness,
          }),
        });
      }
    }
    const perRevision = new Map<string, number>();
    const results = active
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.entry.entryKey.localeCompare(right.entry.entryKey),
      )
      .flatMap(({ entry }) => {
        const count = perRevision.get(entry.sourceRevisionKey) ?? 0;
        if (count >= 3) return [];
        perRevision.set(entry.sourceRevisionKey, count + 1);
        return [
          toRetrievalResult(entry, freshnessFor(entry, at, healthByCorpus)),
        ];
      })
      .slice(0, entryLimit);
    return {
      brain,
      at,
      results,
      coverage: coverageFor(healthRows, at),
      omissions,
    };
  });

const searchSources = (
  args: { readonly brainKey: string; readonly query: string },
  selector: ReadSelector,
) =>
  Effect.gen(function* () {
    const query = args.query.trim();
    if (!query)
      return yield* new ValidationFailed({
        field: "query",
        message: "query is required.",
      });
    const projection = yield* searchProjection(
      query,
      selector,
      RETRIEVAL_CANDIDATE_LIMIT,
    );
    if (projection.results.length > 0)
      return {
        brainKey: projection.brain.brainKey,
        results: projection.results,
        coverage: projection.coverage,
        omissions: projection.omissions,
      };
    const legacy = yield* loadTranscriptReadContext(selector);
    const words = new Set(uniqueQueryTokens(query));
    const legacyResults = legacy.transcripts
      .filter((citation) =>
        uniqueQueryTokens(`${citation.title} ${citation.quotedText}`).some(
          (token) => words.has(token),
        ),
      )
      .map(legacyTranscriptResult);
    return {
      brainKey: projection.brain.brainKey,
      results: legacyResults,
      coverage:
        legacyResults.length === 0
          ? projection.coverage
          : [
              ...projection.coverage,
              {
                sourceKind: "transcripts",
                status: "unknown" as const,
                freshness: "unknown" as const,
                reason: "Legacy transcript compatibility path.",
              },
            ],
      omissions:
        legacyResults.length === 0
          ? projection.omissions
          : [
              ...projection.omissions,
              {
                reason: "legacy transcript compatibility path",
                count: legacyResults.length,
              },
            ],
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
  args: {
    readonly brainKey: string;
    readonly sourceRevisionKey?: string | undefined;
    readonly entryKey?: string | undefined;
  },
  selector: ReadSelector,
) =>
  Effect.gen(function* () {
    if (args.entryKey === undefined && args.sourceRevisionKey === undefined)
      return yield* new ValidationFailed({
        field: "entryKey",
        message: "entryKey or sourceRevisionKey is required.",
      });
    const brain = yield* resolveReadBrain(selector);
    const reader = yield* DatabaseReader;
    const requestedEntryKey = args.entryKey;
    const requestedRevisionKey = args.sourceRevisionKey;
    const entry = yield* (
      requestedEntryKey !== undefined
        ? reader
            .table("retrievalEntries")
            .index("by_workspace_entry", (index) =>
              index
                .eq("workspaceId", brain.workspaceId)
                .eq("entryKey", requestedEntryKey),
            )
        : reader
            .table("retrievalEntries")
            .index("by_workspace_brain_revision_entry", (index) =>
              index
                .eq("workspaceId", brain.workspaceId)
                .eq("brainKey", brain.brainKey)
                .eq("sourceRevisionKey", requestedRevisionKey ?? ""),
            )
    )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (entry === null || entry.state !== "published") {
      const legacy = yield* loadTranscriptReadContext(selector);
      const transcript = legacy.transcripts.find(
        ({ sourceRevisionKey }) => sourceRevisionKey === requestedRevisionKey,
      );
      if (transcript !== undefined)
        return {
          brainKey: brain.brainKey,
          ...legacyTranscriptResult(transcript),
          revisionKey: transcript.sourceRevisionKey,
          status: "published",
        };
      return yield* new ValidationFailed({
        field: "sourceRevisionKey",
        message: "Source revision is unavailable.",
      });
    }
    const publicationSet = yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_publication_set", (index) =>
        index
          .eq("workspaceId", brain.workspaceId)
          .eq("publicationSetKey", entry.publicationSetKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (publicationSet?.state !== "current")
      return yield* new ValidationFailed({
        field: "entryKey",
        message: "Retrieval entry is no longer current.",
      });
    const at = yield* now();
    const healthRows = yield* reader
      .table("brainCorpusHealth")
      .index("by_workspace_brain", (index) =>
        index
          .eq("workspaceId", brain.workspaceId)
          .eq("brainKey", brain.brainKey),
      )
      .take(100)
      .pipe(Effect.orDie);
    const healthByCorpus = new Map(
      healthRows.map((row) => [row.corpusKey, row] as const),
    );
    return {
      brainKey: brain.brainKey,
      ...toRetrievalResult(entry, freshnessFor(entry, at, healthByCorpus)),
      revisionKey: entry.sourceRevisionKey,
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

const getContext = (
  args: {
    readonly brainKey: string;
    readonly question?: string | undefined;
    readonly pageKeys?: readonly string[] | undefined;
    readonly maxBytes?: number | undefined;
  },
  selector: ReadSelector,
) =>
  Effect.gen(function* () {
    const question = args.question?.trim() ?? "";
    const byteLimit = Math.min(
      RETRIEVAL_CONTEXT_MAX_BYTES,
      Math.max(1, args.maxBytes ?? RETRIEVAL_CONTEXT_MAX_BYTES),
    );
    if (question) {
      const projection = yield* searchProjection(
        question,
        selector,
        RETRIEVAL_CONTEXT_ENTRY_LIMIT,
      );
      let bytes = 0;
      const entries = projection.results.filter((entry) => {
        const size = new TextEncoder().encode(entry.excerpt).byteLength;
        if (bytes + size > byteLimit) return false;
        bytes += size;
        return true;
      });
      const omittedForBytes = projection.results.length - entries.length;
      return {
        requestId: `ctx_${sha256Hex(
          JSON.stringify({
            brainKey: projection.brain.brainKey,
            question,
            asOf: projection.at,
            entryKeys: entries.map(({ entryKey }) => entryKey),
          }),
        )}`,
        organizationKey: projection.brain.organizationKey,
        brainKey: projection.brain.brainKey,
        question,
        asOf: projection.at,
        freshness: { status: contextFreshnessFor(projection.coverage) },
        coverage: projection.coverage,
        entries,
        omissions: [
          ...projection.omissions,
          ...(omittedForBytes > 0
            ? [{ reason: "context byte capacity", count: omittedForBytes }]
            : []),
        ],
        conflicts: [],
      };
    }

    // Compatibility only for pre-projection callers. Ask Apero always supplies a question.
    const { brain, pages, citations, transcripts } =
      yield* loadTranscriptReadContext(selector);
    const allowed = args.pageKeys === undefined ? null : new Set(args.pageKeys);
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
          typeof page.currentRevisionKey === "string" &&
          page.status === "active" &&
          page.lifecycle?.state === "active" &&
          (allowed === null || allowed.has(page.pageKey)),
      )
      .sort((left, right) =>
        String(left.pageKey).localeCompare(String(right.pageKey)),
      )
      .flatMap<SearchResultValue>((page) => {
        const pageKey = String(page.pageKey);
        const transcript = transcripts.find(
          (citation) =>
            citation.pageKey === pageKey &&
            citation.revisionKey === page.currentRevisionKey,
        );
        if (transcript !== undefined) {
          const result = legacyTranscriptResult(transcript);
          const size = new TextEncoder().encode(result.excerpt).byteLength;
          if (bytes + size > byteLimit) return [];
          bytes += size;
          return [result];
        }
        if (transcriptRevisionKeys.has(`${pageKey}:${page.currentRevisionKey}`))
          return [];
        const size = new TextEncoder().encode(page.markdown).byteLength;
        if (bytes + size > byteLimit) return [];
        bytes += size;
        const sourceKey = pageKey;
        const revisionKey = String(page.currentRevisionKey);
        const contentHash = `sha256:${sha256Hex(page.markdown)}`;
        return [
          {
            sourceKey,
            sourceRevisionKey: revisionKey,
            entryKey: `legacy:${sourceKey}:${revisionKey}`,
            passageKey: `legacy:${revisionKey}`,
            startOffset: 0,
            endOffset: size,
            contentHash,
            kind: "page" as const,
            citationKey: `citation:${sourceKey}:${revisionKey}`,
            title: page.title,
            excerpt: page.markdown,
            citationLabel: page.title,
            authority: "derived" as const,
            authorityPolicyKey: "legacy-page-compatibility",
            observedAt: page.updatedAt,
            indexedAt: page.updatedAt,
            freshness: "unknown" as const,
            truncated: false,
            state: "resolved" as const,
          },
        ];
      });
    const at = yield* now();
    return {
      requestId: `ctx_${sha256Hex(
        JSON.stringify({
          brainKey: brain.brainKey,
          asOf: at,
          pageKeys: [...(allowed ?? [])],
        }),
      )}`,
      organizationKey: brain.organizationKey,
      brainKey: brain.brainKey,
      question,
      asOf: at,
      freshness: { status: "unknown" as const },
      coverage: [
        {
          sourceKind: "brain-pages",
          status: "unknown" as const,
          freshness: "unknown" as const,
          reason:
            "Legacy page compatibility path; no publication coverage receipt.",
        },
      ],
      entries,
      omissions: [
        { reason: "legacy page compatibility path", count: entries.length },
      ],
      conflicts: [],
    };
  });

const contextGet = FunctionImpl.make(
  databaseSchema,
  readApi,
  "contextGet",
  (args) => getContext(args, { brainKey: args.brainKey }),
);
const headlessContextGet = FunctionImpl.make(
  databaseSchema,
  readApi,
  "headlessContextGet",
  (args) => getContext(args, args),
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
  Layer.provide(headlessContextGet),
  Layer.provide(headlessAnswersAsk),
  GroupImpl.finalize,
);
