import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import {
  requireWorkspaceAccess,
  requireWorkspaceActorAccess,
} from "../capabilities/_kit/workspaceAccess";
import { NotFound, ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import evidence from "./evidence.spec";
import {
  evidenceContentHash,
  evidenceTokens,
  projectEvidence,
  retireEvidence,
} from "./evidenceProjection";
import {
  addEvidenceCoverage,
  compareEvidenceCandidates,
  contributesEvidenceCoverage,
  hasSufficientEvidenceCoverage,
  selectEvidenceQueryTokens,
  type EvidenceRelevanceMode,
} from "./groundedRelevance";
import {
  connectorScopeIsWritable,
  loadEvidenceScopePolicy,
  providerScopeIsReadable,
  readableProviderScopeKey,
} from "./evidenceEligibility";
import { evidenceExcerpt } from "./evidenceExcerpt";
const DAY_MS = 24 * 60 * 60 * 1_000;
const HEALTH_COUNT_LIMIT = 1_000;
const RECONCILIATION_RETIRE_BATCH = 50;
const MAX_READABLE_REVISION_CANDIDATES = 16;
export const MAX_SEARCH_QUERY_TOKENS = 12;
export const MAX_SEARCH_POSTINGS_PER_PROVIDER_TOKEN = 64;
export const MAX_SEARCH_EXAMINED_ENTRIES = 6;
const EVIDENCE_PROVIDERS = [
  "brain_page",
  "slack",
  "google_drive",
  "hubspot",
  "transcript",
] as const;

type EvidenceSearchCitation = {
  readonly entryKey: string;
  readonly sourceKey: string;
  readonly revisionKey: string;
  readonly provider: (typeof EVIDENCE_PROVIDERS)[number];
  readonly title: string;
  readonly excerpt: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly contentHash: string;
  readonly bodyIdentity: string;
  readonly locator?: string | undefined;
  readonly sourceModifiedAt: number;
  readonly observedAt: number;
  readonly freshness: "current" | "review-due" | "stale";
};

const unsafeAssumeClockProvided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const freshness = (sourceModifiedAt: number, now: number) => {
  const age = Math.max(0, now - sourceModifiedAt);
  return age <= 30 * DAY_MS
    ? ("current" as const)
    : age <= 90 * DAY_MS
      ? ("review-due" as const)
      : ("stale" as const);
};

const requireRun = (workspaceId: GenericId<"workspaces">, runKey: string) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const run = yield* reader
      .table("brainConnectorRuns")
      .index("by_workspace_and_run_key", (q) =>
        q.eq("workspaceId", workspaceId).eq("runKey", runKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    return run === null
      ? yield* new NotFound({ resource: "brainConnectorRuns", id: runKey })
      : run;
  });

const connectorRunIsCurrent = (run: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly provider: (typeof EVIDENCE_PROVIDERS)[number];
  readonly scopeKey: string;
  readonly connectionGeneration?: number | undefined;
}) =>
  Effect.gen(function* () {
    if (run.connectionGeneration === undefined) return true;
    return connectorScopeIsWritable(
      yield* loadEvidenceScopePolicy(run.workspaceId),
      run,
    );
  });

export const loadReadableEvidenceRevisions = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly sourceKey: string;
  readonly revisionKey: string;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const policy = yield* loadEvidenceScopePolicy(input.workspaceId);
    const byProvider = yield* Effect.forEach(
      EVIDENCE_PROVIDERS,
      (provider) =>
        Effect.gen(function* () {
          const scopeKey = readableProviderScopeKey(policy, provider);
          if (scopeKey === null) return [];
          const providerRows =
            scopeKey === undefined
              ? yield* Effect.gen(function* () {
                  const candidates = yield* reader
                    .table("brainEvidenceRevisions")
                    .index(
                      "by_workspace_and_source_key_and_revision_key",
                      (q) =>
                        q
                          .eq("workspaceId", input.workspaceId)
                          .eq("sourceKey", input.sourceKey)
                          .eq("revisionKey", input.revisionKey),
                    )
                    .take(MAX_READABLE_REVISION_CANDIDATES + 1)
                    .pipe(Effect.orDie);
                  if (candidates.length > MAX_READABLE_REVISION_CANDIDATES)
                    return yield* new ValidationFailed({
                      field: "revisionKey",
                      message:
                        "Evidence revision candidate capacity was exceeded.",
                    });
                  return candidates.filter(
                    (revision) => revision.provider === provider,
                  );
                })
              : yield* reader
                  .table("brainEvidenceRevisions")
                  .index("by_workspace_provider_scope_source_revision", (q) =>
                    q
                      .eq("workspaceId", input.workspaceId)
                      .eq("provider", provider)
                      .eq("scopeKey", scopeKey)
                      .eq("sourceKey", input.sourceKey)
                      .eq("revisionKey", input.revisionKey),
                  )
                  .take(2)
                  .pipe(Effect.orDie);
          if (providerRows.length > 1)
            return yield* new ValidationFailed({
              field: "revisionKey",
              message: "Evidence revision has duplicate active-scope rows.",
            });
          return providerRows;
        }),
      { concurrency: 1 },
    );
    return byProvider.flat();
  });

