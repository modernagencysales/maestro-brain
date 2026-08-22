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
  RetrievalTokenCatalogDoc,
  RetrievalTokensDoc,
} from "../_generated/docs";
import { DatabaseReader } from "../_generated/services";
import { ValidationFailed } from "../errors";
import { SubsystemDisabled } from "../ops/brainOperations.spec";
import { sha256Hex } from "../shared/sha256";
import { requireBrainAccess, requireHeadlessBrainAccess } from "./pages.impl";
import {
  connectionFenceIdentity,
  connectorAllowlistFenceIdentity,
  connectorScopeFenceIdentity,
  documentLifecycleFenceIdentity,
  pageLifecycleFenceIdentity,
  slackPolicyFenceIdentity,
  slackSourceLifecycleFenceIdentity,
  transcriptRouteFenceIdentity,
  transcriptUnitLifecycleFenceIdentity,
} from "./retrievalEligibility";
import {
  buildRetrievalPassages,
  RETRIEVAL_CANDIDATE_LIMIT,
  RETRIEVAL_CONTEXT_ENTRY_LIMIT,
  RETRIEVAL_CONTEXT_MAX_BYTES,
  RETRIEVAL_ELIGIBILITY_FENCE_MAX,
  RETRIEVAL_POSTING_LIMIT,
  queryCenteredExcerpt,
  retrievalScore,
  retrievalEligibilityFenceKey,
  selectTopRetrievalCandidates,
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
  RetrievalCapacityExceeded,
  RetrievalIntegrityFailure,
  SearchResult,
} from "./readApi.spec";
import {
  operationPolicyFromRecord,
  operationPolicyKey,
} from "../ops/brainOperationPolicy";
import { evaluateBrainRolloutStatusEffect } from "./rolloutStatus.impl";
import { buildCandidateManifestV2 } from "./contextPackV2";
import {
  RETRIEVAL_TOKEN_CATALOG_SET_LIMIT,
  retrievalTokenCatalogIsConsistent,
  retrievalTokenCatalogProjection,
} from "./retrievalTokenCatalog";
import { validatePublicationSetIntegrityEffect } from "./publicationIntegrity";

const now = () =>
  Clock.currentTimeMillis as Effect.Effect<number, never, never>;

const REVISION_ONLY_LOOKUP_LIMIT = 20;
const RETRIEVAL_HYDRATION_CANDIDATE_LIMIT = RETRIEVAL_CANDIDATE_LIMIT;
const COMPATIBILITY_POLICY_VERSION_LIMIT = 100;
const COMPATIBILITY_PAGE_LIMIT = 500;
const COMPATIBILITY_CITATION_LIMIT = 1_000;

const ensureOperationEnabled = (workspaceId: string, subsystem: "ask") =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const policyKey = operationPolicyKey(workspaceId, subsystem);
    const rows = yield* reader
      .table("policies")
      .index("by_policy_version", (q) => q.eq("policyKey", policyKey), "desc")
      .take(COMPATIBILITY_POLICY_VERSION_LIMIT + 1)
      .pipe(Effect.orDie);
    if (rows.length > COMPATIBILITY_POLICY_VERSION_LIMIT)
      return yield* new RetrievalCapacityExceeded({
        resource: "compatibility_policy_versions",
        limit: COMPATIBILITY_POLICY_VERSION_LIMIT,
        observedAtLeast: rows.length,
      });
    const row = rows.find(
      (candidate) =>
        candidate.policyKey === policyKey &&
        candidate.workspaceId === workspaceId &&
        candidate.kind === "agent.config" &&
        candidate.status === "active",
    );
    if (row === undefined) return;
    const policy = operationPolicyFromRecord(row);
    if (policy.state === "disabled")
      return yield* new SubsystemDisabled({ subsystem });
  });

