import { FunctionImpl, GroupImpl } from "@confect/server";
import { transcriptProviders } from "@maestro-template/integrations/transcripts/providers";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import type {
  RetrievalEntriesDoc,
  RetrievalPublicationSetsDoc,
  RetrievalTokensDoc,
} from "../_generated/docs";
import { DatabaseReader } from "../_generated/services";
import { ValidationFailed } from "../errors";
import { SubsystemDisabled } from "../ops/brainOperations.spec";
import { sha256Hex } from "../shared/sha256";
import { requireBrainAccess, requireHeadlessBrainAccess } from "./pages.impl";
import {
  buildRetrievalPassages,
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
import readApi, {
  CitationIntegrityFailure,
  SearchResult,
} from "./readApi.spec";
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
  publicationSetKey: "legacy",
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

const CORPUS_HEALTH_LIMIT = 512;
const ACTIVE_SLACK_POLICY_LIMIT = 100;
const ACTIVE_PROVIDER_CONNECTION_LIMIT = 20;

const transcriptProviderConfigKeys = new Set(
  Object.values(transcriptProviders).map(({ providerConfigKey }) =>
    String(providerConfigKey),
  ),
);

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

type CorpusHealthRow = {
  readonly corpusKey: string;
  readonly coverageStatus: "complete" | "partial" | "unavailable" | "unknown";
  readonly lastObservedAt?: number | undefined;
  readonly lastPublishedAt?: number | undefined;
  readonly lastReconciledAt?: number | undefined;
  readonly freshnessThresholdMs: number;
  readonly degradedReason?: string | undefined;
};

type CorpusCoverage = {
  readonly sourceKind: string;
  readonly status: "complete" | "partial" | "unavailable" | "unknown";
  readonly freshness: "current" | "stale" | "unknown";
  readonly lastSuccessfulAt?: number | undefined;
  readonly reason?: string | undefined;
};

const coverageStatusRank: Record<CorpusCoverage["status"], number> = {
  complete: 0,
  partial: 1,
  unknown: 2,
  unavailable: 3,
};

const freshnessRank: Record<CorpusCoverage["freshness"], number> = {
  current: 0,
  unknown: 1,
  stale: 2,
};

const coverageFor = (
  rows: readonly CorpusHealthRow[],
  expectedCorpora: ReadonlySet<string>,
  at: number,
) => {
  const coverageByCorpus = new Map<string, CorpusCoverage>();
  for (const row of rows) {
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
    const candidate: CorpusCoverage = {
      sourceKind: row.corpusKey,
      status: row.coverageStatus,
      freshness,
      ...(lastSuccessfulAt > 0 ? { lastSuccessfulAt } : {}),
      ...(row.degradedReason === undefined
        ? {}
        : { reason: row.degradedReason }),
    };
    const current = coverageByCorpus.get(row.corpusKey);
    if (current === undefined) {
      coverageByCorpus.set(row.corpusKey, candidate);
      continue;
    }
    const reasons = [...new Set([current.reason, candidate.reason])].filter(
      (reason): reason is string => reason !== undefined,
    );
    coverageByCorpus.set(row.corpusKey, {
      sourceKind: row.corpusKey,
      status:
        coverageStatusRank[candidate.status] >
        coverageStatusRank[current.status]
          ? candidate.status
          : current.status,
      freshness:
        freshnessRank[candidate.freshness] > freshnessRank[current.freshness]
          ? candidate.freshness
          : current.freshness,
      ...((candidate.lastSuccessfulAt ?? 0) > 0 ||
      (current.lastSuccessfulAt ?? 0) > 0
        ? {
            lastSuccessfulAt: Math.max(
              candidate.lastSuccessfulAt ?? 0,
              current.lastSuccessfulAt ?? 0,
            ),
          }
        : {}),
      ...(reasons.length === 0 ? {} : { reason: reasons.join("; ") }),
    });
  }
  for (const corpusKey of expectedCorpora)
    if (!coverageByCorpus.has(corpusKey))
      coverageByCorpus.set(corpusKey, {
        sourceKind: corpusKey,
        status: "unavailable",
        freshness: "unknown",
        reason: "Expected corpus has no health record.",
      });
  return [...coverageByCorpus.values()].sort((left, right) =>
    left.sourceKind.localeCompare(right.sourceKind),
  );
};

const expectedCorporaFor = (brain: {
  readonly organizationKey: string;
  readonly brainKey: string;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const [
      slackPolicies,
      transcriptConnections,
      currentRoutes,
      acceptedRoutes,
    ] = yield* Effect.all([
      reader
        .table("channelRoutingPolicies")
        .index("by_organization_active", (index) =>
          index.eq("organizationKey", brain.organizationKey).eq("active", true),
        )
        .take(ACTIVE_SLACK_POLICY_LIMIT + 1)
        .pipe(Effect.orDie),
      reader
        .table("providerConnections")
        .index("by_organization_status", (index) =>
          index
            .eq("organizationKey", brain.organizationKey)
            .eq("status", "active"),
        )
        .take(ACTIVE_PROVIDER_CONNECTION_LIMIT + 1)
        .pipe(Effect.orDie),
      reader
        .table("callRoutingProposals")
        .index("by_org_outcome_status_brain", (index) =>
          index
            .eq("organizationKey", brain.organizationKey)
            .eq("outcome", "routed")
            .eq("status", "current")
            .eq("brainKey", brain.brainKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie),
      reader
        .table("callRoutingProposals")
        .index("by_org_outcome_status_brain", (index) =>
          index
            .eq("organizationKey", brain.organizationKey)
            .eq("outcome", "routed")
            .eq("status", "accepted")
            .eq("brainKey", brain.brainKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie),
    ]);
    if (slackPolicies.length > ACTIVE_SLACK_POLICY_LIMIT)
      return yield* new ValidationFailed({
        field: "coverage.slack",
        message: "Active Slack policy capacity exceeded.",
      });
    if (transcriptConnections.length > ACTIVE_PROVIDER_CONNECTION_LIMIT)
      return yield* new ValidationFailed({
        field: "coverage.transcripts",
        message: "Active provider connection capacity exceeded.",
      });
    const expected = new Set<string>(["brain-pages"]);
    if (
      slackPolicies.some(
        (policy) =>
          policy.mode !== "capture_only" &&
          policy.targetBrainKeys.includes(brain.brainKey),
      )
    )
      expected.add("slack");
    if (
      transcriptConnections.some((connection) =>
        transcriptProviderConfigKeys.has(connection.providerConfigKey),
      ) ||
      currentRoutes !== null ||
      acceptedRoutes !== null
    )
      expected.add("transcripts");
    return expected;
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
    readonly publicationSetKey: string;
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
  publicationSetKey: entry.publicationSetKey,
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
  citationKey: `citation:${entry.publicationSetKey}:${entry.entryKey}`,
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
    const [healthRows, expectedCorpora] = yield* Effect.all([
      reader
        .table("brainCorpusHealth")
        .index("by_workspace_brain", (index) =>
          index
            .eq("workspaceId", brain.workspaceId)
            .eq("brainKey", brain.brainKey),
        )
        .take(CORPUS_HEALTH_LIMIT + 1)
        .pipe(Effect.orDie),
      expectedCorporaFor(brain),
    ]);
    if (healthRows.length > CORPUS_HEALTH_LIMIT)
      return yield* new ValidationFailed({
        field: "coverage",
        message: "Corpus health capacity exceeded.",
      });
    const omissions: Array<{ reason: string; count: number }> = [];
    const publicationSetStates = new Map<
      string,
      RetrievalPublicationSetsDoc["state"] | null
    >();
    const publicationSetStateFor = (publicationSetKey: string) =>
      Effect.gen(function* () {
        const cached = publicationSetStates.get(publicationSetKey);
        if (cached !== undefined) return cached;
        const publicationSet = yield* reader
          .table("retrievalPublicationSets")
          .index("by_workspace_publication_set", (index) =>
            index
              .eq("workspaceId", brain.workspaceId)
              .eq("publicationSetKey", publicationSetKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie);
        const state = publicationSet?.state ?? null;
        publicationSetStates.set(publicationSetKey, state);
        return state;
      });
    const postingsByEntry = new Map<string, RetrievalTokensDoc[]>();
    let postingCount = 0;
    const addPosting = (posting: RetrievalTokensDoc) => {
      const candidateKey = `${posting.publicationSetKey}\u0000${posting.entryKey}`;
      postingsByEntry.set(candidateKey, [
        ...(postingsByEntry.get(candidateKey) ?? []),
        posting,
      ]);
      postingCount += 1;
    };
    for (const token of queryTokens) {
      const remaining = RETRIEVAL_POSTING_LIMIT - postingCount;
      const postings = yield* reader
        .table("retrievalTokens")
        .index(
          "by_workspace_brain_token_publication_state_authority_entry",
          (index) =>
            index
              .eq("workspaceId", brain.workspaceId)
              .eq("brainKey", brain.brainKey)
              .eq("token", token)
              .eq("publicationState", "current"),
        )
        .take(remaining + 1)
        .pipe(Effect.orDie);
      if (postings.length > remaining)
        return yield* new ValidationFailed({
          field: "query",
          message: `Current retrieval posting capacity exceeded (${RETRIEVAL_POSTING_LIMIT}).`,
        });
      for (const posting of postings) {
        if (
          (yield* publicationSetStateFor(posting.publicationSetKey)) !==
          "current"
        )
          return yield* new ValidationFailed({
            field: "query",
            message: "Retrieval token publication state is inconsistent.",
          });
        addPosting(posting);
      }
    }
    const classifiedPostingCount = postingCount;
    let unclassifiedCount = 0;
    for (const token of queryTokens) {
      const remaining =
        RETRIEVAL_POSTING_LIMIT - classifiedPostingCount - unclassifiedCount;
      const postings = yield* reader
        .table("retrievalTokens")
        .index(
          "by_workspace_brain_token_publication_state_authority_entry",
          (index) =>
            index
              .eq("workspaceId", brain.workspaceId)
              .eq("brainKey", brain.brainKey)
              .eq("token", token)
              .eq("publicationState", undefined),
        )
        .take(remaining + 1)
        .pipe(Effect.orDie);
      if (postings.length > remaining)
        return yield* new ValidationFailed({
          field: "query",
          message: `Unclassified retrieval posting capacity exceeded (${RETRIEVAL_POSTING_LIMIT}); complete the publication-state backfill.`,
        });
      unclassifiedCount += postings.length;
      for (const posting of postings) {
        if (
          (yield* publicationSetStateFor(posting.publicationSetKey)) ===
          "current"
        )
          addPosting(posting);
      }
    }

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
    const healthByCorpus = new Map<
      string,
      { readonly freshnessThresholdMs: number }
    >();
    for (const row of healthRows) {
      const current = healthByCorpus.get(row.corpusKey);
      if (
        current === undefined ||
        row.freshnessThresholdMs < current.freshnessThresholdMs
      )
        healthByCorpus.set(row.corpusKey, {
          freshnessThresholdMs: row.freshnessThresholdMs,
        });
    }
    const active: Array<{
      entry: RetrievalEntriesDoc;
      evidence: {
        readonly text: string;
        readonly locator?: string | undefined;
      };
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
        if (
          (yield* publicationSetStateFor(entry.publicationSetKey)) !== "current"
        )
          continue;
        if (!(yield* currentEntryEligible(entry))) continue;
        const evidence = yield* verifyCitationEvidence(entry, brain, {
          requireCurrentRevision: true,
          eligibilityVerified: true,
        });
        const freshness = freshnessFor(entry, at, healthByCorpus);
        active.push({
          entry,
          evidence,
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
      .flatMap(({ entry, evidence }) => {
        const count = perRevision.get(entry.sourceRevisionKey) ?? 0;
        if (count >= 3) return [];
        perRevision.set(entry.sourceRevisionKey, count + 1);
        return [
          toRetrievalResult(
            {
              ...entry,
              text: evidence.text,
              ...(evidence.locator === undefined
                ? { locator: undefined }
                : { locator: evidence.locator }),
            },
            freshnessFor(entry, at, healthByCorpus),
          ),
        ];
      })
      .slice(0, entryLimit);
    return {
      brain,
      at,
      results,
      coverage: coverageFor(healthRows, expectedCorpora, at),
      omissions,
    };
  });

const searchSources = (
  args: {
    readonly brainKey: string;
    readonly query: string;
    readonly compatibilityMode?: "legacy" | undefined;
  },
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
    if (projection.results.length > 0 || args.compatibilityMode !== "legacy")
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

const citationFailure = (
  entry: Pick<RetrievalEntriesDoc, "publicationSetKey" | "entryKey">,
  reason:
    | "origin_missing"
    | "origin_mismatch"
    | "passage_missing"
    | "content_mismatch"
    | "unsupported_origin",
) =>
  new CitationIntegrityFailure({
    publicationSetKey: entry.publicationSetKey,
    entryKey: entry.entryKey,
    reason,
  });

const verifiedPassage = (
  entry: RetrievalEntriesDoc,
  input: string,
  originRevisionKey: string,
) => {
  const passage = buildRetrievalPassages(input, originRevisionKey).find(
    ({ passageKey }) => passageKey === entry.passageKey,
  );
  if (passage === undefined)
    return Effect.fail(citationFailure(entry, "passage_missing"));
  if (
    passage.startOffset !== entry.startOffset ||
    passage.endOffset !== entry.endOffset ||
    passage.contentHash !== entry.contentHash ||
    passage.text !== entry.text
  )
    return Effect.fail(citationFailure(entry, "content_mismatch"));
  return Effect.succeed(passage.text);
};

const currentEntryEligible = (
  entry: RetrievalEntriesDoc,
  options: { readonly requireCurrentRevision: boolean } = {
    requireCurrentRevision: true,
  },
) =>
  Effect.gen(function* () {
    const origin = entry.origin;
    const reader = yield* DatabaseReader;
    if (origin.kind === "page") {
      const page = yield* reader
        .table("brainPages")
        .index("by_workspace_page_key", (index) =>
          index
            .eq("workspaceId", entry.workspaceId)
            .eq("pageKey", origin.pageKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      return (
        page !== null &&
        page.status === "active" &&
        page.lifecycle?.state === "active" &&
        (!options.requireCurrentRevision ||
          page.currentRevisionKey === origin.revisionKey)
      );
    }
    if (origin.kind === "slack") {
      const [artifact, connection] = yield* Effect.all([
        reader
          .table("sourceArtifacts")
          .index("by_org_source_key", (index) =>
            index
              .eq("organizationKey", entry.organizationKey)
              .eq("sourceKey", origin.sourceKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie),
        entry.connectionKey === undefined
          ? Effect.succeed(null)
          : reader
              .table("providerConnections")
              .index("by_connection_key", (index) =>
                index.eq("connectionKey", entry.connectionKey ?? ""),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie),
      ]);
      if (
        artifact === null ||
        connection === null ||
        artifact.organizationKey !== entry.organizationKey ||
        artifact.sourceKey !== origin.sourceKey ||
        artifact.connectionKey !== entry.connectionKey ||
        artifact.connectionGeneration !== entry.connectionGeneration ||
        artifact.lifecycle.state !== "active" ||
        connection.organizationKey !== entry.organizationKey ||
        connection.connectionKey !== entry.connectionKey ||
        connection.connectionGeneration !== entry.connectionGeneration ||
        connection.status !== "active" ||
        (options.requireCurrentRevision &&
          artifact.latestSourceRevisionKey !== origin.sourceRevisionKey) ||
        (options.requireCurrentRevision &&
          artifact.lifecycle.generation !== entry.lifecycleGeneration)
      )
        return false;
      const policies = yield* reader
        .table("channelRoutingPolicies")
        .index("by_channel_active", (index) =>
          index.eq("channelKey", artifact.channelKey).eq("active", true),
        )
        .take(11)
        .pipe(Effect.orDie);
      if (policies.length > 10) return false;
      const eligiblePolicies = policies.filter(
        (policy) =>
          policy.organizationKey === entry.organizationKey &&
          policy.connectionKey === artifact.connectionKey &&
          policy.connectionGeneration === artifact.connectionGeneration &&
          policy.mode !== "capture_only" &&
          policy.targetBrainKeys.includes(entry.brainKey),
      );
      if (eligiblePolicies.length !== 1) return false;
      const policy = eligiblePolicies[0];
      return (
        policy !== undefined &&
        (!options.requireCurrentRevision ||
          (entry.routeGeneration === policy.policyEpoch &&
            entry.policyGeneration === policy.policyEpoch))
      );
    }
    if (origin.kind === "transcript") {
      const unit = yield* reader
        .table("sourceUnits")
        .index("by_unit_key", (index) =>
          index
            .eq("organizationKey", entry.organizationKey)
            .eq("unitKey", origin.unitKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        unit === null ||
        entry.connectionKey === undefined ||
        entry.connectionGeneration === undefined
      )
        return false;
      const connection = yield* reader
        .table("providerConnections")
        .index("by_connection_key", (index) =>
          index.eq("connectionKey", entry.connectionKey ?? ""),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        connection === null ||
        unit.organizationKey !== entry.organizationKey ||
        unit.connectionKey !== entry.connectionKey ||
        unit.connectionGeneration !== entry.connectionGeneration ||
        unit.lifecycle.state !== "active" ||
        connection.organizationKey !== entry.organizationKey ||
        connection.connectionKey !== entry.connectionKey ||
        connection.connectionGeneration !== entry.connectionGeneration ||
        connection.status !== "active" ||
        (options.requireCurrentRevision &&
          unit.currentUnitRevisionKey !== origin.unitRevisionKey) ||
        (options.requireCurrentRevision &&
          unit.lifecycle.generation !== entry.lifecycleGeneration)
      )
        return false;
      const routes = yield* reader
        .table("callRoutingProposals")
        .index("by_org_revision", (index) =>
          index
            .eq("organizationKey", entry.organizationKey)
            .eq("unitRevisionKey", unit.currentUnitRevisionKey),
        )
        .take(101)
        .pipe(Effect.orDie);
      if (routes.length > 100) return false;
      const route = routes
        .filter(
          (candidate) =>
            (candidate.status === "current" ||
              candidate.status === "accepted") &&
            candidate.outcome === "routed" &&
            candidate.brainKey === entry.brainKey,
        )
        .sort((left, right) => right.routeGeneration - left.routeGeneration)[0];
      return (
        route !== undefined &&
        (!options.requireCurrentRevision ||
          entry.routeGeneration === route.routeGeneration)
      );
    }
    return origin.kind === "document" || origin.kind === "projection";
  });

const verifyCitationEvidence = (
  entry: RetrievalEntriesDoc,
  brain: {
    readonly organizationId: string;
    readonly organizationKey: string;
    readonly workspaceId: string;
  },
  options: {
    readonly requireCurrentRevision: boolean;
    readonly eligibilityVerified?: boolean | undefined;
  },
) =>
  Effect.gen(function* () {
    if (
      options.eligibilityVerified !== true &&
      !(yield* currentEntryEligible(entry, options))
    )
      return yield* citationFailure(entry, "origin_mismatch");
    const reader = yield* DatabaseReader;
    const origin = entry.origin;
    if (origin.kind === "page") {
      const [page, revision] = yield* Effect.all([
        reader
          .table("brainPages")
          .index("by_workspace_page_key", (index) =>
            index
              .eq("workspaceId", entry.workspaceId)
              .eq("pageKey", origin.pageKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie),
        reader
          .table("pageRevisions")
          .index("by_workspace_revision_key", (index) =>
            index
              .eq("workspaceId", entry.workspaceId)
              .eq("revisionKey", origin.revisionKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie),
      ]);
      if (page === null || revision === null)
        return yield* citationFailure(entry, "origin_missing");
      if (
        String(revision.organizationId) !== String(brain.organizationId) ||
        page.status !== "active" ||
        page.lifecycle?.state !== "active" ||
        page.pageKey !== origin.pageKey ||
        (options.requireCurrentRevision &&
          page.currentRevisionKey !== origin.revisionKey) ||
        entry.kind !== "page" ||
        entry.originTable !== "pageRevisions" ||
        entry.sourceKey !== origin.pageKey ||
        revision.pageKey !== origin.pageKey ||
        revision.revisionKey !== entry.sourceRevisionKey ||
        revision.state !== "published" ||
        revision.lifecycle.state !== "active"
      )
        return yield* citationFailure(entry, "origin_mismatch");
      const text = yield* verifiedPassage(
        entry,
        revision.markdown,
        revision.revisionKey,
      );
      return { text, locator: entry.locator };
    }
    if (origin.kind === "slack") {
      const revision = yield* reader
        .table("sourceRevisions")
        .index("by_source_revision_key", (index) =>
          index
            .eq("organizationKey", brain.organizationKey)
            .eq("sourceRevisionKey", origin.sourceRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (revision === null)
        return yield* citationFailure(entry, "origin_missing");
      if (
        entry.kind !== "slack" ||
        entry.originTable !== "sourceRevisions" ||
        entry.sourceKey !== origin.sourceKey ||
        revision.organizationKey !== brain.organizationKey ||
        revision.connectionKey !== entry.connectionKey ||
        revision.connectionGeneration !== entry.connectionGeneration ||
        revision.sourceKey !== origin.sourceKey ||
        revision.sourceRevisionKey !== entry.sourceRevisionKey ||
        revision.tombstone ||
        revision.lifecycle.state !== "active"
      )
        return yield* citationFailure(entry, "origin_mismatch");
      const text = yield* verifiedPassage(
        entry,
        revision.normalizedText,
        revision.sourceRevisionKey,
      );
      return { text, locator: revision.permalink };
    }
    if (origin.kind === "transcript") {
      const [unit, revision, segment] = yield* Effect.all([
        reader
          .table("sourceUnits")
          .index("by_unit_key", (index) =>
            index
              .eq("organizationKey", brain.organizationKey)
              .eq("unitKey", origin.unitKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie),
        reader
          .table("sourceUnitRevisions")
          .index("by_unit_revision_key", (index) =>
            index
              .eq("organizationKey", brain.organizationKey)
              .eq("unitRevisionKey", origin.unitRevisionKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie),
        reader
          .table("sourceSegments")
          .index("by_segment_key", (index) =>
            index
              .eq("organizationKey", brain.organizationKey)
              .eq("segmentKey", origin.segmentKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie),
      ]);
      if (unit === null || revision === null || segment === null)
        return yield* citationFailure(entry, "origin_missing");
      if (
        entry.kind !== "transcript" ||
        entry.originTable !== "sourceUnitRevisions" ||
        entry.sourceKey !== origin.unitKey ||
        (options.requireCurrentRevision &&
          unit.currentUnitRevisionKey !== origin.unitRevisionKey) ||
        unit.lifecycle.state !== "active" ||
        revision.unitKey !== origin.unitKey ||
        revision.unitRevisionKey !== origin.unitRevisionKey ||
        revision.unitRevisionKey !== entry.sourceRevisionKey ||
        revision.tombstone ||
        segment.unitKey !== origin.unitKey ||
        segment.unitRevisionKey !== origin.unitRevisionKey ||
        segment.segmentKey !== origin.segmentKey
      )
        return yield* citationFailure(entry, "origin_mismatch");
      const text = yield* verifiedPassage(
        entry,
        segment.text,
        `${revision.unitRevisionKey}:${segment.segmentKey}`,
      );
      return {
        text,
        locator: `${revision.sourceUrl}#segment=${segment.segmentKey}`,
      };
    }
    if (origin.kind === "document" || origin.kind === "projection")
      return { text: entry.text, locator: entry.locator };
    return yield* citationFailure(entry, "unsupported_origin");
  });

const getSource = (
  args: {
    readonly brainKey: string;
    readonly sourceRevisionKey?: string | undefined;
    readonly entryKey?: string | undefined;
    readonly publicationSetKey?: string | undefined;
    readonly compatibilityMode?: "legacy" | undefined;
  },
  selector: ReadSelector,
) =>
  Effect.gen(function* () {
    if (args.entryKey === undefined && args.sourceRevisionKey === undefined)
      return yield* new ValidationFailed({
        field: "entryKey",
        message: "entryKey or sourceRevisionKey is required.",
      });
    if (args.entryKey !== undefined && args.publicationSetKey === undefined)
      return yield* new ValidationFailed({
        field: "publicationSetKey",
        message: "publicationSetKey is required with entryKey.",
      });
    if (args.entryKey === undefined && args.publicationSetKey !== undefined)
      return yield* new ValidationFailed({
        field: "entryKey",
        message: "entryKey is required with publicationSetKey.",
      });
    const brain = yield* resolveReadBrain(selector);
    const reader = yield* DatabaseReader;
    const requestedEntryKey = args.entryKey;
    const requestedRevisionKey = args.sourceRevisionKey;
    const exactLookup = requestedEntryKey !== undefined;
    const candidates = yield* (
      exactLookup
        ? reader
            .table("retrievalEntries")
            .index("by_workspace_brain_publication_set_entry", (index) =>
              index
                .eq("workspaceId", brain.workspaceId)
                .eq("brainKey", brain.brainKey)
                .eq("publicationSetKey", args.publicationSetKey ?? "")
                .eq("entryKey", requestedEntryKey),
            )
            .take(1)
        : reader
            .table("retrievalEntries")
            .index("by_workspace_brain_revision_entry", (index) =>
              index
                .eq("workspaceId", brain.workspaceId)
                .eq("brainKey", brain.brainKey)
                .eq("sourceRevisionKey", requestedRevisionKey ?? ""),
            )
            .take(20)
    ).pipe(Effect.orDie);
    const candidateSets = yield* Effect.all(
      candidates.map((candidate) =>
        reader
          .table("retrievalPublicationSets")
          .index("by_workspace_publication_set", (index) =>
            index
              .eq("workspaceId", brain.workspaceId)
              .eq("publicationSetKey", candidate.publicationSetKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie),
      ),
    );
    const entryIndex = candidates.findIndex((candidate, index) =>
      exactLookup
        ? (candidate.state === "published" || candidate.state === "revoked") &&
          (candidateSets[index]?.state === "current" ||
            candidateSets[index]?.state === "retired")
        : candidate.state === "published" &&
          candidateSets[index]?.state === "current",
    );
    const entry = entryIndex < 0 ? null : (candidates[entryIndex] ?? null);
    if (entry === null) {
      if (exactLookup)
        return yield* new ValidationFailed({
          field: "publicationSetKey",
          message: "Retrieval publication is unavailable or retired.",
        });
      if (args.compatibilityMode !== "legacy")
        return yield* new ValidationFailed({
          field: "sourceRevisionKey",
          message: "Source revision is unavailable.",
        });
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
    const evidence = exactLookup
      ? yield* verifyCitationEvidence(entry, brain, {
          requireCurrentRevision: false,
        })
      : { text: entry.text, locator: entry.locator };
    return {
      brainKey: brain.brainKey,
      ...toRetrievalResult(
        {
          ...entry,
          text: evidence.text,
          ...(evidence.locator === undefined
            ? { locator: undefined }
            : { locator: evidence.locator }),
        },
        freshnessFor(entry, at, healthByCorpus),
      ),
      revisionKey: entry.sourceRevisionKey,
      status:
        exactLookup && candidateSets[entryIndex]?.state === "retired"
          ? "superseded"
          : "published",
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
    readonly compatibilityMode?: "legacy" | undefined;
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
            entries: entries.map(({ publicationSetKey, entryKey }) => ({
              publicationSetKey,
              entryKey,
            })),
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

    if (args.compatibilityMode !== "legacy")
      return yield* new ValidationFailed({
        field: "question",
        message: "question is required when compatibility mode is disabled.",
      });

    // Compatibility only for explicitly opted-in pre-projection callers.
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
            publicationSetKey: "legacy",
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