const loadProviderTokenRows = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly provider: (typeof EVIDENCE_PROVIDERS)[number];
  readonly scopeKey: string | undefined | null;
  readonly token: string;
}) =>
  Effect.gen(function* () {
    const scopeKey = input.scopeKey;
    if (scopeKey === null) return [];
    const reader = yield* DatabaseReader;
    return scopeKey === undefined
      ? yield* reader
          .table("brainRetrievalTokens")
          .index("by_workspace_provider_token", (q) =>
            q
              .eq("workspaceId", input.workspaceId)
              .eq("provider", input.provider)
              .eq("token", input.token),
          )
          .take(MAX_SEARCH_POSTINGS_PER_PROVIDER_TOKEN)
          .pipe(Effect.orDie)
      : yield* reader
          .table("brainRetrievalTokens")
          .index("by_workspace_provider_scope_token", (q) =>
            q
              .eq("workspaceId", input.workspaceId)
              .eq("provider", input.provider)
              .eq("scopeKey", scopeKey)
              .eq("token", input.token),
          )
          .take(MAX_SEARCH_POSTINGS_PER_PROVIDER_TOKEN)
          .pipe(Effect.orDie);
  });

const searchEvidence = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly query: string;
  readonly limit?: number | undefined;
  readonly asOf: number;
  readonly relevanceMode?: EvidenceRelevanceMode | undefined;
}) =>
  Effect.gen(function* () {
    const relevanceMode = input.relevanceMode ?? "broad";
    const queryTokens = selectEvidenceQueryTokens(
      evidenceTokens("", input.query).map(({ token }) => token),
      relevanceMode,
    ).slice(0, MAX_SEARCH_QUERY_TOKENS);
    if (queryTokens.length === 0) return [] as EvidenceSearchCitation[];
    const reader = yield* DatabaseReader;
    const scopePolicy = yield* loadEvidenceScopePolicy(input.workspaceId);
    const candidates = new Map<
      string,
      {
        readonly entryKey: string;
        readonly passageStartOffset: number;
        readonly passageEndOffset: number;
        readonly matchedTokens: Set<string>;
        score: number;
      }
    >();
    for (const token of queryTokens) {
      const scopedByProvider = yield* Effect.forEach(
        EVIDENCE_PROVIDERS,
        (provider) =>
          loadProviderTokenRows({
            workspaceId: input.workspaceId,
            provider,
            scopeKey: readableProviderScopeKey(scopePolicy, provider),
            token,
          }),
        { concurrency: 1 },
      );
      const legacy = yield* reader
        .table("brainRetrievalTokens")
        .index("by_workspace_and_scope_key_and_token", (q) =>
          q
            .eq("workspaceId", input.workspaceId)
            .eq("scopeKey", undefined)
            .eq("token", token),
        )
        .take(MAX_SEARCH_POSTINGS_PER_PROVIDER_TOKEN)
        .pipe(Effect.orDie);
      const postings = [...scopedByProvider.flat(), ...legacy].filter(
        (posting) =>
          posting.provider === undefined ||
          readableProviderScopeKey(scopePolicy, posting.provider) !== null,
      );
      for (const posting of postings) {
        const candidateKey =
          posting.passageKey === undefined
            ? posting.entryKey
            : `${posting.entryKey}:${posting.passageKey}`;
        const candidate = candidates.get(candidateKey) ?? {
          entryKey: posting.entryKey,
          passageStartOffset: posting.passageStartOffset ?? 0,
          passageEndOffset:
            posting.passageEndOffset ?? Number.POSITIVE_INFINITY,
          matchedTokens: new Set<string>(),
          score: 0,
        };
        candidate.matchedTokens.add(token);
        candidate.score += posting.weight;
        candidates.set(candidateKey, candidate);
      }
    }
    const ranked = [...candidates.entries()].sort((left, right) =>
      compareEvidenceCandidates(relevanceMode, left, right),
    );
    const citationLimit = Math.min(
      Math.max(Math.floor(input.limit ?? 3), 1),
      10,
    );
    const citations: EvidenceSearchCitation[] = [];
    const examinedEntries = new Set<string>();
    const coveredTokens = new Set<string>();
    for (const [, candidate] of ranked) {
      if (citations.length >= citationLimit) break;
      if (examinedEntries.has(candidate.entryKey)) continue;
      if (
        !contributesEvidenceCoverage(
          relevanceMode,
          candidate.matchedTokens,
          coveredTokens,
        )
      )
        continue;
      if (examinedEntries.size >= MAX_SEARCH_EXAMINED_ENTRIES) break;
      examinedEntries.add(candidate.entryKey);
      const entry = yield* reader
        .table("brainRetrievalEntries")
        .index("by_workspace_and_entry_key", (q) =>
          q
            .eq("workspaceId", input.workspaceId)
            .eq("entryKey", candidate.entryKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (entry === null || entry.status !== "current") continue;
      if (
        entry.contentHash !== evidenceContentHash(entry.title, entry.markdown)
      )
        return yield* new ValidationFailed({
          field: "contentHash",
          message: "A retrieval entry failed integrity validation.",
        });
      const entryScopeKey = entry.scopeKey;
      const revisions =
        entryScopeKey === undefined
          ? yield* loadReadableEvidenceRevisions({
              workspaceId: input.workspaceId,
              sourceKey: entry.sourceKey,
              revisionKey: entry.revisionKey,
            })
          : yield* reader
              .table("brainEvidenceRevisions")
              .index("by_workspace_provider_scope_source_revision", (q) =>
                q
                  .eq("workspaceId", input.workspaceId)
                  .eq("provider", entry.provider)
                  .eq("scopeKey", entryScopeKey)
                  .eq("sourceKey", entry.sourceKey)
                  .eq("revisionKey", entry.revisionKey),
              )
              .take(2)
              .pipe(Effect.orDie);
      const matchingRevisions = revisions.filter(
        (revision) =>
          (entry.scopeKey === undefined ||
            revision.scopeKey === entry.scopeKey) &&
          revision.provider === entry.provider &&
          revision.contentHash === entry.contentHash &&
          revision.title === entry.title &&
          revision.markdown === entry.markdown,
      );
      const [revision] = matchingRevisions;
      if (
        matchingRevisions.length !== 1 ||
        revision === undefined ||
        revision.tombstone ||
        !providerScopeIsReadable(scopePolicy, entry.provider, revision.scopeKey)
      )
        continue;
      const sources = yield* reader
        .table("brainEvidenceSources")
        .index("by_workspace_provider_scope_source", (q) =>
          q
            .eq("workspaceId", input.workspaceId)
            .eq("provider", entry.provider)
            .eq("scopeKey", revision.scopeKey)
            .eq("sourceKey", entry.sourceKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      const [source] = sources;
      if (
        sources.length !== 1 ||
        source === undefined ||
        source.status !== "active" ||
        source.currentRevisionKey !== entry.revisionKey ||
        source.scopeKey !== revision.scopeKey
      )
        continue;
      const selectedExcerpt = evidenceExcerpt(
        entry.markdown,
        queryTokens,
        candidate.passageStartOffset,
        Math.min(candidate.passageEndOffset, entry.markdown.length),
      );
      if (selectedExcerpt.excerpt.trim().length === 0) continue;
      citations.push({
        entryKey: entry.entryKey,
        sourceKey: entry.sourceKey,
        revisionKey: entry.revisionKey,
        provider: entry.provider,
        title: entry.title,
        ...selectedExcerpt,
        contentHash: entry.contentHash,
        bodyIdentity: `sha256:${sha256Hex(
          entry.markdown
            .normalize("NFKC")
            .toLowerCase()
            .replace(/[^a-z0-9]+/gu, " ")
            .trim()
            .replace(/\s+/gu, " "),
        )}`,
        ...(entry.locator === undefined ? {} : { locator: entry.locator }),
        sourceModifiedAt: entry.sourceModifiedAt,
        observedAt: entry.observedAt,
        freshness: freshness(entry.sourceModifiedAt, input.asOf),
      });
      addEvidenceCoverage(coveredTokens, candidate.matchedTokens);
    }
    return hasSufficientEvidenceCoverage(
      relevanceMode,
      queryTokens.length,
      coveredTokens.size,
    )
      ? citations
      : ([] as EvidenceSearchCitation[]);
  });

const search = FunctionImpl.make(
  databaseSchema,
  evidence,
  "search",
  ({ workspaceId, ...args }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      return yield* searchEvidence({ workspaceId, ...args });
    }),
);

const searchForActor = FunctionImpl.make(
  databaseSchema,
  evidence,
  "searchForActor",
  ({ workspaceId, userId, ...args }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceActorAccess(workspaceId, userId, "viewer"),
      );
      return yield* searchEvidence({ workspaceId, ...args });
    }),
);

const getEvidenceSource = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly sourceKey: string;
  readonly revisionKey: string;
}) =>
  Effect.gen(function* () {
    const revisions = yield* loadReadableEvidenceRevisions(input);
    if (revisions.length !== 1)
      return yield* new NotFound({
        resource: "brainEvidenceRevisions",
        id: `${input.sourceKey}:${input.revisionKey}`,
      });
    const [revision] = revisions;
    if (revision === undefined)
      return yield* new NotFound({
        resource: "brainEvidenceRevisions",
        id: `${input.sourceKey}:${input.revisionKey}`,
      });
    if (
      revision.contentHash !==
      evidenceContentHash(revision.title, revision.markdown)
    )
      return yield* new ValidationFailed({
        field: "contentHash",
        message: "The immutable evidence revision failed integrity validation.",
      });
    return {
      sourceKey: revision.sourceKey,
      revisionKey: revision.revisionKey,
      provider: revision.provider,
      scopeKey: revision.scopeKey,
      title: revision.title,
      markdown: revision.markdown,
      contentHash: revision.contentHash,
      ...(revision.locator === undefined ? {} : { locator: revision.locator }),
      ...(revision.providerMetadataJson === undefined
        ? {}
        : { providerMetadataJson: revision.providerMetadataJson }),
      ...(revision.providerMetadataHash === undefined
        ? {}
        : { providerMetadataHash: revision.providerMetadataHash }),
      sourceModifiedAt: revision.sourceModifiedAt,
      observedAt: revision.observedAt,
      tombstone: revision.tombstone,
    };
  });