const loadBoundedCompatibilityRows = (input: {
  readonly workspaceId: GenericId<"workspaces">;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const [pages, citations] = yield* Effect.all([
      reader
        .table("brainPages")
        .index("by_workspace_status", (q) =>
          q.eq("workspaceId", input.workspaceId).eq("status", "active"),
        )
        .take(COMPATIBILITY_PAGE_LIMIT + 1),
      reader
        .table("citations")
        .index("by_workspace", (q) =>
          q.eq("workspaceId", String(input.workspaceId)),
        )
        .take(COMPATIBILITY_CITATION_LIMIT + 1),
    ]).pipe(Effect.orDie);
    if (pages.length > COMPATIBILITY_PAGE_LIMIT)
      return yield* new RetrievalCapacityExceeded({
        resource: "compatibility_pages",
        limit: COMPATIBILITY_PAGE_LIMIT,
        observedAtLeast: pages.length,
      });
    if (citations.length > COMPATIBILITY_CITATION_LIMIT)
      return yield* new RetrievalCapacityExceeded({
        resource: "compatibility_citations",
        limit: COMPATIBILITY_CITATION_LIMIT,
        observedAtLeast: citations.length,
      });
    return { reader, pages, citations };
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
    const { reader, pages, citations } = yield* loadBoundedCompatibilityRows({
      workspaceId: brain.workspaceId,
    });
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

const loadBrainReadMode = (selector: ReadSelector) =>
  Effect.gen(function* () {
    const brain = yield* resolveReadBrain(selector);
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("brainReadModes")
      .index("by_workspace_brain", (index) =>
        index
          .eq("workspaceId", brain.workspaceId)
          .eq("brainKey", brain.brainKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const row = rows[0];
    if (
      rows.length > 1 ||
      (row !== undefined && row.organizationKey !== brain.organizationKey) ||
      row?.mode === "disabled"
    )
      return yield* new SubsystemDisabled({ subsystem: "brain.read" });
    return {
      brain,
      mode: row?.mode ?? ("compatibility" as const),
    };
  });

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
      return yield* new RetrievalCapacityExceeded({
        resource: "active_slack_policies",
        limit: ACTIVE_SLACK_POLICY_LIMIT,
        observedAtLeast: slackPolicies.length,
      });
    if (transcriptConnections.length > ACTIVE_PROVIDER_CONNECTION_LIMIT)
      return yield* new RetrievalCapacityExceeded({
        resource: "active_provider_connections",
        limit: ACTIVE_PROVIDER_CONNECTION_LIMIT,
        observedAtLeast: transcriptConnections.length,
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
  queryTokens: readonly string[] = [],
) => {
  const excerpt = queryCenteredExcerpt({ text: entry.text, queryTokens });
  return {
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
    excerpt: excerpt.excerpt,
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
    truncated: excerpt.truncated,
    state: "resolved" as const,
  };
};

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
      return yield* new RetrievalCapacityExceeded({
        resource: "corpus_health",
        limit: CORPUS_HEALTH_LIMIT,
        observedAtLeast: healthRows.length,
      });
    const omissions: Array<{ reason: string; count: number }> = [];
    const publicationSets = new Map<
      string,
      RetrievalPublicationSetsDoc | null
    >();
    const publicationSetFor = (publicationSetKey: string) =>
      Effect.gen(function* () {
        const cached = publicationSets.get(publicationSetKey);
        if (cached !== undefined) return cached;
        const rows = yield* reader
          .table("retrievalPublicationSets")
          .index("by_workspace_publication_set", (index) =>
            index
              .eq("workspaceId", brain.workspaceId)
              .eq("publicationSetKey", publicationSetKey),
          )
          .take(2)
          .pipe(Effect.orDie);
        if (rows.length > 1)
          return yield* new RetrievalIntegrityFailure({
            token: "",
            reason: "publication_integrity_failure",
            publicationSetKey,
          });
        const publicationSet = rows[0] ?? null;
        publicationSets.set(publicationSetKey, publicationSet);
        return publicationSet;
      });
    const publicationSetStateFor = (publicationSetKey: string) =>
      Effect.map(
        publicationSetFor(publicationSetKey),
        (publicationSet) => publicationSet?.state ?? null,
      );
    const validatedPublicationSets = new Set<string>();
    const validatePublicationSet = (publicationSetKey: string) =>
      Effect.gen(function* () {
        if (validatedPublicationSets.has(publicationSetKey)) return;
        const publicationSet = yield* publicationSetFor(publicationSetKey);
        if (
          publicationSet === null ||
          (publicationSet.state !== "current" &&
            publicationSet.state !== "retired")
        )
          return yield* new RetrievalIntegrityFailure({
            token: "",
            reason: "publication_integrity_failure",
            publicationSetKey,
          });
        const validation = yield* validatePublicationSetIntegrityEffect({
          ...publicationSet,
          state: publicationSet.state as "current" | "retired",
        });
        if (
          validation.kind === "capacity" ||
          validation.report.issues.length > 0
        )
          return yield* new RetrievalIntegrityFailure({
            token: "",
            reason: "publication_integrity_failure",
            publicationSetKey,
          });
        validatedPublicationSets.add(publicationSetKey);
      });
    const postingsByEntry = new Map<string, RetrievalTokensDoc[]>();
    const addPosting = (posting: RetrievalTokensDoc) => {
      const candidateKey = `${posting.publicationSetKey}\u0000${posting.entryKey}`;
      postingsByEntry.set(candidateKey, [
        ...(postingsByEntry.get(candidateKey) ?? []),
        posting,
      ]);
    };
    const catalogGroups = yield* Effect.all(
      queryTokens.map((token) =>
        reader
          .table("retrievalTokenCatalog")
          .index("by_workspace_brain_token", (index) =>
            index
              .eq("workspaceId", brain.workspaceId)
              .eq("brainKey", brain.brainKey)
              .eq("token", token),
          )
          .take(2)
          .pipe(
            Effect.map((rows) => ({ token, rows })),
            Effect.orDie,
          ),
      ),
    );
    const catalogByToken = new Map<string, RetrievalTokenCatalogDoc>();
    let expectedPostingCount = 0;
    for (const { token, rows } of catalogGroups) {
      if (rows.length > 1)
        return yield* new RetrievalIntegrityFailure({
          token,
          reason: "catalog_duplicate",
          observedPostingCount: rows.length,
        });
      const catalog = rows[0];
      if (catalog === undefined) continue;
      if (
        catalog.organizationKey !== brain.organizationKey ||
        catalog.workspaceId !== brain.workspaceId ||
        catalog.brainKey !== brain.brainKey ||
        catalog.tokenizerVersion !== 1 ||
        catalog.token !== token ||
        !retrievalTokenCatalogIsConsistent(catalog)
      )
        return yield* new RetrievalIntegrityFailure({
          token,
          reason: "catalog_identity_mismatch",
          expectedPostingCount: catalog.expectedPostingCount,
        });
      expectedPostingCount += catalog.expectedPostingCount;
      if (expectedPostingCount > RETRIEVAL_POSTING_LIMIT)
        return yield* new RetrievalCapacityExceeded({
          resource: "current_postings",
          limit: RETRIEVAL_POSTING_LIMIT,
          observedAtLeast: expectedPostingCount,
        });
      catalogByToken.set(token, catalog);
    }

    const classifiedByToken = new Map<string, readonly RetrievalTokensDoc[]>();
    const unclassifiedByToken = new Map<
      string,
      readonly RetrievalTokensDoc[]
    >();
    let rawPostingCount = 0;
    const loadBoundedPostings = (
      token: string,
      publicationState: "current" | undefined,
      resource: "current_postings" | "unclassified_postings",
    ) =>
      Effect.gen(function* () {
        const remaining = RETRIEVAL_POSTING_LIMIT - rawPostingCount;
        const rows = yield* reader
          .table("retrievalTokens")
          .index(
            "by_workspace_brain_token_publication_state_authority_entry",
            (index) =>
              index
                .eq("workspaceId", brain.workspaceId)
                .eq("brainKey", brain.brainKey)
                .eq("token", token)
                .eq("publicationState", publicationState),
          )
          .take(remaining + 1)
          .pipe(Effect.orDie);
        if (rows.length > remaining)
          return yield* new RetrievalCapacityExceeded({
            resource,
            limit: RETRIEVAL_POSTING_LIMIT,
            observedAtLeast: rawPostingCount + rows.length,
          });
        rawPostingCount += rows.length;
        return rows;
      });
    for (const token of queryTokens)
      classifiedByToken.set(
        token,
        yield* loadBoundedPostings(token, "current", "current_postings"),
      );
    for (const token of queryTokens)
      unclassifiedByToken.set(
        token,
        yield* loadBoundedPostings(token, undefined, "unclassified_postings"),
      );

    for (const token of queryTokens)
      for (const posting of [
        ...(classifiedByToken.get(token) ?? []),
        ...(unclassifiedByToken.get(token) ?? []),
      ])
        if (
          posting.organizationKey !== brain.organizationKey ||
          posting.workspaceId !== brain.workspaceId ||
          posting.brainKey !== brain.brainKey ||
          posting.tokenizerVersion !== 1 ||
          posting.token !== token
        )
          return yield* new RetrievalIntegrityFailure({
            token,
            reason: "catalog_identity_mismatch",
            publicationSetKey: posting.publicationSetKey,
            entryKey: posting.entryKey,
          });

    const publicationSetKeys = new Set<string>();
    for (const postings of [
      ...classifiedByToken.values(),
      ...unclassifiedByToken.values(),
    ])
      for (const posting of postings)
        publicationSetKeys.add(posting.publicationSetKey);
    for (const publicationSetKey of publicationSetKeys)
      yield* publicationSetStateFor(publicationSetKey);

    for (const token of queryTokens) {
      const classified = classifiedByToken.get(token) ?? [];
      for (const posting of classified)
        if (publicationSets.get(posting.publicationSetKey)?.state !== "current")
          return yield* new RetrievalIntegrityFailure({
            token,
            reason: "posting_set_mismatch",
            publicationSetKey: posting.publicationSetKey,
            entryKey: posting.entryKey,
          });
      const legacyCurrent = (unclassifiedByToken.get(token) ?? []).filter(
        (posting) =>
          publicationSets.get(posting.publicationSetKey)?.state === "current",
      );
      const postings = [...classified, ...legacyCurrent];
      const projection = retrievalTokenCatalogProjection(postings);
      if (projection.contributions.length > RETRIEVAL_TOKEN_CATALOG_SET_LIMIT)
        return yield* new RetrievalIntegrityFailure({
          token,
          reason: "catalog_capacity_overflow",
          observedPostingCount: postings.length,
        });
      const catalog = catalogByToken.get(token);
      if (catalog === undefined) {
        if (postings.length === 0) continue;
        return yield* new RetrievalIntegrityFailure({
          token,
          reason: "catalog_missing",
          observedPostingCount: postings.length,
          observedPostingDigest: projection.expectedPostingDigest,
        });
      }
      if (catalog.expectedPostingCount !== postings.length)
        return yield* new RetrievalIntegrityFailure({
          token,
          reason: "posting_count_mismatch",
          expectedPostingCount: catalog.expectedPostingCount,
          observedPostingCount: postings.length,
          expectedPostingDigest: catalog.expectedPostingDigest,
          observedPostingDigest: projection.expectedPostingDigest,
        });
      if (catalog.expectedPostingDigest !== projection.expectedPostingDigest)
        return yield* new RetrievalIntegrityFailure({
          token,
          reason: "posting_digest_mismatch",
          expectedPostingCount: catalog.expectedPostingCount,
          observedPostingCount: postings.length,
          expectedPostingDigest: catalog.expectedPostingDigest,
          observedPostingDigest: projection.expectedPostingDigest,
        });
      for (const posting of postings) addPosting(posting);
    }

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
    const allCandidateKeys = [...postingsByEntry].map(
      ([candidateKey, postings]) => {
        const separator = candidateKey.indexOf("\u0000");
        return {
          publicationSetKey: candidateKey.slice(0, separator),
          entryKey: candidateKey.slice(separator + 1),
          candidateKey,
          postings,
        };
      },
    );
    let candidateKeys = allCandidateKeys;
    if (allCandidateKeys.length > RETRIEVAL_HYDRATION_CANDIDATE_LIMIT) {
      const ranked: Array<
        (typeof allCandidateKeys)[number] & { readonly score: number }
      > = [];
      for (const candidate of allCandidateKeys) {
        const first = candidate.postings[0];
        if (
          first === undefined ||
          first.corpusKey === undefined ||
          first.evidenceAt === undefined ||
          candidate.postings.some(
            (posting) =>
              posting.corpusKey !== first.corpusKey ||
              posting.evidenceAt !== first.evidenceAt ||
              posting.authorityRank !== first.authorityRank,
          )
        )
          return yield* new RetrievalIntegrityFailure({
            token: first?.token ?? "",
            reason: "posting_summary_missing",
            publicationSetKey: candidate.publicationSetKey,
            entryKey: candidate.entryKey,
          });
        const health = healthByCorpus.get(first.corpusKey);
        const freshness =
          health === undefined
            ? ("unknown" as const)
            : at - first.evidenceAt <= health.freshnessThresholdMs
              ? ("current" as const)
              : ("stale" as const);
        ranked.push({
          ...candidate,
          score: retrievalScore({
            queryTokens,
            postings: candidate.postings,
            authority:
              first.authorityRank === 1
                ? "authoritative"
                : first.authorityRank === 3
                  ? "advisory"
                  : "derived",
            freshness,
          }),
        });
      }
      candidateKeys = selectTopRetrievalCandidates(
        ranked,
        RETRIEVAL_HYDRATION_CANDIDATE_LIMIT,
      );
    }
    const active: Array<{
      entry: RetrievalEntriesDoc;
      evidence: {
        readonly text: string;
        readonly locator?: string | undefined;
      };
      score: number;
    }> = [];
    for (let offset = 0; offset < candidateKeys.length; offset += 40) {
      const keys = candidateKeys.slice(offset, offset + 40);
      const rowSets = yield* Effect.all(
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
            .take(2)
            .pipe(Effect.orDie),
        ),
      );
      for (let index = 0; index < rowSets.length; index += 1) {
        const rows = rowSets[index] ?? [];
        const key = keys[index];
        if (key === undefined) continue;
        if (rows.length === 0) {
          const posting = postingsByEntry.get(key.candidateKey)?.[0];
          return yield* new RetrievalIntegrityFailure({
            token: posting?.token ?? "",
            reason: "entry_missing",
            publicationSetKey: key.publicationSetKey,
            entryKey: key.entryKey,
          });
        }
        if (rows.length !== 1)
          return yield* citationFailure(key, "origin_mismatch");
        const entry = rows[0];
        if (entry === undefined || entry.state !== "published")
          return yield* citationFailure(key, "origin_mismatch");
        if (entry.origin.kind === "projection")
          return yield* citationFailure(entry, "unsupported_origin");
        if (
          (yield* publicationSetStateFor(entry.publicationSetKey)) !== "current"
        )
          continue;
        yield* validatePublicationSet(entry.publicationSetKey);
        if (!(yield* currentEntryEligible(entry))) {
          const omission = omissions.find(
            ({ reason }) => reason === "eligibility_revoked",
          );
          if (omission === undefined)
            omissions.push({ reason: "eligibility_revoked", count: 1 });
          else omission.count += 1;
          continue;
        }
        const evidence = yield* verifyCitationEvidence(entry, brain, {
          requireCurrentRevision: true,
          eligibilityVerified: true,
        });
        const freshness = freshnessFor(entry, at, healthByCorpus);
        const candidatePostings = postingsByEntry.get(key.candidateKey) ?? [];
        if (
          candidatePostings.some(
            (posting) =>
              (posting.corpusKey !== undefined &&
                posting.corpusKey !== entry.corpusKey) ||
              (posting.evidenceAt !== undefined &&
                posting.evidenceAt !==
                  (entry.sourceModifiedAt ?? entry.observedAt)) ||
              posting.authorityRank !==
                (entry.authority === "authoritative"
                  ? 1
                  : entry.authority === "advisory"
                    ? 3
                    : 2),
          )
        )
          return yield* new RetrievalIntegrityFailure({
            token: candidatePostings[0]?.token ?? "",
            reason: "posting_summary_mismatch",
            publicationSetKey: entry.publicationSetKey,
            entryKey: entry.entryKey,
          });
        active.push({
          entry,
          evidence,
          score: retrievalScore({
            queryTokens,
            postings: candidatePostings,
            authority: entry.authority,
            freshness,
          }),
        });
      }
    }
    const perRevision = new Map<string, number>();
    const results = selectTopRetrievalCandidates(
      active.map((candidate) => ({
        ...candidate,
        entryKey: candidate.entry.entryKey,
      })),
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
            queryTokens,
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
    const { mode } = yield* loadBrainReadMode(selector);
    if (mode === "projection")
      return yield* validationSearchSources(args, selector);
    const query = args.query.trim();
    if (!query)
      return yield* new ValidationFailed({
        field: "query",
        message: "query is required.",
      });
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
      brainKey: legacy.brain.brainKey,
      results: legacyResults,
      coverage: [
        {
          sourceKind: "transcripts",
          status: "unknown" as const,
          freshness: "unknown" as const,
          reason:
            "Legacy transcript compatibility path; no publication coverage receipt.",
        },
      ],
      omissions:
        legacyResults.length === 0
          ? []
          : [
              {
                reason: "legacy transcript compatibility path",
                count: legacyResults.length,
              },
            ],
    };
  });

const validationSearchSources = (
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
    return {
      brainKey: projection.brain.brainKey,
      results: projection.results,
      coverage: projection.coverage,
      omissions: projection.omissions,
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
const validationSourcesSearch = FunctionImpl.make(
  databaseSchema,
  readApi,
  "validationSourcesSearch",
  (args) => validationSearchSources(args, args),
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

type PublicationEligibilityStatus =
  | { readonly status: "eligible" }
  | { readonly status: "revoked" }
  | { readonly status: "integrity_failure" };

const publicationEligibilityStatus = (entry: RetrievalEntriesDoc) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const publicationSets = yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_publication_set", (index) =>
        index
          .eq("workspaceId", entry.workspaceId)
          .eq("publicationSetKey", entry.publicationSetKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const publicationSet = publicationSets[0];
    if (
      publicationSets.length !== 1 ||
      publicationSet === undefined ||
      publicationSet.organizationKey !== entry.organizationKey
    )
      return { status: "integrity_failure" } as const;
    const refs = publicationSet.eligibilityFences;
    if (refs === undefined) return { status: "integrity_failure" } as const;
    if (
      refs.length === 0 ||
      refs.length > RETRIEVAL_ELIGIBILITY_FENCE_MAX ||
      new Set(refs.map(({ fenceKey }) => fenceKey)).size !== refs.length ||
      new Set(refs.map(({ kind }) => kind)).size !== refs.length
    )
      return { status: "integrity_failure" } as const;
    const expectedIdentities = (() => {
      if (entry.origin.kind === "page")
        return [
          pageLifecycleFenceIdentity({
            organizationKey: entry.organizationKey,
            workspaceId: String(entry.workspaceId),
            pageKey: entry.origin.pageKey,
          }),
        ];
      if (entry.origin.kind === "slack") {
        if (
          entry.connectorScopeKey === undefined ||
          entry.connectionKey === undefined
        )
          return null;
        return [
          slackSourceLifecycleFenceIdentity({
            organizationKey: entry.organizationKey,
            sourceKey: entry.origin.sourceKey,
          }),
          slackPolicyFenceIdentity({
            organizationKey: entry.organizationKey,
            channelKey: entry.connectorScopeKey,
            brainKey: entry.brainKey,
          }),
          connectionFenceIdentity({
            organizationKey: entry.organizationKey,
            connectionKey: entry.connectionKey,
          }),
        ];
      }
      if (entry.origin.kind === "transcript") {
        if (entry.connectionKey === undefined) return null;
        return [
          transcriptUnitLifecycleFenceIdentity({
            organizationKey: entry.organizationKey,
            unitKey: entry.origin.unitKey,
          }),
          transcriptRouteFenceIdentity({
            organizationKey: entry.organizationKey,
            unitKey: entry.origin.unitKey,
            brainKey: entry.brainKey,
          }),
          connectionFenceIdentity({
            organizationKey: entry.organizationKey,
            connectionKey: entry.connectionKey,
          }),
        ];
      }
      if (entry.origin.kind === "document") {
        if (
          entry.connectorScopeKey === undefined ||
          entry.connectionKey === undefined ||
          entry.origin.connectorScopeKey !== entry.connectorScopeKey ||
          entry.origin.connectionKey !== entry.connectionKey ||
          entry.origin.objectKey !== entry.sourceKey
        )
          return null;
        return [
          documentLifecycleFenceIdentity({
            organizationKey: entry.organizationKey,
            documentObjectKey: entry.origin.objectKey,
          }),
          connectorScopeFenceIdentity({
            organizationKey: entry.organizationKey,
            connectorScopeKey: entry.connectorScopeKey,
          }),
          connectorAllowlistFenceIdentity({
            organizationKey: entry.organizationKey,
            connectorScopeKey: entry.connectorScopeKey,
          }),
          connectionFenceIdentity({
            organizationKey: entry.organizationKey,
            connectionKey: entry.connectionKey,
          }),
        ];
      }
      return [];
    })();
    if (expectedIdentities === null)
      return { status: "integrity_failure" } as const;
    const expected = expectedIdentities.map((identity) => ({
      ...identity,
      fenceKey: retrievalEligibilityFenceKey(identity),
    }));
    if (
      expected.length > 0 &&
      (refs.length !== expected.length ||
        !expected.every((identity) =>
          refs.some(
            (ref) =>
              ref.kind === identity.kind && ref.fenceKey === identity.fenceKey,
          ),
        ))
    )
      return { status: "integrity_failure" } as const;
    const fences = yield* Effect.all(
      refs.map(({ fenceKey }) =>
        reader
          .table("retrievalEligibilityFences")
          .index("by_organization_fence", (index) =>
            index
              .eq("organizationKey", entry.organizationKey)
              .eq("fenceKey", fenceKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ),
    );
    let revoked = false;
    for (let index = 0; index < refs.length; index += 1) {
      const ref = refs[index];
      if (ref === undefined) return { status: "integrity_failure" } as const;
      const matches = fences[index];
      const fence = matches?.[0];
      const expectedIdentity = expected.find(
        ({ kind, fenceKey }) => kind === ref.kind && fenceKey === ref.fenceKey,
      );
      if (
        matches?.length !== 1 ||
        fence === undefined ||
        fence.kind !== ref.kind ||
        fence.eligibilityGeneration < ref.eligibilityGeneration ||
        (expected.length > 0 &&
          (expectedIdentity === undefined ||
            fence.controllerKey !== expectedIdentity.controllerKey))
      )
        return { status: "integrity_failure" } as const;
      if (
        fence.eligibilityGeneration > ref.eligibilityGeneration ||
        !fence.eligible
      )
        revoked = true;
    }
    return revoked
      ? ({ status: "revoked" } as const)
      : ({ status: "eligible" } as const);
  });

const currentEntryEligible = (
  entry: RetrievalEntriesDoc,
  options: { readonly requireCurrentRevision: boolean } = {
    requireCurrentRevision: true,
  },
) =>
  Effect.gen(function* () {
    const eligibility: PublicationEligibilityStatus =
      yield* publicationEligibilityStatus(entry);
    if (eligibility.status === "integrity_failure")
      return yield* new RetrievalIntegrityFailure({
        token: "",
        reason: "eligibility_integrity_failure",
        publicationSetKey: entry.publicationSetKey,
        entryKey: entry.entryKey,
      });
    if (eligibility.status === "revoked") return false;
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
      const [artifact, connection, revision] = yield* Effect.all([
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
        reader
          .table("sourceRevisions")
          .index("by_source_revision_key", (index) =>
            index
              .eq("organizationKey", entry.organizationKey)
              .eq("sourceRevisionKey", origin.sourceRevisionKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie),
      ]);
      if (
        artifact === null ||
        connection === null ||
        revision === null ||
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
        policy.historicalBackfillStartAt !== undefined &&
        revision.sourceCreatedAt >= policy.historicalBackfillStartAt &&
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
    if (origin.kind === "document") {
      if (
        entry.kind !== "document" ||
        entry.originTable !== "documentSourceRevisions" ||
        entry.connectionKey === undefined ||
        entry.connectionGeneration === undefined ||
        entry.connectorScopeKey === undefined ||
        origin.connectionKey !== entry.connectionKey ||
        origin.connectorScopeKey !== entry.connectorScopeKey ||
        origin.objectKey !== entry.sourceKey ||
        origin.revisionKey !== entry.sourceRevisionKey
      )
        return false;
      const revisions = yield* reader
        .table("documentSourceRevisions")
        .index("by_organization_revision_key", (index) =>
          index
            .eq("organizationKey", entry.organizationKey)
            .eq("documentRevisionKey", origin.revisionKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (revisions.length !== 1) return false;
      const revision = revisions[0];
      if (revision === undefined) return false;
      const [objects, scopes, connections, pointers] = yield* Effect.all([
        reader
          .table("documentSourceObjects")
          .index("by_organization_object_key", (index) =>
            index
              .eq("organizationKey", entry.organizationKey)
              .eq("documentObjectKey", origin.objectKey),
          )
          .take(2)
          .pipe(Effect.orDie),
        reader
          .table("connectorScopes")
          .index("by_connector_scope_key", (index) =>
            index.eq("connectorScopeKey", entry.connectorScopeKey ?? ""),
          )
          .take(2)
          .pipe(Effect.orDie),
        reader
          .table("providerConnections")
          .index("by_connection_key", (index) =>
            index.eq("connectionKey", entry.connectionKey ?? ""),
          )
          .take(2)
          .pipe(Effect.orDie),
        reader
          .table("documentSourceScopePointers")
          .index("by_scope_tuple_object", (index) =>
            index
              .eq("connectorScopeKey", entry.connectorScopeKey ?? "")
              .eq("connectionGeneration", entry.connectionGeneration ?? 0)
              .eq("allowlistGeneration", revision.allowlistGeneration)
              .eq("documentObjectKey", origin.objectKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      const object = objects[0];
      const scope = scopes[0];
      const connection = connections[0];
      const pointer = pointers[0];
      return (
        objects.length === 1 &&
        scopes.length === 1 &&
        connections.length === 1 &&
        pointers.length === 1 &&
        object !== undefined &&
        scope !== undefined &&
        connection !== undefined &&
        pointer !== undefined &&
        object.lifecycleState === "live" &&
        object.documentObjectKey === origin.objectKey &&
        revision.organizationKey === entry.organizationKey &&
        revision.documentObjectKey === origin.objectKey &&
        revision.documentRevisionKey === origin.revisionKey &&
        revision.connectionKey === entry.connectionKey &&
        revision.connectionGeneration === entry.connectionGeneration &&
        revision.connectorScopeKey === entry.connectorScopeKey &&
        !revision.tombstone &&
        scope.organizationKey === entry.organizationKey &&
        scope.providerKind === "google_drive" &&
        scope.connectionKey === entry.connectionKey &&
        scope.currentConnectionGeneration === entry.connectionGeneration &&
        scope.currentAllowlistGeneration === revision.allowlistGeneration &&
        scope.state === "active" &&
        connection.organizationKey === entry.organizationKey &&
        connection.connectionKey === entry.connectionKey &&
        connection.connectionGeneration === entry.connectionGeneration &&
        connection.status === "active" &&
        pointer.lifecycleState === "live" &&
        (!options.requireCurrentRevision ||
          pointer.currentRevisionKey === origin.revisionKey)
      );
    }
    if (origin.kind === "projection") {
      if (
        entry.kind !== "projection" ||
        entry.originTable !== "brainSources" ||
        entry.sourceKey !== origin.projectionKey ||
        entry.sourceRevisionKey !== origin.revisionKey
      )
        return false;
      const sources = yield* reader
        .table("brainSources")
        .index("by_workspace_source_key", (index) =>
          index
            .eq("workspaceId", entry.workspaceId)
            .eq("sourceKey", origin.projectionKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      const source = sources[0];
      return (
        sources.length === 1 &&
        source !== undefined &&
        source.status === "published" &&
        source.sourceKey === origin.revisionKey
      );
    }
    return false;
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
      return {
        text,
        locator: entry.locator,
        superseded: page.currentRevisionKey !== origin.revisionKey,
      };
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
      return { text, locator: revision.permalink, superseded: false };
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
        superseded: unit.currentUnitRevisionKey !== origin.unitRevisionKey,
      };
    }
    if (origin.kind === "document") {
      const [objects, revisions] = yield* Effect.all([
        reader
          .table("documentSourceObjects")
          .index("by_organization_object_key", (index) =>
            index
              .eq("organizationKey", brain.organizationKey)
              .eq("documentObjectKey", origin.objectKey),
          )
          .take(2)
          .pipe(Effect.orDie),
        reader
          .table("documentSourceRevisions")
          .index("by_organization_revision_key", (index) =>
            index
              .eq("organizationKey", brain.organizationKey)
              .eq("documentRevisionKey", origin.revisionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      if (objects.length === 0 || revisions.length === 0)
        return yield* citationFailure(entry, "origin_missing");
      const object = objects[0];
      const revision = revisions[0];
      if (
        objects.length !== 1 ||
        revisions.length !== 1 ||
        object === undefined ||
        revision === undefined ||
        object.lifecycleState !== "live" ||
        entry.kind !== "document" ||
        entry.originTable !== "documentSourceRevisions" ||
        entry.sourceKey !== origin.objectKey ||
        entry.sourceRevisionKey !== origin.revisionKey ||
        entry.connectionKey !== origin.connectionKey ||
        entry.connectorScopeKey !== origin.connectorScopeKey ||
        revision.organizationKey !== brain.organizationKey ||
        revision.documentObjectKey !== origin.objectKey ||
        revision.documentRevisionKey !== origin.revisionKey ||
        revision.connectionKey !== origin.connectionKey ||
        revision.connectorScopeKey !== origin.connectorScopeKey ||
        revision.connectionGeneration !== entry.connectionGeneration ||
        revision.tombstone ||
        sha256Hex(revision.normalizedText) !== revision.contentHash
      )
        return yield* citationFailure(entry, "origin_mismatch");
      const text = yield* verifiedPassage(
        entry,
        revision.normalizedText,
        revision.documentRevisionKey,
      );
      return {
        text,
        locator: revision.sourceLocator,
        superseded: false,
      };
    }
    if (origin.kind === "projection") {
      const sources = yield* reader
        .table("brainSources")
        .index("by_workspace_source_key", (index) =>
          index
            .eq("workspaceId", entry.workspaceId)
            .eq("sourceKey", origin.projectionKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (sources.length === 0)
        return yield* citationFailure(entry, "origin_missing");
      const source = sources[0];
      if (
        sources.length !== 1 ||
        source === undefined ||
        String(source.organizationId) !== String(brain.organizationId) ||
        source.status !== "published" ||
        source.sourceKey !== origin.projectionKey ||
        origin.revisionKey !== source.sourceKey ||
        entry.kind !== "projection" ||
        entry.originTable !== "brainSources" ||
        entry.sourceKey !== source.sourceKey ||
        entry.sourceRevisionKey !== source.sourceKey
      )
        return yield* citationFailure(entry, "origin_mismatch");
      const text = yield* verifiedPassage(
        entry,
        source.markdown,
        origin.revisionKey,
      );
      return { text, locator: entry.locator, superseded: false };
    }
    return yield* citationFailure(entry, "unsupported_origin");
  });

const getProjectionSource = (
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
            .take(2)
        : reader
            .table("retrievalEntries")
            .index("by_workspace_brain_revision_entry", (index) =>
              index
                .eq("workspaceId", brain.workspaceId)
                .eq("brainKey", brain.brainKey)
                .eq("sourceRevisionKey", requestedRevisionKey ?? ""),
            )
            .take(REVISION_ONLY_LOOKUP_LIMIT + 1)
    ).pipe(Effect.orDie);
    if (exactLookup && candidates.length > 1)
      return yield* new RetrievalIntegrityFailure({
        token: "",
        reason: "publication_integrity_failure",
        publicationSetKey: args.publicationSetKey,
        entryKey: requestedEntryKey,
      });
    if (!exactLookup && candidates.length > REVISION_ONLY_LOOKUP_LIMIT)
      return yield* new RetrievalCapacityExceeded({
        resource: "revision_entries",
        limit: REVISION_ONLY_LOOKUP_LIMIT,
        observedAtLeast: candidates.length,
      });
    const candidateSetRows = yield* Effect.all(
      candidates.map((candidate) =>
        reader
          .table("retrievalPublicationSets")
          .index("by_workspace_publication_set", (index) =>
            index
              .eq("workspaceId", brain.workspaceId)
              .eq("publicationSetKey", candidate.publicationSetKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ),
    );
    if (candidateSetRows.some((rows) => rows.length > 1))
      return yield* new RetrievalIntegrityFailure({
        token: "",
        reason: "publication_integrity_failure",
        publicationSetKey: args.publicationSetKey,
      });
    const candidateSets = candidateSetRows.map((rows) => rows[0] ?? null);
    const candidateSubjects = yield* Effect.all(
      candidates.map((candidate) =>
        candidate.publicationSubjectKey === undefined
          ? Effect.succeed(null)
          : reader
              .table("retrievalPublicationSubjects")
              .index("by_workspace_brain_subject", (index) =>
                index
                  .eq("workspaceId", brain.workspaceId)
                  .eq("brainKey", brain.brainKey)
                  .eq(
                    "publicationSubjectKey",
                    candidate.publicationSubjectKey ?? "",
                  ),
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
      return yield* new ValidationFailed({
        field: "sourceRevisionKey",
        message: "Source revision is unavailable.",
      });
    }
    const publicationSet = candidateSets[entryIndex];
    if (publicationSet === null || publicationSet === undefined)
      return yield* new RetrievalIntegrityFailure({
        token: "",
        reason: "publication_integrity_failure",
        publicationSetKey: entry.publicationSetKey,
        entryKey: entry.entryKey,
      });
    if (
      publicationSet.state !== "current" &&
      publicationSet.state !== "retired"
    )
      return yield* new RetrievalIntegrityFailure({
        token: "",
        reason: "publication_integrity_failure",
        publicationSetKey: entry.publicationSetKey,
        entryKey: entry.entryKey,
      });
    if (entry.origin.kind === "projection")
      return yield* citationFailure(entry, "unsupported_origin");
    const publicationValidation = yield* validatePublicationSetIntegrityEffect({
      ...publicationSet,
      state: publicationSet.state as "current" | "retired",
    });
    if (
      publicationValidation.kind === "capacity" ||
      publicationValidation.report.issues.length > 0
    )
      return yield* new RetrievalIntegrityFailure({
        token: "",
        reason: "publication_integrity_failure",
        publicationSetKey: entry.publicationSetKey,
        entryKey: entry.entryKey,
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
    const evidence = yield* verifyCitationEvidence(entry, brain, {
      requireCurrentRevision: !exactLookup,
    });
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
        exactLookup &&
        (evidence.superseded ||
          candidateSets[entryIndex]?.state === "retired" ||
          (candidateSubjects[entryIndex] !== null &&
            candidateSubjects[entryIndex]?.currentPublicationSetKey !==
              entry.publicationSetKey))
          ? "superseded"
          : "published",
    };
  });

const getCompatibilitySource = (
  args: {
    readonly brainKey: string;
    readonly sourceRevisionKey?: string | undefined;
    readonly entryKey?: string | undefined;
    readonly publicationSetKey?: string | undefined;
  },
  selector: ReadSelector,
) =>
  Effect.gen(function* () {
    const { mode } = yield* loadBrainReadMode(selector);
    if (mode === "projection")
      return yield* getProjectionSource(args, selector);
    if (
      args.sourceRevisionKey === undefined ||
      args.entryKey !== undefined ||
      args.publicationSetKey !== undefined
    )
      return yield* new ValidationFailed({
        field: "sourceRevisionKey",
        message:
          "Compatibility source-get requires a legacy sourceRevisionKey.",
      });
    const legacy = yield* loadTranscriptReadContext(selector);
    const transcript = legacy.transcripts.find(
      ({ sourceRevisionKey }) => sourceRevisionKey === args.sourceRevisionKey,
    );
    if (transcript === undefined)
      return yield* new ValidationFailed({
        field: "sourceRevisionKey",
        message: "Source revision is unavailable.",
      });
    return {
      brainKey: legacy.brain.brainKey,
      ...legacyTranscriptResult(transcript),
      revisionKey: transcript.sourceRevisionKey,
      status: "published",
    };
  });

const sourcesGet = FunctionImpl.make(
  databaseSchema,
  readApi,
  "sourcesGet",
  (args) => getCompatibilitySource(args, { brainKey: args.brainKey }),
);
const headlessSourcesGet = FunctionImpl.make(
  databaseSchema,
  readApi,
  "headlessSourcesGet",
  (args) => getCompatibilitySource(args, args),
);
const validationSourcesGet = FunctionImpl.make(
  databaseSchema,
  readApi,
  "validationSourcesGet",
  (args) => getProjectionSource(args, args),
);

const contextPackEntries = (
  brainKey: string,
  entries: readonly SearchResultValue[],
) =>
  entries.map((entry) => ({
    kind: entry.kind,
    brainKey,
    title: entry.title,
    excerpt: entry.excerpt,
    sourceKey: entry.sourceKey,
    revisionKey: entry.sourceRevisionKey,
    sourceRevisionKey: entry.sourceRevisionKey,
    publicationSetKey: entry.publicationSetKey,
    entryKey: entry.entryKey,
    passageKey: entry.passageKey,
    ...(entry.unitKey === undefined ? {} : { unitKey: entry.unitKey }),
    ...(entry.segmentKey === undefined ? {} : { segmentKey: entry.segmentKey }),
    startOffset: entry.startOffset,
    endOffset: entry.endOffset,
    ...(entry.locator === undefined ? {} : { locator: entry.locator }),
    contentHash: entry.contentHash,
    authority: entry.authority,
    ...(entry.sourceModifiedAt === undefined
      ? {}
      : { sourceModifiedAt: entry.sourceModifiedAt }),
    observedAt: entry.observedAt,
    indexedAt: entry.indexedAt,
    freshness: entry.freshness,
    truncated: entry.truncated,
    citationKey: entry.citationKey,
    ...(entry.citationLabel === undefined
      ? {}
      : { citationLabel: entry.citationLabel }),
    ...(entry.permalink === undefined ? {} : { permalink: entry.permalink }),
    authorityPolicyKey: entry.authorityPolicyKey,
    state: entry.state,
  }));

const candidateManifestForContext = (
  entries: ReturnType<typeof contextPackEntries>,
) =>
  buildCandidateManifestV2({
    entries: entries.map((entry) => ({
      kind: entry.kind,
      publicationSetKey: entry.publicationSetKey,
      entryKey: entry.entryKey,
      revisionKey: entry.revisionKey,
      contentHash: entry.contentHash,
    })),
    structuredFacts: [],
  });

type BrainRolloutStatus = Effect.Effect.Success<
  ReturnType<typeof evaluateBrainRolloutStatusEffect>
>;

const contextCoverageFromRollout = (status: BrainRolloutStatus) =>
  status.scopes.map((scope) => {
    const unresolvedFailureCount =
      scope.health.failedCount +
      scope.obligations.nonterminalCount +
      scope.publication.unresolvedCount +
      scope.failures.capacityCount +
      scope.failures.publicationIntegrityCount +
      scope.failures.eligibilityIntegrityCount;
    return {
      corpusKey: scope.corpusKey,
      sourceKind: scope.providerKind,
      connectorScopeKey: scope.connectorScopeKey,
      required: true,
      status: scope.coverageStatus,
      freshness: scope.freshness,
      generations: {
        connection: scope.configuration.connectionGeneration,
        allowlist: scope.configuration.allowlistGeneration,
        ...(scope.reconciliation.runGeneration === null
          ? {}
          : { reconciliation: scope.reconciliation.runGeneration }),
      },
      ...(scope.health.lastObservedAt === null
        ? {}
        : { lastObservedAt: scope.health.lastObservedAt }),
      ...(scope.health.lastReconciledAt === null
        ? {}
        : { lastReconciledAt: scope.health.lastReconciledAt }),
      unresolvedFailureCount,
      ...(scope.blockers.length === 0
        ? {}
        : { reason: scope.blockers.join(",") }),
    };
  });

const getProjectionContext = (
  args: {
    readonly brainKey: string;
    readonly question?: string | undefined;
    readonly maxBytes?: number | undefined;
  },
  selector: ReadSelector,
) =>
  Effect.gen(function* () {
    const question = args.question?.trim() ?? "";
    if (!question)
      return yield* new ValidationFailed({
        field: "question",
        message: "question is required for projection validation.",
      });
    const byteLimit = Math.min(
      RETRIEVAL_CONTEXT_MAX_BYTES,
      Math.max(1, args.maxBytes ?? RETRIEVAL_CONTEXT_MAX_BYTES),
    );
    const projection = yield* searchProjection(
      question,
      selector,
      RETRIEVAL_CONTEXT_ENTRY_LIMIT,
    );
    const rolloutStatus = yield* evaluateBrainRolloutStatusEffect({
      organizationKey: projection.brain.organizationKey,
      workspaceId: projection.brain.workspaceId,
      brainKey: projection.brain.brainKey,
      now: projection.at,
    });
    const availableEntries = contextPackEntries(
      projection.brain.brainKey,
      projection.results,
    );
    const buildPack = (
      contextEntries: typeof availableEntries,
      omittedForBytes: number,
    ) => ({
      schemaVersion: "3" as const,
      candidateManifest: candidateManifestForContext(contextEntries),
      requestId: `ctx_${sha256Hex(
        JSON.stringify({
          brainKey: projection.brain.brainKey,
          question,
          asOf: projection.at,
          entries: contextEntries.map(({ publicationSetKey, entryKey }) => ({
            publicationSetKey,
            entryKey,
          })),
        }),
      )}`,
      organizationKey: projection.brain.organizationKey,
      brainKey: projection.brain.brainKey,
      question,
      asOf: projection.at,
      freshness: rolloutStatus.freshness,
      coverageStatus: rolloutStatus.coverageStatus,
      readiness: rolloutStatus.readiness,
      coverage: contextCoverageFromRollout(rolloutStatus),
      entries: contextEntries,
      structuredFacts: [],
      omissions: [
        ...projection.omissions,
        ...(omittedForBytes > 0
          ? [{ reason: "context byte capacity", count: omittedForBytes }]
          : []),
      ],
      conflicts: [],
      structuredConflicts: [],
    });
    const encodedSize = (value: unknown) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength;
    let context = buildPack([], availableEntries.length);
    const baseBytes = encodedSize(context);
    if (baseBytes > byteLimit)
      return yield* new RetrievalCapacityExceeded({
        resource: "context_pack_bytes",
        limit: byteLimit,
        observedAtLeast: baseBytes,
      });
    for (let index = 0; index < availableEntries.length; index += 1) {
      const candidate = buildPack(
        availableEntries.slice(0, index + 1),
        availableEntries.length - index - 1,
      );
      const candidateBytes = encodedSize(candidate);
      if (candidateBytes > byteLimit) break;
      context = candidate;
    }
    return context;
  });

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
    const { mode } = yield* loadBrainReadMode(selector);
    if (mode === "projection")
      return yield* getProjectionContext(args, selector);
    const question = args.question?.trim() ?? "";
    const byteLimit = Math.min(
      RETRIEVAL_CONTEXT_MAX_BYTES,
      Math.max(1, args.maxBytes ?? RETRIEVAL_CONTEXT_MAX_BYTES),
    );
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
    const contextEntries = contextPackEntries(brain.brainKey, entries);
    const context = {
      schemaVersion: "3" as const,
      candidateManifest: candidateManifestForContext(contextEntries),
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
      freshness: "unknown" as const,
      coverageStatus: "unknown" as const,
      readiness: "blocked" as const,
      coverage: [
        {
          corpusKey: "brain-pages",
          sourceKind: "brain-pages",
          connectorScopeKey: "legacy",
          required: false,
          status: "unknown" as const,
          freshness: "unknown" as const,
          generations: {},
          unresolvedFailureCount: 0,
          reason:
            "Legacy page compatibility path; no publication coverage receipt.",
        },
      ],
      entries: contextEntries,
      structuredFacts: [],
      omissions: [
        { reason: "legacy page compatibility path", count: entries.length },
      ],
      conflicts: [],
      structuredConflicts: [],
    };
    const encodedBytes = new TextEncoder().encode(
      JSON.stringify(context),
    ).byteLength;
    if (encodedBytes > byteLimit)
      return yield* new RetrievalCapacityExceeded({
        resource: "context_pack_bytes",
        limit: byteLimit,
        observedAtLeast: encodedBytes,
      });
    return context;
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
const validationContextGet = FunctionImpl.make(
  databaseSchema,
  readApi,
  "validationContextGet",
  (args) => getProjectionContext(args, args),
);

const askAnswer = (
  args: { readonly brainKey: string; readonly question: string },
  selector: ReadSelector,
) =>
  Effect.gen(function* () {
    const { brain: modeBrain, mode } = yield* loadBrainReadMode(selector);
    if (mode === "projection") {
      yield* ensureOperationEnabled(modeBrain.workspaceId, "ask");
      const context = yield* getProjectionContext(args, selector);
      const evidence = context.entries.slice(0, 3).map((entry) => ({
        citationKey: entry.citationKey,
        pageKey: entry.sourceKey,
        revisionKey: entry.sourceRevisionKey,
        title: entry.title,
        excerpt: entry.excerpt,
      }));
      return {
        brainKey: context.brainKey,
        response:
          context.readiness === "blocked" || evidence.length === 0
            ? {
                status: "abstained" as const,
                reason: "insufficient_evidence" as const,
                answer: null,
                evidence: [] as const,
              }
            : {
                status: "answered" as const,
                answer: evidence
                  .map(
                    ({ excerpt, citationKey }) => `${excerpt} [${citationKey}]`,
                  )
                  .join(" "),
                evidence,
              },
      };
    }
    const { brain, reader, pages, citations, transcripts } =
      yield* loadTranscriptReadContext(selector);
    yield* ensureOperationEnabled(brain.workspaceId, "ask");
    const question = args.question.trim().toLowerCase();
    if (!question)
      return yield* new ValidationFailed({
        field: "question",
        message: "question is required.",
      });
    const revisionGroups = yield* Effect.all(
      pages
        .filter(
          (page) =>
            typeof page.pageKey === "string" &&
            typeof page.currentRevisionKey === "string",
        )
        .map((page) =>
          reader
            .table("pageRevisions")
            .index("by_workspace_revision_key", (q) =>
              q
                .eq("workspaceId", brain.workspaceId)
                .eq("revisionKey", String(page.currentRevisionKey)),
            )
            .take(2)
            .pipe(Effect.orDie),
        ),
      { concurrency: 16 },
    );
    const duplicateCurrentRevision = revisionGroups.find(
      (group) => group.length > 1,
    );
    if (duplicateCurrentRevision !== undefined)
      return yield* new RetrievalCapacityExceeded({
        resource: "compatibility_page_revisions",
        limit: 1,
        observedAtLeast: duplicateCurrentRevision.length,
      });
    const revisions = revisionGroups.flat();
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

const getBrainRolloutStatus = (selector: ReadSelector) =>
  Effect.gen(function* () {
    const brain = yield* resolveReadBrain(selector);
    const evaluatedAt = yield* now();
    return yield* evaluateBrainRolloutStatusEffect({
      organizationKey: brain.organizationKey,
      workspaceId: brain.workspaceId,
      brainKey: brain.brainKey,
      now: evaluatedAt,
    });
  });

const brainRolloutStatus = FunctionImpl.make(
  databaseSchema,
  readApi,
  "brainRolloutStatus",
  (args) => getBrainRolloutStatus({ brainKey: args.brainKey }),
);
const headlessBrainRolloutStatus = FunctionImpl.make(
  databaseSchema,
  readApi,
  "headlessBrainRolloutStatus",
  (args) => getBrainRolloutStatus(args),
);

export default GroupImpl.make(databaseSchema, readApi).pipe(
  Layer.provide(sourcesSearch),
  Layer.provide(sourcesGet),
  Layer.provide(contextGet),
  Layer.provide(answersAsk),
  Layer.provide(brainRolloutStatus),
  Layer.provide(headlessSourcesSearch),
  Layer.provide(headlessSourcesGet),
  Layer.provide(headlessContextGet),
  Layer.provide(headlessAnswersAsk),
  Layer.provide(headlessBrainRolloutStatus),
  Layer.provide(validationSourcesSearch),
  Layer.provide(validationSourcesGet),
  Layer.provide(validationContextGet),
  GroupImpl.finalize,
);
