import { generateText } from "ai";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import refs from "../_generated/refs";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
  QueryRunner,
  Scheduler,
} from "../_generated/services";
import {
  requireWorkspaceAccess,
  requireWorkspaceActorAccess,
} from "./_kit/workspaceAccess";
import { Forbidden, ValidationFailed } from "../errors";
import { RuntimeModeConfig } from "../shared/config";
import { killSwitchOn, loadLlmGatewayEnvConfig } from "../shared/env";
import { createAssistantLanguageModel } from "../agents/assistantModel";
import {
  BRAIN_EXTRACTION_POLICY_VERSION,
  extractionPrompt,
  groundCandidateProposals,
  parseCandidateProposals,
  type CandidateProposal,
} from "./extractBrainKnowledgeCandidates.domain";
import group from "./extractBrainKnowledgeCandidates.spec";

const DAILY_TOKEN_CAP = 250_000;
const RUNNING_CAP = 2;
const RUNNING_LEASE_MS = 5 * 60 * 1_000;
const MAX_QUEUE_LIMIT = 25;
const EXTRACTION_SCHEDULE_SPACING_MS = 35_000;
const DEFAULT_ESTIMATED_COST_PER_MILLION_TOKENS_CENTS = 500;
const MAX_WORKSPACE_DAILY_CANDIDATES = 25;
const withClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;
const invalid = (field: string, message: string) =>
  new ValidationFailed({ field, message });
const utcDayStart = (timestamp: number): number => {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};
const rolloutBucket = (input: string): number => {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1)
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  return hash % 100;
};