const sourceGet = FunctionImpl.make(
  databaseSchema,
  evidence,
  "sourceGet",
  ({ workspaceId, sourceKey, revisionKey }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      return yield* getEvidenceSource({ workspaceId, sourceKey, revisionKey });
    }),
);

const CURRENT_EVIDENCE_LIMIT = 200;

const listCurrentEvidence = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly provider?: (typeof EVIDENCE_PROVIDERS)[number] | undefined;
  readonly limit?: number | undefined;
}) =>
  Effect.gen(function* () {
    const limit = Math.min(
      Math.max(Math.floor(input.limit ?? 100), 1),
      CURRENT_EVIDENCE_LIMIT,
    );
    const providers =
      input.provider === undefined ? EVIDENCE_PROVIDERS : [input.provider];
    const reader = yield* DatabaseReader;
    const scopePolicy = yield* loadEvidenceScopePolicy(input.workspaceId);
    const sourcesByProvider = yield* Effect.forEach(
      providers,
      (provider) =>
        Effect.gen(function* () {
          const scopeKey = readableProviderScopeKey(scopePolicy, provider);
          if (scopeKey === null) return [];
          if (scopeKey === undefined)
            return yield* reader
              .table("brainEvidenceSources")
              .index("by_workspace_and_provider_and_status", (q) =>
                q
                  .eq("workspaceId", input.workspaceId)
                  .eq("provider", provider)
                  .eq("status", "active"),
              )
              .take(limit)
              .pipe(Effect.orDie);
          return yield* reader
            .table("brainEvidenceSources")
            .index("by_workspace_provider_scope_status", (q) =>
              q
                .eq("workspaceId", input.workspaceId)
                .eq("provider", provider)
                .eq("scopeKey", scopeKey)
                .eq("status", "active"),
            )
            .take(limit)
            .pipe(Effect.orDie);
        }),
      { concurrency: 1 },
    );
    const candidateSources = sourcesByProvider
      .flat()
      .sort((left, right) => right.sourceModifiedAt - left.sourceModifiedAt)
      .slice(0, limit);
    const candidates = [];
    for (const source of candidateSources) {
      const scopedEntries = yield* reader
        .table("brainRetrievalEntries")
        .index("by_workspace_provider_scope_source_status", (q) =>
          q
            .eq("workspaceId", input.workspaceId)
            .eq("provider", source.provider)
            .eq("scopeKey", source.scopeKey)
            .eq("sourceKey", source.sourceKey)
            .eq("status", "current"),
        )
        .take(2)
        .pipe(Effect.orDie);
      const entries =
        scopedEntries.length > 0
          ? scopedEntries
          : yield* reader
              .table("brainRetrievalEntries")
              .index("by_workspace_provider_scope_source_status", (q) =>
                q
                  .eq("workspaceId", input.workspaceId)
                  .eq("provider", source.provider)
                  .eq("scopeKey", undefined)
                  .eq("sourceKey", source.sourceKey)
                  .eq("status", "current"),
              )
              .take(2)
              .pipe(Effect.orDie);
      if (entries.length === 1 && entries[0] !== undefined)
        candidates.push(entries[0]);
    }
    const eligible: Array<{
      entryKey: string;
      sourceKey: string;
      revisionKey: string;
      provider: (typeof EVIDENCE_PROVIDERS)[number];
      title: string;
      excerpt: string;
      locator?: string | undefined;
      sourceModifiedAt: number;
      observedAt: number;
    }> = [];
    for (const entry of candidates) {
      if (eligible.length >= limit) break;
      if (
        entry.contentHash !== evidenceContentHash(entry.title, entry.markdown)
      )
        continue;
      const policyScopeKey = readableProviderScopeKey(
        scopePolicy,
        entry.provider,
      );
      const readableRevisions =
        entry.scopeKey === undefined && policyScopeKey === undefined
          ? yield* loadReadableEvidenceRevisions({
              workspaceId: input.workspaceId,
              sourceKey: entry.sourceKey,
              revisionKey: entry.revisionKey,
            })
          : [];
      const scopeKey =
        entry.scopeKey ??
        (typeof policyScopeKey === "string" ? policyScopeKey : undefined) ??
        readableRevisions.find(
          (revision) =>
            revision.provider === entry.provider &&
            revision.contentHash === entry.contentHash,
        )?.scopeKey;
      if (scopeKey === undefined) continue;
      const sources = yield* reader
        .table("brainEvidenceSources")
        .index("by_workspace_provider_scope_source", (q) =>
          q
            .eq("workspaceId", input.workspaceId)
            .eq("provider", entry.provider)
            .eq("scopeKey", scopeKey)
            .eq("sourceKey", entry.sourceKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      const [source] = sources;
      if (
        sources.length !== 1 ||
        source === undefined ||
        source.status !== "active" ||
        source.currentRevisionKey !== entry.revisionKey ||
        !providerScopeIsReadable(scopePolicy, entry.provider, scopeKey)
      )
        continue;
      eligible.push({
        entryKey: entry.entryKey,
        sourceKey: entry.sourceKey,
        revisionKey: entry.revisionKey,
        provider: entry.provider,
        title: entry.title,
        excerpt: entry.markdown.slice(0, 280),
        ...(entry.locator === undefined ? {} : { locator: entry.locator }),
        sourceModifiedAt: entry.sourceModifiedAt,
        observedAt: entry.observedAt,
      });
    }
    return eligible;
  });

const listCurrent = FunctionImpl.make(
  databaseSchema,
  evidence,
  "listCurrent",
  ({ workspaceId, ...args }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      return yield* listCurrentEvidence({ workspaceId, ...args });
    }),
);

const currentGet = FunctionImpl.make(
  databaseSchema,
  evidence,
  "currentGet",
  ({ workspaceId, entryKey }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      const entry = yield* (yield* DatabaseReader)
        .table("brainRetrievalEntries")
        .index("by_workspace_and_entry_key", (q) =>
          q.eq("workspaceId", workspaceId).eq("entryKey", entryKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (entry === null || entry.status !== "current") return null;
      const scopePolicy = yield* loadEvidenceScopePolicy(workspaceId);
      const policyScopeKey = readableProviderScopeKey(
        scopePolicy,
        entry.provider,
      );
      const readableRevisions =
        entry.scopeKey === undefined && policyScopeKey === undefined
          ? yield* loadReadableEvidenceRevisions({
              workspaceId,
              sourceKey: entry.sourceKey,
              revisionKey: entry.revisionKey,
            })
          : [];
      const scopeKey =
        entry.scopeKey ??
        (typeof policyScopeKey === "string" ? policyScopeKey : undefined) ??
        readableRevisions.find(
          (revision) =>
            revision.provider === entry.provider &&
            revision.contentHash === entry.contentHash,
        )?.scopeKey;
      if (scopeKey === undefined) return null;
      const sources = yield* (yield* DatabaseReader)
        .table("brainEvidenceSources")
        .index("by_workspace_provider_scope_source", (q) =>
          q
            .eq("workspaceId", workspaceId)
            .eq("provider", entry.provider)
            .eq("scopeKey", scopeKey)
            .eq("sourceKey", entry.sourceKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      const [source] = sources;
      if (
        sources.length !== 1 ||
        source === undefined ||
        source.status !== "active" ||
        source.currentRevisionKey !== entry.revisionKey ||
        !providerScopeIsReadable(scopePolicy, entry.provider, source.scopeKey)
      )
        return null;
      return yield* getEvidenceSource({
        workspaceId,
        sourceKey: entry.sourceKey,
        revisionKey: entry.revisionKey,
      });
    }),
);

const sourceGetForActor = FunctionImpl.make(
  databaseSchema,
  evidence,
  "sourceGetForActor",
  ({ workspaceId, userId, sourceKey, revisionKey }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceActorAccess(workspaceId, userId, "viewer"),
      );
      return yield* getEvidenceSource({ workspaceId, sourceKey, revisionKey });
    }),
);

const getEvidenceHealth = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const scopePolicy = yield* loadEvidenceScopePolicy(workspaceId);
    const providers = yield* Effect.forEach(
      EVIDENCE_PROVIDERS,
      (provider) =>
        Effect.gen(function* () {
          const scopeKey = readableProviderScopeKey(scopePolicy, provider);
          const sources =
            scopeKey === null
              ? []
              : scopeKey === undefined
                ? yield* reader
                    .table("brainEvidenceSources")
                    .index("by_workspace_and_provider", (q) =>
                      q.eq("workspaceId", workspaceId).eq("provider", provider),
                    )
                    .take(HEALTH_COUNT_LIMIT + 1)
                    .pipe(Effect.orDie)
                : [
                    ...(yield* reader
                      .table("brainEvidenceSources")
                      .index("by_workspace_provider_scope_status", (q) =>
                        q
                          .eq("workspaceId", workspaceId)
                          .eq("provider", provider)
                          .eq("scopeKey", scopeKey)
                          .eq("status", "active"),
                      )
                      .take(HEALTH_COUNT_LIMIT + 1)
                      .pipe(Effect.orDie)),
                    ...(yield* reader
                      .table("brainEvidenceSources")
                      .index("by_workspace_provider_scope_status", (q) =>
                        q
                          .eq("workspaceId", workspaceId)
                          .eq("provider", provider)
                          .eq("scopeKey", scopeKey)
                          .eq("status", "removed"),
                      )
                      .take(HEALTH_COUNT_LIMIT + 1)
                      .pipe(Effect.orDie)),
                  ];
          const latestRuns =
            scopeKey === null
              ? []
              : scopeKey === undefined
                ? yield* reader
                    .table("brainConnectorRuns")
                    .index("by_workspace_and_provider_and_updated_at", (q) =>
                      q.eq("workspaceId", workspaceId).eq("provider", provider),
                    )
                    .take(HEALTH_COUNT_LIMIT + 1)
                    .pipe(Effect.orDie)
                : yield* reader
                    .table("brainConnectorRuns")
                    .index("by_workspace_and_provider_and_scope_key", (q) =>
                      q
                        .eq("workspaceId", workspaceId)
                        .eq("provider", provider)
                        .eq("scopeKey", scopeKey),
                    )
                    .take(HEALTH_COUNT_LIMIT + 1)
                    .pipe(Effect.orDie);

          const capacityExceeded =
            sources.length > HEALTH_COUNT_LIMIT ||
            latestRuns.length > HEALTH_COUNT_LIMIT;
          const boundedSources = sources.slice(0, HEALTH_COUNT_LIMIT);
          const activeSourceCount = boundedSources.filter(
            ({ status }) => status === "active",
          ).length;
          const removedSourceCount = boundedSources.filter(
            ({ status }) => status === "removed",
          ).length;
          // Source activation and retrieval projection are committed in the
          // same mutation. Counting the lightweight source projection avoids
          // loading up to 24 MiB of Markdown merely to report health.
          const currentEntryCount = activeSourceCount;
          const coverageState = capacityExceeded
            ? ("unknown-capacity-exceeded" as const)
            : activeSourceCount === 0
              ? ("no-active-sources" as const)
              : currentEntryCount < activeSourceCount
                ? ("active-sources-not-fully-indexed" as const)
                : currentEntryCount === activeSourceCount
                  ? ("current-index-covers-active-sources" as const)
                  : ("current-index-has-extra-entries" as const);
          const latestRun = capacityExceeded
            ? null
            : (latestRuns.reduce<(typeof latestRuns)[number] | null>(
                (latest, run) =>
                  latest === null || run.updatedAt > latest.updatedAt
                    ? run
                    : latest,
                null,
              ) ?? null);
          const maxTimestamp = <Row>(
            rows: readonly Row[],
            read: (row: Row) => number,
          ): number | null =>
            rows.reduce<number | null>((latest, row) => {
              const value = read(row);
              return latest === null || value > latest ? value : latest;
            }, null);
          const latestSuccessfulRun = capacityExceeded
            ? null
            : latestRuns.reduce<(typeof latestRuns)[number] | null>(
                (latest, run) =>
                  run.status !== "complete" || run.completedAt === undefined
                    ? latest
                    : latest === null ||
                        latest.completedAt === undefined ||
                        run.completedAt > latest.completedAt
                      ? run
                      : latest,
                null,
              );

          return {
            provider,
            activeSourceCount,
            removedSourceCount,
            currentEntryCount,
            capacityState: capacityExceeded
              ? ("exceeded" as const)
              : ("within-bounds" as const),
            coverageState,
            latestSourceModifiedAt: capacityExceeded
              ? null
              : maxTimestamp(
                  boundedSources,
                  (source) => source.sourceModifiedAt,
                ),
            latestObservedAt: capacityExceeded
              ? null
              : maxTimestamp(boundedSources, (source) => source.observedAt),
            latestIndexedAt: capacityExceeded
              ? null
              : maxTimestamp(boundedSources, (source) => source.updatedAt),
            lastSuccessfulReconciliationAt:
              latestSuccessfulRun?.completedAt ?? null,
            freshnessState: "unknown-no-policy" as const,
            lastConnectorRun:
              latestRun === null
                ? null
                : {
                    runKey: latestRun.runKey,
                    scopeKey: latestRun.scopeKey,
                    status: latestRun.status,
                    startedAt: latestRun.startedAt,
                    ...(latestRun.completedAt === undefined
                      ? {}
                      : { completedAt: latestRun.completedAt }),
                    updatedAt: latestRun.updatedAt,
                    ...(latestRun.failureCode === undefined
                      ? {}
                      : { failureCode: latestRun.failureCode }),
                  },
          };
        }),
      { concurrency: 1 },
    );
    return { countLimit: HEALTH_COUNT_LIMIT, providers };
  });

