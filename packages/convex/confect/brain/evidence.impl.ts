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
const DAY_MS = 24 * 60 * 60 * 1_000;
const HEALTH_COUNT_LIMIT = 1_000;
const EVIDENCE_PROVIDERS = [
  "brain_page",
  "slack",
  "google_drive",
  "hubspot",
  "transcript",
] as const;

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

const excerpt = (
  markdown: string,
  queryTokens: readonly string[],
  passageStartOffset = 0,
  passageEndOffset = markdown.length,
) => {
  const passage = markdown.slice(passageStartOffset, passageEndOffset);
  const normalized = passage.toLowerCase();
  const first = queryTokens.reduce((best, token) => {
    const found = normalized.indexOf(token);
    return found < 0 ? best : Math.min(best, found);
  }, Number.POSITIVE_INFINITY);
  const startOffset =
    passageStartOffset +
    Math.max(0, (Number.isFinite(first) ? first : 0) - 120);
  const endOffset = Math.min(passageEndOffset, startOffset + 640);
  return {
    excerpt: markdown.slice(startOffset, endOffset),
    startOffset,
    endOffset,
  };
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

const providerIsEligible = (
  workspaceId: GenericId<"workspaces">,
  provider: "brain_page" | "slack" | "google_drive" | "hubspot" | "transcript",
) =>
  Effect.gen(function* () {
    if (provider === "brain_page" || provider === "transcript") return true;
    const connectionProvider =
      provider === "google_drive" ? "google-drive" : provider;
    const row = yield* (yield* DatabaseReader)
      .table("providerConnections")
      .index("by_workspace_and_provider", (q) =>
        q.eq("workspaceId", workspaceId).eq("provider", connectionProvider),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    return row !== null && "workspaceId" in row && row.status === "active";
  });

const connectorRunIsCurrent = (run: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly provider: (typeof EVIDENCE_PROVIDERS)[number];
  readonly scopeKey: string;
  readonly connectionGeneration?: number | undefined;
}) =>
  Effect.gen(function* () {
    if (run.connectionGeneration === undefined) return true;
    const connectionProvider =
      run.provider === "google_drive" ? "google-drive" : run.provider;
    if (
      connectionProvider === "brain_page" ||
      connectionProvider === "transcript"
    )
      return true;
    const row = yield* (yield* DatabaseReader)
      .table("providerConnections")
      .index("by_workspace_and_provider", (q) =>
        q.eq("workspaceId", run.workspaceId).eq("provider", connectionProvider),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (
      row === null ||
      !("workspaceId" in row) ||
      row.status !== "active" ||
      row.generation !== run.connectionGeneration
    )
      return false;
    return run.provider !== "slack"
      ? true
      : run.scopeKey === `slack:${row.connectionRef ?? ""}`;
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
    ).slice(0, 12);
    if (queryTokens.length === 0) return [];
    const reader = yield* DatabaseReader;
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
      const postings = yield* reader
        .table("brainRetrievalTokens")
        .index("by_workspace_and_token", (q) =>
          q.eq("workspaceId", input.workspaceId).eq("token", token),
        )
        .take(1_001)
        .pipe(Effect.orDie);
      if (postings.length > 1_000)
        return yield* new ValidationFailed({
          field: "query",
          message:
            "Retrieval candidate capacity was exceeded; narrow the query or rebuild the index.",
        });
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
    const citations = [];
    const citedEntries = new Set<string>();
    const coveredTokens = new Set<string>();
    for (const [, candidate] of ranked) {
      if (citations.length >= citationLimit) break;
      if (citedEntries.has(candidate.entryKey)) continue;
      if (
        !contributesEvidenceCoverage(
          relevanceMode,
          candidate.matchedTokens,
          coveredTokens,
        )
      )
        continue;
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
      if (!(yield* providerIsEligible(input.workspaceId, entry.provider)))
        continue;
      if (
        entry.contentHash !== evidenceContentHash(entry.title, entry.markdown)
      )
        return yield* new ValidationFailed({
          field: "contentHash",
          message: "A retrieval entry failed integrity validation.",
        });
      citations.push({
        entryKey: entry.entryKey,
        sourceKey: entry.sourceKey,
        revisionKey: entry.revisionKey,
        provider: entry.provider,
        title: entry.title,
        ...excerpt(
          entry.markdown,
          queryTokens,
          candidate.passageStartOffset,
          Math.min(candidate.passageEndOffset, entry.markdown.length),
        ),
        contentHash: entry.contentHash,
        ...(entry.locator === undefined ? {} : { locator: entry.locator }),
        sourceModifiedAt: entry.sourceModifiedAt,
        observedAt: entry.observedAt,
        freshness: freshness(entry.sourceModifiedAt, input.asOf),
      });
      citedEntries.add(entry.entryKey);
      addEvidenceCoverage(coveredTokens, candidate.matchedTokens);
    }
    return hasSufficientEvidenceCoverage(
      relevanceMode,
      queryTokens.length,
      coveredTokens.size,
    )
      ? citations
      : [];
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
    const reader = yield* DatabaseReader;
    const revision = yield* reader
      .table("brainEvidenceRevisions")
      .index("by_workspace_and_source_key_and_revision_key", (q) =>
        q
          .eq("workspaceId", input.workspaceId)
          .eq("sourceKey", input.sourceKey)
          .eq("revisionKey", input.revisionKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (revision === null)
      return yield* new NotFound({
        resource: "brainEvidenceRevisions",
        id: `${input.sourceKey}:${input.revisionKey}`,
      });
    if (!(yield* providerIsEligible(input.workspaceId, revision.provider)))
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
const CURRENT_EVIDENCE_PROVIDER_SCAN_LIMIT = 1_000;

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
    const entriesByProvider = yield* Effect.forEach(
      providers,
      (provider) =>
        reader
          .table("brainRetrievalEntries")
          .index("by_workspace_and_provider_and_status", (q) =>
            q
              .eq("workspaceId", input.workspaceId)
              .eq("provider", provider)
              .eq("status", "current"),
          )
          .take(CURRENT_EVIDENCE_PROVIDER_SCAN_LIMIT + 1)
          .pipe(Effect.orDie),
      { concurrency: 1 },
    );
    if (
      entriesByProvider.some(
        (entries) => entries.length > CURRENT_EVIDENCE_PROVIDER_SCAN_LIMIT,
      )
    )
      return yield* new ValidationFailed({
        field: "provider",
        message:
          "Synced source browsing capacity was exceeded; narrow the provider scope.",
      });
    const entries = entriesByProvider
      .flat()
      .sort((left, right) => right.sourceModifiedAt - left.sourceModifiedAt)
      .slice(0, limit);
    const eligibleProviders = new Map<
      (typeof EVIDENCE_PROVIDERS)[number],
      boolean
    >();
    for (const provider of providers)
      eligibleProviders.set(
        provider,
        yield* providerIsEligible(input.workspaceId, provider),
      );
    return entries.flatMap((entry) => {
      if (eligibleProviders.get(entry.provider) !== true) return [];
      if (
        entry.contentHash !== evidenceContentHash(entry.title, entry.markdown)
      )
        return [];
      return [
        {
          entryKey: entry.entryKey,
          sourceKey: entry.sourceKey,
          revisionKey: entry.revisionKey,
          provider: entry.provider,
          title: entry.title,
          excerpt: entry.markdown.slice(0, 280),
          ...(entry.locator === undefined ? {} : { locator: entry.locator }),
          sourceModifiedAt: entry.sourceModifiedAt,
          observedAt: entry.observedAt,
        },
      ];
    });
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
      if (!(yield* providerIsEligible(workspaceId, entry.provider)))
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
    const providers = yield* Effect.forEach(
      EVIDENCE_PROVIDERS,
      (provider) =>
        Effect.gen(function* () {
          const sources = yield* reader
            .table("brainEvidenceSources")
            .index("by_workspace_and_provider", (q) =>
              q.eq("workspaceId", workspaceId).eq("provider", provider),
            )
            .take(HEALTH_COUNT_LIMIT + 1)
            .pipe(Effect.orDie);
          const currentEntries = yield* reader
            .table("brainRetrievalEntries")
            .index("by_workspace_and_provider_and_status", (q) =>
              q
                .eq("workspaceId", workspaceId)
                .eq("provider", provider)
                .eq("status", "current"),
            )
            .take(HEALTH_COUNT_LIMIT + 1)
            .pipe(Effect.orDie);
          const latestRuns = yield* reader
            .table("brainConnectorRuns")
            .index("by_workspace_and_provider_and_updated_at", (q) =>
              q.eq("workspaceId", workspaceId).eq("provider", provider),
            )
            .take(HEALTH_COUNT_LIMIT + 1)
            .pipe(Effect.orDie);

          const capacityExceeded =
            sources.length > HEALTH_COUNT_LIMIT ||
            currentEntries.length > HEALTH_COUNT_LIMIT ||
            latestRuns.length > HEALTH_COUNT_LIMIT;
          const boundedSources = sources.slice(0, HEALTH_COUNT_LIMIT);
          const activeSourceCount = boundedSources.filter(
            ({ status }) => status === "active",
          ).length;
          const removedSourceCount = boundedSources.filter(
            ({ status }) => status === "removed",
          ).length;
          const currentEntryCount = Math.min(
            currentEntries.length,
            HEALTH_COUNT_LIMIT,
          );
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
              : maxTimestamp(currentEntries, (entry) => entry.updatedAt),
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
      if (missingSources.length > 50)
        return yield* new ValidationFailed({
          field: "scopeKey",
          message:
            "Connector removal capacity was exceeded; no removals were applied.",
        });
      let retiredCount = 0;
      for (const source of missingSources) {
        const removed = yield* retireEvidence({
          workspaceId,
          sourceKey: source.sourceKey,
          revisionKey: `${runKey}:removed:${source.generation + 1}`,
          observedAt: completedAt,
        });
        if (removed) retiredCount += 1;
      }
      yield* (yield* DatabaseWriter)
        .table("brainConnectorRuns")
        .patch(run._id, {
          status: "complete",
          completedAt,
          discoveredCount,
          retiredCount,
          updatedAt: completedAt,
        })
        .pipe(Effect.orDie);
      return {
        publishedCount: run.publishedCount,
        retiredCount,
        completedAt,
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
  Layer.provide(failRun),
  Layer.provide(failActiveScopeRun),
  Layer.provide(publishPage),
  GroupImpl.finalize,
);