const currentEntry = (
  workspaceId: Parameters<typeof requireWorkspaceAccess>[0],
  sourceKey: string,
) =>
  Effect.gen(function* () {
    const rows = yield* (yield* DatabaseReader)
      .table("brainRetrievalEntries")
      .index("by_workspace_and_source_key_and_status", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("sourceKey", sourceKey)
          .eq("status", "current"),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (rows.length !== 1)
      return yield* invalid(
        "sourceKey",
        "Current evidence source was not found uniquely.",
      );
    return rows[0] as NonNullable<(typeof rows)[0]>;
  });

const resolveAccess = FunctionImpl.make(
  databaseSchema,
  group,
  "resolveAccess",
  ({ workspaceId }) =>
    withClock(requireWorkspaceAccess(workspaceId, "editor")).pipe(
      Effect.map(({ userId }) => ({ userId })),
    ),
);

const beginExtraction = FunctionImpl.make(
  databaseSchema,
  group,
  "beginExtraction",
  (args) =>
    Effect.gen(function* () {
      if (args.userId !== undefined)
        yield* withClock(
          requireWorkspaceActorAccess(args.workspaceId, args.userId, "editor"),
        );
      for (const [field, value] of [
        ["sourceKey", args.sourceKey],
        ["revisionKey", args.revisionKey],
        ["extractionWindowKey", args.extractionWindowKey],
        ["extractionPolicyVersion", args.extractionPolicyVersion],
        ["idempotencyKey", args.idempotencyKey],
      ] as const)
        if (value.trim().length === 0 || value.length > 500)
          return yield* invalid(
            field,
            `${field} is blank or exceeds capacity.`,
          );
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const now = yield* withClock(Clock.currentTimeMillis);
      if (args.killSwitchEnabled)
        return yield* new Forbidden({
          reason: "brain-extraction-kill-switch",
        });
      if (
        !Number.isSafeInteger(args.dailySpendLimitCents) ||
        args.dailySpendLimitCents < 0 ||
        !Number.isSafeInteger(args.estimatedCostPerMillionTokensCents) ||
        args.estimatedCostPerMillionTokensCents < 0
      )
        return yield* invalid(
          "dailySpendLimitCents",
          "Extraction spend limits must be non-negative integer cents.",
        );
      const running = yield* reader
        .table("brainRetrievalEntries")
        .index("by_workspace_and_semantic_status", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("semanticStatus", "running"),
        )
        .take(101)
        .pipe(Effect.orDie);
      if (running.length > 100)
        return yield* invalid(
          "workspaceId",
          "Extraction lease recovery capacity was exceeded.",
        );
      const activeRunning = [];
      for (const entry of running) {
        if ((entry.semanticStartedAt ?? 0) > now - RUNNING_LEASE_MS) {
          activeRunning.push(entry);
          continue;
        }
        const usageDay = utcDayStart(now);
        const sameUsageDay = entry.semanticUsageDay === usageDay;
        const reservedRunTokens = entry.semanticEstimatedRunTokens ?? 0;
        const reservedRunSpendCents = entry.semanticEstimatedSpendCents ?? 0;
        yield* writer
          .table("brainRetrievalEntries")
          .patch(entry._id, {
            semanticStatus: "failed",
            semanticFailureCode: "extraction_lease_expired",
            semanticUsageDay: usageDay,
            semanticDailyConsumedTokens:
              (sameUsageDay ? (entry.semanticDailyConsumedTokens ?? 0) : 0) +
              reservedRunTokens,
            semanticDailyReservedTokens: sameUsageDay
              ? Math.max(
                  0,
                  (entry.semanticDailyReservedTokens ?? 0) - reservedRunTokens,
                )
              : 0,
            semanticDailyConsumedSpendCents:
              (sameUsageDay
                ? (entry.semanticDailyConsumedSpendCents ?? 0)
                : 0) + reservedRunSpendCents,
            semanticDailyReservedSpendCents: sameUsageDay
              ? Math.max(
                  0,
                  (entry.semanticDailyReservedSpendCents ?? 0) -
                    reservedRunSpendCents,
                )
              : 0,
            semanticProjectedAt: now,
            updatedAt: now,
          })
          .pipe(Effect.orDie);
      }
      if (activeRunning.length >= RUNNING_CAP)
        return yield* new Forbidden({ reason: "brain-extraction-concurrency" });
      const entries = yield* reader
        .table("brainRetrievalEntries")
        .index("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .take(1_001)
        .pipe(Effect.orDie);
      if (entries.length > 1_000)
        return yield* invalid(
          "workspaceId",
          "Extraction accounting capacity was exceeded.",
        );
      const today = utcDayStart(now);
      const tokens = entries.reduce(
        (sum, entry) =>
          entry.semanticUsageDay === today
            ? sum +
              (entry.semanticDailyConsumedTokens ?? 0) +
              (entry.semanticDailyReservedTokens ?? 0)
            : sum,
        0,
      );
      const estimatedSpendCents = entries.reduce(
        (sum, entry) =>
          entry.semanticUsageDay === today
            ? sum +
              (entry.semanticDailyConsumedSpendCents ?? 0) +
              (entry.semanticDailyReservedSpendCents ?? 0)
            : sum,
        0,
      );
      if (tokens >= DAILY_TOKEN_CAP)
        return yield* new Forbidden({
          reason: "brain-extraction-daily-token-cap",
        });
      const entry = yield* currentEntry(args.workspaceId, args.sourceKey);
      if (entry.revisionKey !== args.revisionKey)
        return yield* invalid(
          "revisionKey",
          "Evidence revision changed before extraction.",
        );
      if (
        entry.semanticStatus === "completed" &&
        entry.semanticPolicyVersion === args.extractionPolicyVersion
      )
        return {
          title: entry.title,
          markdown: entry.markdown,
          contentHash: entry.contentHash,
          ...(entry.locator === undefined ? {} : { locator: entry.locator }),
          acceptedTags: [],
          alreadyCompleted: true,
          existingProposedCount: entry.semanticProposedCount ?? 0,
          existingCandidateCount: entry.semanticCandidateCount ?? 0,
          existingGroundingFailureCount:
            entry.semanticGroundingFailureCount ?? 0,
          existingEstimatedSpendCents: entry.semanticEstimatedSpendCents ?? 0,
          existingProjectedAt: entry.semanticProjectedAt ?? entry.updatedAt,
        };
      if (
        entry.semanticStatus === "running" &&
        (entry.semanticStartedAt ?? 0) > now - RUNNING_LEASE_MS
      )
        return yield* new Forbidden({
          reason: "brain-extraction-source-already-running",
        });
      const claims = yield* reader
        .table("claims")
        .index("by_workspace_status", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("status", "supported"),
        )
        .take(50)
        .pipe(Effect.orDie);
      const flags = yield* reader
        .table("featureFlagPolicies")
        .index("by_workspace_key", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("key", "template.ai.liveGeneration"),
        )
        .take(2)
        .pipe(Effect.orDie);
      const [flag] = flags;
      if (
        args.requireLiveGeneration &&
        !(
          flags.length === 1 &&
          flag !== undefined &&
          flag.enabled &&
          rolloutBucket(`${flag.key}:${args.workspaceId}`) <
            Math.max(0, Math.min(100, Math.trunc(flag.rolloutPercent)))
        )
      )
        return yield* new Forbidden({
          reason: "brain-extraction-live-generation-disabled",
        });
      const source = yield* reader
        .table("brainEvidenceSources")
        .index("by_workspace_and_source_key", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("sourceKey", entry.sourceKey),
        )
        .first()
        .pipe(Effect.orDie);
      if (source._tag !== "Some")
        return yield* invalid(
          "sourceKey",
          "Evidence source metadata was not found.",
        );
      const scopedSources = yield* reader
        .table("brainEvidenceSources")
        .index("by_workspace_and_scope_key_and_status", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("scopeKey", source.value.scopeKey)
            .eq("status", "active"),
        )
        .take(101)
        .pipe(Effect.orDie);
      if (scopedSources.length > 100)
        return yield* invalid(
          "sourceKey",
          "Extraction circuit-breaker scope exceeded its source bound.",
        );
      const recentSemantic = [];
      for (const scopedSource of scopedSources) {
        const scopedEntries = yield* reader
          .table("brainRetrievalEntries")
          .index("by_workspace_and_source_key_and_status", (q) =>
            q
              .eq("workspaceId", args.workspaceId)
              .eq("sourceKey", scopedSource.sourceKey)
              .eq("status", "current"),
          )
          .take(2)
          .pipe(Effect.orDie);
        const [scopedEntry] = scopedEntries;
        if (
          scopedEntries.length === 1 &&
          scopedEntry !== undefined &&
          scopedEntry.semanticPolicyVersion === args.extractionPolicyVersion &&
          scopedEntry.semanticProjectedAt !== undefined
        )
          recentSemantic.push(scopedEntry);
      }
      const recentProposed = recentSemantic.reduce(
        (sum, candidate) => sum + (candidate.semanticProposedCount ?? 0),
        0,
      );
      const recentGroundingFailures = recentSemantic.reduce(
        (sum, candidate) =>
          sum + (candidate.semanticGroundingFailureCount ?? 0),
        0,
      );
      if (
        recentProposed >= 10 &&
        recentGroundingFailures / recentProposed > 0.3
      )
        return yield* new Forbidden({
          reason: "brain-extraction-grounding-circuit-open",
        });
      const estimatedRunTokens =
        Math.ceil((entry.title.length + entry.markdown.length) / 4) + 1_200;
      if (tokens + estimatedRunTokens > DAILY_TOKEN_CAP)
        return yield* new Forbidden({
          reason: "brain-extraction-daily-token-cap",
        });
      const estimatedRunSpendCents = Math.ceil(
        (estimatedRunTokens * args.estimatedCostPerMillionTokensCents) /
          1_000_000,
      );
      if (
        estimatedSpendCents + estimatedRunSpendCents >
        args.dailySpendLimitCents
      )
        return yield* new Forbidden({
          reason: "brain-extraction-daily-spend-cap",
        });
      const dailyCandidates = yield* reader
        .table("brainKnowledgeCandidates")
        .index("by_workspace_and_created_at", (q) =>
          q.eq("workspaceId", args.workspaceId).gte("createdAt", today),
        )
        .take(MAX_WORKSPACE_DAILY_CANDIDATES)
        .pipe(Effect.orDie);
      if (dailyCandidates.length >= MAX_WORKSPACE_DAILY_CANDIDATES)
        return yield* new Forbidden({
          reason: "brain-extraction-daily-candidate-cap",
        });
      const sameUsageDay = entry.semanticUsageDay === today;
      const consumedTokens = sameUsageDay
        ? (entry.semanticDailyConsumedTokens ?? 0)
        : 0;
      const reservedTokens = sameUsageDay
        ? (entry.semanticDailyReservedTokens ?? 0)
        : 0;
      const consumedSpendCents = sameUsageDay
        ? (entry.semanticDailyConsumedSpendCents ?? 0)
        : 0;
      const reservedSpendCents = sameUsageDay
        ? (entry.semanticDailyReservedSpendCents ?? 0)
        : 0;
      yield* writer
        .table("brainRetrievalEntries")
        .patch(entry._id, {
          semanticPolicyVersion: args.extractionPolicyVersion,
          semanticStatus: "running",
          semanticRunKey: args.idempotencyKey,
          semanticStartedAt: now,
          semanticUsageDay: today,
          semanticDailyConsumedTokens: consumedTokens,
          semanticDailyReservedTokens: reservedTokens + estimatedRunTokens,
          semanticDailyConsumedSpendCents: consumedSpendCents,
          semanticDailyReservedSpendCents:
            reservedSpendCents + estimatedRunSpendCents,
          semanticEstimatedRunTokens: estimatedRunTokens,
          semanticEstimatedSpendCents: estimatedRunSpendCents,
          semanticFailureCode: undefined,
          updatedAt: yield* withClock(Clock.currentTimeMillis),
        })
        .pipe(Effect.orDie);
      return {
        title: entry.title,
        markdown: entry.markdown,
        contentHash: entry.contentHash,
        ...(entry.locator === undefined ? {} : { locator: entry.locator }),
        acceptedTags: [
          ...new Set(
            claims.flatMap((claim) => [...(claim.tags ?? [])] as string[]),
          ),
        ].slice(0, 50),
        alreadyCompleted: false,
        existingProposedCount: 0,
        existingCandidateCount: 0,
        existingGroundingFailureCount: 0,
        existingEstimatedSpendCents: 0,
        existingProjectedAt: 0,
      };
    }),
);

const commitExtraction = FunctionImpl.make(
  databaseSchema,
  group,
  "commitExtraction",
  (args) =>
    Effect.gen(function* () {
      if (args.userId !== undefined)
        yield* withClock(
          requireWorkspaceActorAccess(args.workspaceId, args.userId, "editor"),
        );
      const entry = yield* currentEntry(args.workspaceId, args.sourceKey);
      if (
        entry.revisionKey !== args.revisionKey ||
        entry.semanticStatus !== "running" ||
        entry.semanticRunKey !== args.idempotencyKey ||
        entry.semanticPolicyVersion !== args.extractionPolicyVersion
      )
        return yield* invalid(
          "revisionKey",
          "Extraction result is stale or no longer active.",
        );
      const grounded = groundCandidateProposals(args.proposals, {
        sourceKey: args.sourceKey,
        revisionKey: args.revisionKey,
        contentHash: entry.contentHash,
        markdown: entry.markdown,
        ...(entry.locator === undefined ? {} : { locator: entry.locator }),
        extractionWindowKey: args.extractionWindowKey,
        extractionPolicyVersion: args.extractionPolicyVersion,
      });
      const writer = yield* DatabaseWriter;
      const reader = yield* DatabaseReader;
      const dayStart = utcDayStart(args.projectedAt);
      const dailyCandidates = yield* reader
        .table("brainKnowledgeCandidates")
        .index("by_workspace_and_created_at", (q) =>
          q.eq("workspaceId", args.workspaceId).gte("createdAt", dayStart),
        )
        .take(MAX_WORKSPACE_DAILY_CANDIDATES)
        .pipe(Effect.orDie);
      const existingByReceipt = new Map<string, boolean>();
      for (const candidate of grounded.candidates) {
        const existing = yield* reader
          .table("brainKnowledgeCandidates")
          .index("by_workspace_and_candidate_receipt_key", (q) =>
            q
              .eq("workspaceId", args.workspaceId)
              .eq("candidateReceiptKey", candidate.candidateReceiptKey),
          )
          .first()
          .pipe(Effect.orDie);
        existingByReceipt.set(
          candidate.candidateReceiptKey,
          existing._tag === "Some",
        );
      }
      const newCandidateCount = grounded.candidates.filter(
        ({ candidateReceiptKey }) =>
          !existingByReceipt.get(candidateReceiptKey),
      ).length;
      if (
        dailyCandidates.length + newCandidateCount >
        MAX_WORKSPACE_DAILY_CANDIDATES
      )
        return yield* new Forbidden({
          reason: "brain-extraction-daily-candidate-cap",
        });
      for (const candidate of grounded.candidates) {
        if (!existingByReceipt.get(candidate.candidateReceiptKey))
          yield* writer
            .table("brainKnowledgeCandidates")
            .insert({
              workspaceId: args.workspaceId,
              sourceKey: args.sourceKey,
              sourceRevisionKey: args.revisionKey,
              extractionWindowKey: args.extractionWindowKey,
              extractionPolicyVersion: args.extractionPolicyVersion,
              ...candidate,
              evidence: [...candidate.evidence],
              tags: [...candidate.tags],
              currentState: "unreviewed",
              reviewRevision: 0,
              reviewHistory: [],
              createdAt: args.projectedAt,
              updatedAt: args.projectedAt,
            })
            .pipe(Effect.orDie);
      }
      const usageDay = utcDayStart(args.projectedAt);
      const sameUsageDay = entry.semanticUsageDay === usageDay;
      const actualTokens = args.inputTokens + args.outputTokens;
      const reservedRunTokens = entry.semanticEstimatedRunTokens ?? 0;
      const reservedRunSpendCents = entry.semanticEstimatedSpendCents ?? 0;
      yield* writer
        .table("brainRetrievalEntries")
        .patch(entry._id, {
          semanticStatus: "completed",
          semanticProposedCount: args.proposals.length,
          semanticCandidateCount: grounded.candidates.length,
          semanticGroundingFailureCount: grounded.failureCount,
          semanticFailureCode: undefined,
          semanticInputTokens: args.inputTokens,
          semanticOutputTokens: args.outputTokens,
          semanticUsageDay: usageDay,
          semanticDailyConsumedTokens:
            (sameUsageDay ? (entry.semanticDailyConsumedTokens ?? 0) : 0) +
            actualTokens,
          semanticDailyReservedTokens: sameUsageDay
            ? Math.max(
                0,
                (entry.semanticDailyReservedTokens ?? 0) - reservedRunTokens,
              )
            : 0,
          semanticDailyConsumedSpendCents:
            (sameUsageDay ? (entry.semanticDailyConsumedSpendCents ?? 0) : 0) +
            reservedRunSpendCents,
          semanticDailyReservedSpendCents: sameUsageDay
            ? Math.max(
                0,
                (entry.semanticDailyReservedSpendCents ?? 0) -
                  reservedRunSpendCents,
              )
            : 0,
          semanticProjectedAt: args.projectedAt,
          updatedAt: args.projectedAt,
        })
        .pipe(Effect.orDie);
      return {
        status: "completed" as const,
        proposedCount: args.proposals.length,
        candidateCount: grounded.candidates.length,
        groundingFailureCount: grounded.failureCount,
        estimatedSpendCents: entry.semanticEstimatedSpendCents ?? 0,
        extractionPolicyVersion: args.extractionPolicyVersion,
        projectedAt: args.projectedAt,
      };
    }),
);

const failExtraction = FunctionImpl.make(
  databaseSchema,
  group,
  "failExtraction",
  (args) =>
    Effect.gen(function* () {
      const entry = yield* currentEntry(args.workspaceId, args.sourceKey);
      if (
        entry.revisionKey === args.revisionKey &&
        entry.semanticStatus === "running" &&
        entry.semanticRunKey === args.idempotencyKey &&
        entry.semanticPolicyVersion === args.extractionPolicyVersion
      ) {
        const usageDay = utcDayStart(args.failedAt);
        const sameUsageDay = entry.semanticUsageDay === usageDay;
        const reservedRunTokens = entry.semanticEstimatedRunTokens ?? 0;
        const reservedRunSpendCents = entry.semanticEstimatedSpendCents ?? 0;
        yield* (yield* DatabaseWriter)
          .table("brainRetrievalEntries")
          .patch(entry._id, {
            semanticStatus: "failed",
            semanticFailureCode: args.failureCode,
            semanticUsageDay: usageDay,
            semanticDailyConsumedTokens:
              (sameUsageDay ? (entry.semanticDailyConsumedTokens ?? 0) : 0) +
              reservedRunTokens,
            semanticDailyReservedTokens: sameUsageDay
              ? Math.max(
                  0,
                  (entry.semanticDailyReservedTokens ?? 0) - reservedRunTokens,
                )
              : 0,
            semanticDailyConsumedSpendCents:
              (sameUsageDay
                ? (entry.semanticDailyConsumedSpendCents ?? 0)
                : 0) + reservedRunSpendCents,
            semanticDailyReservedSpendCents: sameUsageDay
              ? Math.max(
                  0,
                  (entry.semanticDailyReservedSpendCents ?? 0) -
                    reservedRunSpendCents,
                )
              : 0,
            semanticProjectedAt: args.failedAt,
            updatedAt: args.failedAt,
          })
          .pipe(Effect.orDie);
      }
      return null;
    }),
);

type ExtractionArgs = {
  readonly workspaceId: Parameters<typeof requireWorkspaceAccess>[0];
  readonly sourceKey: string;
  readonly revisionKey: string;
  readonly extractionWindowKey: string;
  readonly extractionPolicyVersion: string;
  readonly idempotencyKey: string;
};

const runExtraction = (
  args: ExtractionArgs,
  userId?: Parameters<typeof requireWorkspaceActorAccess>[1],
) =>
  Effect.gen(function* () {
    const mutation = yield* MutationRunner;
    const mode = yield* RuntimeModeConfig.pipe(Effect.orDie);
    const env = yield* loadLlmGatewayEnvConfig.pipe(Effect.orDie);
    const configuredSpendLimit = Number.parseInt(
      env.LLM_DAILY_SPEND_LIMIT_CENTS?.trim() ?? "",
      10,
    );
    if (
      mode === "live" &&
      (!Number.isSafeInteger(configuredSpendLimit) || configuredSpendLimit < 0)
    )
      return yield* invalid(
        "provider",
        "Live extraction requires LLM_DAILY_SPEND_LIMIT_CENTS.",
      );
    const prepared = yield* mutation(
      refs.internal.capabilities.extractBrainKnowledgeCandidates
        .beginExtraction,
      {
        ...args,
        ...(userId === undefined ? {} : { userId }),
        requireLiveGeneration: mode === "live",
        killSwitchEnabled: mode === "live" && killSwitchOn(env),
        dailySpendLimitCents:
          mode === "live" ? configuredSpendLimit : Number.MAX_SAFE_INTEGER,
        estimatedCostPerMillionTokensCents:
          mode === "live" ? DEFAULT_ESTIMATED_COST_PER_MILLION_TOKENS_CENTS : 0,
      },
    );
    if (prepared.alreadyCompleted)
      return {
        status: "completed" as const,
        proposedCount: prepared.existingProposedCount,
        candidateCount: prepared.existingCandidateCount,
        groundingFailureCount: prepared.existingGroundingFailureCount,
        estimatedSpendCents: prepared.existingEstimatedSpendCents,
        extractionPolicyVersion: args.extractionPolicyVersion,
        projectedAt: prepared.existingProjectedAt,
      };
    const postBegin = Effect.gen(function* () {
      let proposals: readonly CandidateProposal[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      if (mode === "live") {
        const prompt = extractionPrompt(prepared);
        const result = yield* Effect.tryPromise({
          try: () =>
            generateText({
              model: createAssistantLanguageModel({ mode, env }),
              prompt,
              maxOutputTokens: 1_200,
              maxRetries: 1,
              timeout: 30_000,
            }),
          catch: () =>
            invalid("provider", "Extractor model failed or timed out."),
        });
        proposals = yield* Effect.try({
          try: () => parseCandidateProposals(result.text),
          catch: () =>
            invalid("provider", "Extractor returned malformed output."),
        });
        inputTokens = Math.ceil(prompt.length / 4);
        outputTokens = Math.ceil(result.text.length / 4);
      }
      const projectedAt = yield* withClock(Clock.currentTimeMillis);
      return yield* mutation(
        refs.internal.capabilities.extractBrainKnowledgeCandidates
          .commitExtraction,
        {
          ...args,
          ...(userId === undefined ? {} : { userId }),
          proposals: [...proposals],
          inputTokens,
          outputTokens,
          projectedAt,
        },
      );
    });
    return yield* postBegin.pipe(
      Effect.tapError(() =>
        Effect.gen(function* () {
          const failedAt = yield* withClock(Clock.currentTimeMillis);
          yield* mutation(
            refs.internal.capabilities.extractBrainKnowledgeCandidates
              .failExtraction,
            {
              workspaceId: args.workspaceId,
              sourceKey: args.sourceKey,
              revisionKey: args.revisionKey,
              extractionPolicyVersion: args.extractionPolicyVersion,
              idempotencyKey: args.idempotencyKey,
              failureCode: "extraction_failed",
              failedAt,
            },
          ).pipe(Effect.ignore);
        }),
      ),
    );
  });

const extract = FunctionImpl.make(
  databaseSchema,
  group,
  "extractBrainKnowledgeCandidates",
  (args) =>
    Effect.gen(function* () {
      const { userId } = yield* (yield* QueryRunner)(
        refs.internal.capabilities.extractBrainKnowledgeCandidates
          .resolveAccess,
        { workspaceId: args.workspaceId },
      ).pipe(
        Effect.catchTag("SchemaError", () =>
          invalid("workspaceId", "Workspace access input was invalid."),
        ),
      );
      return yield* runExtraction(args, userId).pipe(
        Effect.catchTag("SchemaError", () =>
          invalid("input", "Extraction input failed schema validation."),
        ),
      );
    }),
);

const extractScheduled = FunctionImpl.make(
  databaseSchema,
  group,
  "extractBrainKnowledgeCandidatesScheduled",
  (args) =>
    runExtraction(args).pipe(
      Effect.catchTag("SchemaError", () =>
        invalid("input", "Extraction input failed schema validation."),
      ),
    ),
);

const queueExtraction = (
  args: {
    readonly workspaceId: ExtractionArgs["workspaceId"];
    readonly limit?: number | undefined;
  },
  userId?: Parameters<typeof requireWorkspaceActorAccess>[1],
) =>
  Effect.gen(function* () {
    if (userId === undefined)
      yield* withClock(requireWorkspaceAccess(args.workspaceId, "editor"));
    else
      yield* withClock(
        requireWorkspaceActorAccess(args.workspaceId, userId, "editor"),
      );
    const limit = args.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUEUE_LIMIT)
      return yield* invalid(
        "limit",
        `Extraction queue limit must be between 1 and ${MAX_QUEUE_LIMIT}.`,
      );
    const entries = yield* (yield* DatabaseReader)
      .table("brainRetrievalEntries")
      .index("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(1_001)
      .pipe(Effect.orDie);
    if (entries.length > 1_000)
      return yield* invalid(
        "workspaceId",
        "Extraction queue capacity was exceeded.",
      );
    const eligible = entries.filter(
      (entry) =>
        entry.status === "current" &&
        entry.semanticStatus !== "running" &&
        !(
          entry.semanticStatus === "completed" &&
          entry.semanticPolicyVersion === BRAIN_EXTRACTION_POLICY_VERSION
        ),
    );
    const selected = eligible.slice(0, limit);
    const scheduler = yield* Scheduler;
    for (const [index, entry] of selected.entries())
      yield* scheduler
        .runAfter(
          Duration.millis(index * EXTRACTION_SCHEDULE_SPACING_MS),
          refs.internal.capabilities.extractBrainKnowledgeCandidates
            .extractBrainKnowledgeCandidatesScheduled,
          {
            workspaceId: args.workspaceId,
            sourceKey: entry.sourceKey,
            revisionKey: entry.revisionKey,
            extractionWindowKey: `full:0:${entry.markdown.length}`,
            extractionPolicyVersion: BRAIN_EXTRACTION_POLICY_VERSION,
            idempotencyKey: `scheduled:${entry.revisionKey}:${BRAIN_EXTRACTION_POLICY_VERSION}`,
          },
        )
        .pipe(Effect.orDie);
    return {
      scheduledCount: selected.length,
      skippedCount: entries.length - eligible.length,
      extractionPolicyVersion: BRAIN_EXTRACTION_POLICY_VERSION,
    };
  });

const queue = FunctionImpl.make(
  databaseSchema,
  group,
  "queueBrainKnowledgeExtraction",
  (args) => queueExtraction(args),
);
const queueForActor = FunctionImpl.make(
  databaseSchema,
  group,
  "queueBrainKnowledgeExtractionForActor",
  ({ userId, ...args }) => queueExtraction(args, userId),
);

export default GroupImpl.make(databaseSchema, group).pipe(
  Layer.provide(extract),
  Layer.provide(extractScheduled),
  Layer.provide(queue),
  Layer.provide(queueForActor),
  Layer.provide(resolveAccess),
  Layer.provide(beginExtraction),
  Layer.provide(commitExtraction),
  Layer.provide(failExtraction),
  GroupImpl.finalize,
);