const health = FunctionImpl.make(
  databaseSchema,
  evidence,
  "health",
  ({ workspaceId }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      return yield* getEvidenceHealth(workspaceId);
    }),
);

const healthForActor = FunctionImpl.make(
  databaseSchema,
  evidence,
  "healthForActor",
  ({ workspaceId, userId }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceActorAccess(workspaceId, userId, "viewer"),
      );
      return yield* getEvidenceHealth(workspaceId);
    }),
);

const beginRun = FunctionImpl.make(
  databaseSchema,
  evidence,
  "beginRun",
  ({
    workspaceId,
    provider,
    scopeKey,
    connectionGeneration,
    runKey,
    startedAt,
  }) =>
    Effect.gen(function* () {
      const existing = yield* requireRun(workspaceId, runKey).pipe(
        Effect.catchTag("NotFound", () => Effect.succeed(null)),
      );
      if (existing !== null) {
        if (
          existing.provider !== provider ||
          existing.scopeKey !== scopeKey ||
          existing.connectionGeneration !== connectionGeneration ||
          existing.status !== "running"
        )
          return yield* new ValidationFailed({
            field: "runKey",
            message: "Connector run identity was reused with different state.",
          });
        return { runKey };
      }
      const activeRuns = yield* (yield* DatabaseReader)
        .table("brainConnectorRuns")
        .index("by_workspace_and_provider_and_status", (q) =>
          q
            .eq("workspaceId", workspaceId)
            .eq("provider", provider)
            .eq("status", "running"),
        )
        .take(1)
        .pipe(Effect.orDie);
      const activeRun = activeRuns[0];
      if (activeRun !== undefined) {
        if (activeRun.updatedAt > startedAt - 30 * 60 * 1_000)
          return yield* new ValidationFailed({
            field: "provider",
            message: "Another connector traversal is already running.",
          });
        yield* (yield* DatabaseWriter)
          .table("brainConnectorRuns")
          .patch(activeRun._id, {
            status: "failed",
            completedAt: startedAt,
            failureCode: "stale_run_recovered",
            updatedAt: startedAt,
          })
          .pipe(Effect.orDie);
      }
      yield* (yield* DatabaseWriter)
        .table("brainConnectorRuns")
        .insert({
          workspaceId,
          provider,
          scopeKey,
          ...(connectionGeneration === undefined
            ? {}
            : { connectionGeneration }),
          runKey,
          status: "running",
          startedAt,
          discoveredCount: 0,
          publishedCount: 0,
          retiredCount: 0,
          createdAt: startedAt,
          updatedAt: startedAt,
        })
        .pipe(Effect.orDie);
      return { runKey };
    }),
);

const publishRunItem = FunctionImpl.make(
  databaseSchema,
  evidence,
  "publishRunItem",
  ({ runKey, ...input }) =>
    Effect.gen(function* () {
      const run = yield* requireRun(input.workspaceId, runKey);
      if (
        run.status !== "running" ||
        run.provider !== input.provider ||
        run.scopeKey !== input.scopeKey
      )
        return yield* new ValidationFailed({
          field: "runKey",
          message: "Connector run is not active for this evidence scope.",
        });
      if (!(yield* connectorRunIsCurrent(run)))
        return yield* new ValidationFailed({
          field: "connectionGeneration",
          message: "Provider connection changed while synchronization ran.",
        });
      const result = yield* projectEvidence(input);
      const reader = yield* DatabaseReader;
      const seen = yield* reader
        .table("brainConnectorRunSeen")
        .index("by_workspace_and_run_key_and_source_key", (q) =>
          q
            .eq("workspaceId", input.workspaceId)
            .eq("runKey", runKey)
            .eq("sourceKey", input.sourceKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const writer = yield* DatabaseWriter;
      if (seen === null)
        yield* writer
          .table("brainConnectorRunSeen")
          .insert({
            workspaceId: input.workspaceId,
            runKey,
            sourceKey: input.sourceKey,
            observedAt: input.observedAt,
          })
          .pipe(Effect.orDie);
      if (result.changed)
        yield* writer
          .table("brainConnectorRuns")
          .patch(run._id, {
            publishedCount: run.publishedCount + 1,
            updatedAt: input.observedAt,
          })
          .pipe(Effect.orDie);
      return result;
    }),
);

const completeRun = FunctionImpl.make(
  databaseSchema,
  evidence,
  "completeRun",
  ({ workspaceId, runKey, discoveredCount, completedAt }) =>
    Effect.gen(function* () {
      const run = yield* requireRun(workspaceId, runKey);
      if (run.status !== "running")
        return yield* new ValidationFailed({
          field: "runKey",
          message: "Only a running connector traversal can complete.",
        });
      if (!(yield* connectorRunIsCurrent(run)))
        return yield* new ValidationFailed({
          field: "connectionGeneration",
          message: "Provider connection changed before reconciliation.",
        });
      const reader = yield* DatabaseReader;
      const seenRows = yield* reader
        .table("brainConnectorRunSeen")
        .index("by_workspace_and_run_key", (q) =>
          q.eq("workspaceId", workspaceId).eq("runKey", runKey),
        )
        .take(1_001)
        .pipe(Effect.orDie);
      const sources = yield* reader
        .table("brainEvidenceSources")
        .index("by_workspace_and_scope_key_and_status", (q) =>
          q
            .eq("workspaceId", workspaceId)
            .eq("scopeKey", run.scopeKey)
            .eq("status", "active"),
        )
        .take(1_001)
        .pipe(Effect.orDie);
      if (seenRows.length > 1_000 || sources.length > 1_000)
        return yield* new ValidationFailed({
          field: "scopeKey",
          message: "Connector reconciliation capacity was exceeded.",
        });
      const seen = new Set(seenRows.map(({ sourceKey }) => sourceKey));
      const missingSources = sources.filter(
        ({ sourceKey }) => !seen.has(sourceKey),
      );
      const retirementBatch = missingSources.slice(
        0,
        RECONCILIATION_RETIRE_BATCH,
      );
      let retiredCount = 0;
      for (const source of retirementBatch) {
        const removed = yield* retireEvidence({
          workspaceId,
          provider: run.provider,
          scopeKey: run.scopeKey,
          sourceKey: source.sourceKey,
          revisionKey: `${runKey}:removed:${source.generation + 1}`,
          observedAt: completedAt,
        });
        if (removed) retiredCount += 1;
      }
      const cumulativeRetiredCount = run.retiredCount + retiredCount;
      const complete = missingSources.length === retirementBatch.length;
      yield* (yield* DatabaseWriter)
        .table("brainConnectorRuns")
        .patch(run._id, {
          ...(complete ? { status: "complete" as const, completedAt } : {}),
          discoveredCount,
          retiredCount: cumulativeRetiredCount,
          updatedAt: completedAt,
        })
        .pipe(Effect.orDie);
      return {
        publishedCount: run.publishedCount,
        retiredCount: cumulativeRetiredCount,
        completedAt,
        complete,
      };
    }),
);

const retireInactiveProviderScopes = FunctionImpl.make(
  databaseSchema,
  evidence,
  "retireInactiveProviderScopes",
  ({
    workspaceId,
    provider,
    activeScopeKey,
    connectionGeneration,
    observedAt,
  }) =>
    Effect.gen(function* () {
      if (
        !connectorScopeIsWritable(yield* loadEvidenceScopePolicy(workspaceId), {
          provider,
          scopeKey: activeScopeKey,
          connectionGeneration,
        })
      )
        return yield* new ValidationFailed({
          field: "connectionGeneration",
          message: "Provider connection changed before inactive-scope cleanup.",
        });
      const reader = yield* DatabaseReader;
      const runs = yield* reader
        .table("brainConnectorRuns")
        .index("by_workspace_and_provider_and_updated_at", (q) =>
          q.eq("workspaceId", workspaceId).eq("provider", provider),
        )
        .take(1_001)
        .pipe(Effect.orDie);
      if (runs.length > 1_000)
        return yield* new ValidationFailed({
          field: "provider",
          message: "Provider scope-history cleanup capacity was exceeded.",
        });
      const inactiveScopes = [
        ...new Set(
          runs
            .map(({ scopeKey }) => scopeKey)
            .filter((scopeKey) => scopeKey !== activeScopeKey),
        ),
      ];
      const scopes = yield* Effect.forEach(
        inactiveScopes,
        (scopeKey) =>
          reader
            .table("brainEvidenceSources")
            .index("by_workspace_provider_scope_status", (q) =>
              q
                .eq("workspaceId", workspaceId)
                .eq("provider", provider)
                .eq("scopeKey", scopeKey)
                .eq("status", "active"),
            )
            .take(RECONCILIATION_RETIRE_BATCH + 1)
            .pipe(
              Effect.orDie,
              Effect.map((sources) => ({ scopeKey, sources })),
            ),
        { concurrency: 1 },
      );
      const next = scopes.find(({ sources }) => sources.length > 0);
      if (next === undefined) return { retiredCount: 0, complete: true };
      const batch = next.sources.slice(0, RECONCILIATION_RETIRE_BATCH);
      let retiredCount = 0;
      for (const source of batch) {
        const removed = yield* retireEvidence({
          workspaceId,
          provider: source.provider,
          scopeKey: source.scopeKey,
          sourceKey: source.sourceKey,
          revisionKey: `scope-cleanup:${observedAt}:${source.generation + 1}`,
          observedAt,
        });
        if (removed) retiredCount += 1;
      }
      return {
        retiredCount,
        complete:
          next.sources.length === batch.length &&
          scopes.every(
            ({ scopeKey, sources }) =>
              scopeKey === next.scopeKey || sources.length === 0,
          ),
      };
    }),
);

const failRun = FunctionImpl.make(
  databaseSchema,
  evidence,
  "failRun",
  ({ workspaceId, runKey, failureCode, failedAt }) =>
    Effect.gen(function* () {
      const run = yield* requireRun(workspaceId, runKey);
      if (run.status === "complete")
        return yield* new ValidationFailed({
          field: "runKey",
          message: "A completed connector traversal cannot fail later.",
        });
      yield* (yield* DatabaseWriter)
        .table("brainConnectorRuns")
        .patch(run._id, {
          status: "failed",
          completedAt: failedAt,
          failureCode,
          updatedAt: failedAt,
        })
        .pipe(Effect.orDie);
      return { runKey };
    }),
);

const failActiveScopeRun = FunctionImpl.make(
  databaseSchema,
  evidence,
  "failActiveScopeRun",
  ({ workspaceId, provider, scopeKey, failureCode, failedAt }) =>
    Effect.gen(function* () {
      const activeRuns = yield* (yield* DatabaseReader)
        .table("brainConnectorRuns")
        .index("by_workspace_and_provider_and_status", (q) =>
          q
            .eq("workspaceId", workspaceId)
            .eq("provider", provider)
            .eq("status", "running"),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (activeRuns.length > 1)
        return yield* new ValidationFailed({
          field: "provider",
          message: "Provider has multiple active connector runs.",
        });
      const activeRun = activeRuns[0];
      if (activeRun === undefined || activeRun.scopeKey !== scopeKey)
        return { failedCount: 0 };
      yield* (yield* DatabaseWriter)
        .table("brainConnectorRuns")
        .patch(activeRun._id, {
          status: "failed",
          completedAt: failedAt,
          failureCode,
          updatedAt: failedAt,
        })
        .pipe(Effect.orDie);
      return { failedCount: 1 };
    }),
);

const publishPage = FunctionImpl.make(
  databaseSchema,
  evidence,
  "publishPage",
  ({ workspaceId, pageId }) =>
    Effect.gen(function* () {
      const page = yield* (yield* DatabaseReader)
        .table("brainPages")
        .get(pageId)
        .pipe(Effect.orDie);
      if (page === null || page.workspaceId !== workspaceId)
        return yield* new NotFound({ resource: "brainPages", id: pageId });
      const sourceKey = `brain-page:${pageId}`;
      if ((page.status ?? "active") === "archived") {
        yield* retireEvidence({
          workspaceId,
          provider: "brain_page",
          scopeKey: "brain-pages",
          sourceKey,
          revisionKey: `archived:${page.updatedAt}`,
          observedAt: page.updatedAt,
        });
        return { changed: true, entryKey: sourceKey };
      }
      return yield* projectEvidence({
        workspaceId,
        provider: "brain_page",
        scopeKey: "brain-pages",
        sourceKey,
        revisionKey: String(page.updatedAt),
        title: page.title,
        markdown: page.markdown,
        sourceModifiedAt: page.updatedAt,
        observedAt: page.updatedAt,
      });
    }),
);

export { searchEvidence };

export default GroupImpl.make(databaseSchema, evidence).pipe(
  Layer.provide(search),
  Layer.provide(sourceGet),
  Layer.provide(listCurrent),
  Layer.provide(currentGet),
  Layer.provide(searchForActor),
  Layer.provide(sourceGetForActor),
  Layer.provide(health),
  Layer.provide(healthForActor),
  Layer.provide(beginRun),
  Layer.provide(publishRunItem),
  Layer.provide(completeRun),
  Layer.provide(retireInactiveProviderScopes),
  Layer.provide(failRun),
  Layer.provide(failActiveScopeRun),
  Layer.provide(publishPage),
  GroupImpl.finalize,
);
