import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import type { BrainKnowledgeCandidatesDoc } from "../_generated/docs";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import {
  acceptedReviewBody,
  isExactEvidenceReopenable,
} from "./reviewBrainKnowledgeCandidate.domain";
import {
  requireWorkspaceAccess,
  requireWorkspaceActorAccess,
} from "./_kit/workspaceAccess";
import group from "./reviewBrainKnowledgeCandidate.spec";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_QUEUE_LIMIT = 50;
const PILOT_SURFACED_LIMIT = 5;
const MAX_ACTIVE_QUEUE_SCAN = 30 * 25 + 1;
const ACTIVE_CANDIDATE_TTL_MS = 30 * DAY_MS;
const MAX_CLAIM_CITATIONS = 4;
const invalid = (field: string, message: string) =>
  new ValidationFailed({ field, message });
const withClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const candidateByReceipt = (
  workspaceId: Parameters<typeof requireWorkspaceAccess>[0],
  candidateReceiptKey: string,
) =>
  Effect.gen(function* () {
    const option = yield* (yield* DatabaseReader)
      .table("brainKnowledgeCandidates")
      .index("by_workspace_and_candidate_receipt_key", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("candidateReceiptKey", candidateReceiptKey),
      )
      .first()
      .pipe(Effect.orDie);
    if (option._tag !== "Some")
      return yield* invalid(
        "candidateReceiptKey",
        "Knowledge candidate was not found.",
      );
    return option.value;
  });

type Candidate = BrainKnowledgeCandidatesDoc;

const reopenCandidateEvidence = (
  workspaceId: Parameters<typeof requireWorkspaceAccess>[0],
  candidate: Candidate,
) =>
  Effect.gen(function* () {
    if (candidate.evidence.length !== 1)
      return yield* invalid(
        "candidateReceiptKey",
        "Candidate does not have exactly one bounded evidence citation.",
      );
    const rows = yield* (yield* DatabaseReader)
      .table("brainRetrievalEntries")
      .index("by_workspace_and_source_key_and_status", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("sourceKey", candidate.sourceKey)
          .eq("status", "current"),
      )
      .take(2)
      .pipe(Effect.orDie);
    const [entry] = rows;
    const [evidence] = candidate.evidence;
    if (rows.length !== 1 || entry === undefined || evidence === undefined)
      return yield* invalid(
        "candidateReceiptKey",
        "Candidate evidence is no longer uniquely current.",
      );
    if (!isExactEvidenceReopenable(candidate, evidence, entry))
      return yield* invalid(
        "candidateReceiptKey",
        "Candidate evidence failed exact reopening.",
      );
    return { entry, evidence };
  });

const listCandidates = (
  {
    workspaceId,
    state,
    limit,
  }: {
    readonly workspaceId: GenericId<"workspaces">;
    readonly state?:
      "unreviewed" | "accepted" | "rejected" | "stale" | undefined;
    readonly limit?: number | undefined;
  },
  actorUserId?: GenericId<"users">,
) =>
  Effect.gen(function* () {
    if (actorUserId === undefined)
      yield* withClock(requireWorkspaceAccess(workspaceId, "viewer"));
    else
      yield* withClock(
        requireWorkspaceActorAccess(workspaceId, actorUserId, "viewer"),
      );
    const activeQueue = state === undefined || state === "unreviewed";
    const maximumLimit = activeQueue ? PILOT_SURFACED_LIMIT : MAX_QUEUE_LIMIT;
    const boundedLimit = limit ?? PILOT_SURFACED_LIMIT;
    if (
      !Number.isInteger(boundedLimit) ||
      boundedLimit < 1 ||
      boundedLimit > maximumLimit
    )
      return yield* invalid(
        "limit",
        `Candidate list limit must be between 1 and ${maximumLimit}.`,
      );
    const now = yield* withClock(Clock.currentTimeMillis);
    const reader = yield* DatabaseReader;
    const candidates = yield* (
      activeQueue
        ? reader
            .table("brainKnowledgeCandidates")
            .index("by_workspace_and_current_state_and_created_at", (q) =>
              q
                .eq("workspaceId", workspaceId)
                .eq("currentState", "unreviewed")
                .gte("createdAt", now - ACTIVE_CANDIDATE_TTL_MS),
            )
            .take(MAX_ACTIVE_QUEUE_SCAN)
        : reader
            .table("brainKnowledgeCandidates")
            .index("by_workspace_and_current_state_and_updated_at", (q) =>
              q
                .eq("workspaceId", workspaceId)
                .eq("currentState", state as NonNullable<typeof state>),
            )
            .take(MAX_QUEUE_LIMIT)
    ).pipe(Effect.orDie);
    if (activeQueue && candidates.length >= MAX_ACTIVE_QUEUE_SCAN)
      return yield* invalid(
        "workspaceId",
        "Active review queue exceeded its bounded pilot capacity.",
      );
    const visible = [];
    const visibleFingerprints = new Set<string>();
    const sourceCounts = new Map<string, number>();
    const prioritized = [...candidates].sort(
      (left, right) =>
        right.quotability - left.quotability ||
        right.extractionConfidence - left.extractionConfidence ||
        right.updatedAt - left.updatedAt ||
        left.candidateReceiptKey.localeCompare(right.candidateReceiptKey),
    );
    for (const candidate of prioritized) {
      if (visible.length >= boundedLimit) break;
      if (
        (state === undefined || state === "unreviewed") &&
        (candidate.createdAt < now - ACTIVE_CANDIDATE_TTL_MS ||
          (candidate.temporalValidAt !== undefined &&
            candidate.temporalValidAt > now) ||
          (candidate.temporalExpiresAt !== undefined &&
            candidate.temporalExpiresAt <= now))
      )
        continue;
      if (visibleFingerprints.has(candidate.propositionFingerprint)) continue;
      if ((sourceCounts.get(candidate.sourceRevisionKey) ?? 0) >= 5) continue;
      const source = yield* reader
        .table("brainEvidenceSources")
        .index("by_workspace_and_source_key", (q) =>
          q.eq("workspaceId", workspaceId).eq("sourceKey", candidate.sourceKey),
        )
        .first()
        .pipe(Effect.orDie);
      if (source._tag !== "Some") continue;
      if (
        candidate.currentState === "unreviewed" ||
        candidate.currentState === "stale"
      ) {
        const entries = yield* reader
          .table("brainRetrievalEntries")
          .index("by_workspace_and_source_key_and_status", (q) =>
            q
              .eq("workspaceId", workspaceId)
              .eq("sourceKey", candidate.sourceKey)
              .eq("status", "current"),
          )
          .take(2)
          .pipe(Effect.orDie);
        const [entry] = entries;
        if (entries.length !== 1 || entry === undefined) continue;
        if (
          entry.revisionKey !== candidate.sourceRevisionKey ||
          entry.semanticStatus !== "completed" ||
          entry.semanticPolicyVersion !== candidate.extractionPolicyVersion
        )
          continue;
      }
      visible.push({
        candidateId: candidate._id,
        candidateReceiptKey: candidate.candidateReceiptKey,
        propositionFingerprint: candidate.propositionFingerprint,
        body: candidate.body,
        epistemics: candidate.epistemics,
        tags: [...candidate.tags],
        extractionConfidence: candidate.extractionConfidence,
        currentState: candidate.currentState,
        reviewRevision: candidate.reviewRevision,
        sourceTitle: source.value.title,
        sourceProvider: source.value.provider,
        evidence: [...candidate.evidence],
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
      });
      visibleFingerprints.add(candidate.propositionFingerprint);
      sourceCounts.set(
        candidate.sourceRevisionKey,
        (sourceCounts.get(candidate.sourceRevisionKey) ?? 0) + 1,
      );
    }
    return visible;
  });

const listBrainKnowledgeCandidates = FunctionImpl.make(
  databaseSchema,
  group,
  "listBrainKnowledgeCandidates",
  (args) => listCandidates(args),
);
const listBrainKnowledgeCandidatesForActor = FunctionImpl.make(
  databaseSchema,
  group,
  "listBrainKnowledgeCandidatesForActor",
  ({ userId, ...args }) => listCandidates(args, userId),
);

const reviewCandidate = (
  args: {
    readonly workspaceId: GenericId<"workspaces">;
    readonly candidateReceiptKey: string;
    readonly expectedReviewRevision: number;
    readonly idempotencyKey: string;
    readonly action: "accept" | "edit_and_accept" | "reject";
    readonly body?: string | undefined;
    readonly reason?: string | undefined;
    readonly reviewHorizonDays?: number | undefined;
  },
  actorUserId?: GenericId<"users">,
) =>
  Effect.gen(function* () {
    const userId =
      actorUserId ??
      (yield* withClock(requireWorkspaceAccess(args.workspaceId, "editor")))
        .userId;
    yield* withClock(
      requireWorkspaceActorAccess(args.workspaceId, userId, "editor"),
    );
    if (
      args.candidateReceiptKey.trim().length === 0 ||
      args.candidateReceiptKey.length > 500
    )
      return yield* invalid(
        "candidateReceiptKey",
        "Candidate receipt key is blank or exceeds capacity.",
      );
    if (
      args.idempotencyKey.trim().length === 0 ||
      args.idempotencyKey.length > 500
    )
      return yield* invalid(
        "idempotencyKey",
        "Idempotency key is blank or exceeds capacity.",
      );
    const candidate = yield* candidateByReceipt(
      args.workspaceId,
      args.candidateReceiptKey,
    );
    const now = yield* withClock(Clock.currentTimeMillis);
    const reviewHorizonDays = args.reviewHorizonDays ?? 90;
    if (
      !Number.isInteger(reviewHorizonDays) ||
      reviewHorizonDays < 30 ||
      reviewHorizonDays > 365
    )
      return yield* invalid(
        "reviewHorizonDays",
        "Review horizon must be between 30 and 365 days.",
      );
    const prior = candidate.reviewHistory.find(
      (event) => event.idempotencyKey === args.idempotencyKey,
    );
    const requestedBody = acceptedReviewBody({
      action: args.action,
      candidateBody: candidate.body,
      ...(args.body === undefined ? {} : { editedBody: args.body }),
    });
    const requestHash = `sha256:${sha256Hex(
      JSON.stringify({
        action: args.action,
        body: requestedBody,
        reason: args.reason ?? null,
        reviewHorizonDays,
      }),
    )}`;
    if (
      prior !== undefined &&
      (prior.requestHash !== undefined
        ? prior.requestHash !== requestHash
        : prior.action !== args.action ||
          prior.bodyHash !== `sha256:${sha256Hex(requestedBody)}` ||
          prior.reason !== args.reason)
    )
      return yield* invalid(
        "idempotencyKey",
        "Idempotency key was already used for a different review request.",
      );
    if (prior !== undefined)
      return {
        status:
          candidate.currentState === "rejected"
            ? ("rejected" as const)
            : ("accepted" as const),
        candidateReceiptKey: candidate.candidateReceiptKey,
        reviewRevision: candidate.reviewRevision,
        ...(candidate.claimId === undefined
          ? {}
          : {
              claimId: candidate.claimId,
              citationKey: `citation:${sha256Hex(
                `${candidate.candidateReceiptKey}:${candidate.evidence[0]?.startOffset}:${candidate.evidence[0]?.endOffset}`,
              )}`,
            }),
        reviewedAt: prior.occurredAt,
      };
    if (
      candidate.createdAt < now - ACTIVE_CANDIDATE_TTL_MS ||
      (candidate.temporalExpiresAt !== undefined &&
        candidate.temporalExpiresAt <= now)
    )
      return yield* invalid(
        "candidateReceiptKey",
        "Knowledge candidate has expired from active review.",
      );
    if (
      candidate.temporalValidAt !== undefined &&
      candidate.temporalValidAt > now
    )
      return yield* invalid(
        "candidateReceiptKey",
        "Knowledge candidate is not valid yet.",
      );
    if (
      !Number.isInteger(args.expectedReviewRevision) ||
      args.expectedReviewRevision !== candidate.reviewRevision
    )
      return yield* invalid(
        "expectedReviewRevision",
        "Candidate changed after the reviewer opened it.",
      );
    if (
      candidate.currentState !== "unreviewed" &&
      candidate.currentState !== "stale"
    )
      return yield* invalid(
        "candidateReceiptKey",
        "Candidate has already been reviewed.",
      );
    const body = requestedBody;
    if (
      (args.action === "edit_and_accept" && body.length === 0) ||
      body.length > 500
    )
      return yield* invalid(
        "body",
        "Accepted claim body is blank or exceeds 500 characters.",
      );
    if ((args.reason ?? "").length > 1_000)
      return yield* invalid("reason", "Review reason exceeds capacity.");
    const nextRevision = candidate.reviewRevision + 1;
    const event = {
      revision: nextRevision,
      action: args.action,
      bodyHash: `sha256:${sha256Hex(body)}`,
      requestHash,
      ...(args.reason === undefined ? {} : { reason: args.reason }),
      actorId: userId,
      idempotencyKey: args.idempotencyKey,
      occurredAt: now,
    };
    const writer = yield* DatabaseWriter;
    if (args.action === "reject") {
      yield* writer
        .table("brainKnowledgeCandidates")
        .patch(candidate._id, {
          currentState: "rejected",
          reviewRevision: nextRevision,
          reviewHistory: [...candidate.reviewHistory.slice(-7), event],
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      return {
        status: "rejected" as const,
        candidateReceiptKey: candidate.candidateReceiptKey,
        reviewRevision: nextRevision,
        reviewedAt: now,
      };
    }
    const { entry, evidence } = yield* reopenCandidateEvidence(
      args.workspaceId,
      candidate,
    );
    const propositionFingerprint = `sha256:${sha256Hex(body.toLowerCase())}`;
    const reader = yield* DatabaseReader;
    const matchingClaims = yield* reader
      .table("claims")
      .index("by_workspace_and_proposition_fingerprint_and_status", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("propositionFingerprint", propositionFingerprint)
          .eq("status", "supported"),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (matchingClaims.length > 1)
      return yield* invalid(
        "candidateReceiptKey",
        "Supported proposition is not uniquely represented.",
      );
    const [matchingClaim] = matchingClaims;
    const existingClaimCitations =
      matchingClaim === undefined
        ? []
        : yield* reader
            .table("citations")
            .index("by_claim", (q) =>
              q.eq("claimId", String(matchingClaim._id)),
            )
            .take(MAX_CLAIM_CITATIONS + 1)
            .pipe(Effect.orDie);
    if (existingClaimCitations.length > MAX_CLAIM_CITATIONS)
      return yield* invalid(
        "candidateReceiptKey",
        "Supported proposition exceeded its citation capacity.",
      );
    const duplicateCitation = existingClaimCitations.find(
      (citation) =>
        citation.sourceKey === evidence.sourceKey &&
        citation.revisionKey === evidence.revisionKey &&
        citation.startOffset === evidence.startOffset &&
        citation.endOffset === evidence.endOffset,
    );
    if (
      duplicateCitation === undefined &&
      matchingClaim !== undefined &&
      matchingClaim.citationIds.length >= MAX_CLAIM_CITATIONS
    )
      return yield* invalid(
        "candidateReceiptKey",
        "Supported proposition reached its citation capacity.",
      );
    const claimKey = `claim:${sha256Hex(candidate.candidateReceiptKey)}`;
    const citationKey =
      duplicateCitation?.citationId ??
      `citation:${sha256Hex(
        `${candidate.candidateReceiptKey}:${evidence.startOffset}:${evidence.endOffset}`,
      )}`;
    const nextReviewAt = Math.min(
      now + reviewHorizonDays * DAY_MS,
      candidate.temporalExpiresAt ?? Number.MAX_SAFE_INTEGER,
    );
    const claimDbId =
      matchingClaim === undefined
        ? yield* writer
            .table("claims")
            .insert({
              workspaceId: args.workspaceId,
              claimId: claimKey,
              conceptIds: [],
              body,
              status: "supported",
              citationIds: [],
              candidateReceiptKey: candidate.candidateReceiptKey,
              propositionFingerprint,
              epistemics: candidate.epistemics,
              tags: [...candidate.tags],
              verifiedAt: now,
              nextReviewAt,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie)
        : matchingClaim._id;
    if (duplicateCitation === undefined)
      yield* writer
        .table("citations")
        .insert({
          workspaceId: args.workspaceId,
          citationId: citationKey,
          claimId: String(claimDbId),
          sourceId: candidate.sourceKey,
          sourceKind:
            entry.provider === "slack"
              ? "slack_thread"
              : entry.provider === "google_drive"
                ? "document"
                : "note",
          sourceTitle: entry.title,
          quotedText: evidence.quote,
          startOffset: evidence.startOffset,
          endOffset: evidence.endOffset,
          revisionKey: evidence.revisionKey,
          sourceKey: evidence.sourceKey,
          contentHash: evidence.contentHash,
          ...(evidence.locator === undefined
            ? {}
            : { locator: evidence.locator }),
          provider: entry.provider,
          createdAt: now,
        })
        .pipe(Effect.orDie);
    yield* writer
      .table("claims")
      .patch(claimDbId, {
        citationIds:
          duplicateCitation === undefined
            ? [...(matchingClaim?.citationIds ?? []), citationKey]
            : [...(matchingClaim?.citationIds ?? [])],
        tags: [
          ...new Set([...(matchingClaim?.tags ?? []), ...candidate.tags]),
        ].slice(0, 4),
        verifiedAt: now,
        nextReviewAt,
        sourceWithdrawnAt: undefined,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("brainKnowledgeCandidates")
      .patch(candidate._id, {
        body,
        currentState: "accepted",
        reviewRevision: nextRevision,
        reviewHistory: [...candidate.reviewHistory.slice(-7), event],
        claimId: claimDbId,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return {
      status: "accepted" as const,
      candidateReceiptKey: candidate.candidateReceiptKey,
      reviewRevision: nextRevision,
      claimId: claimDbId,
      citationKey,
      reviewedAt: now,
    };
  });

const reviewBrainKnowledgeCandidate = FunctionImpl.make(
  databaseSchema,
  group,
  "reviewBrainKnowledgeCandidate",
  (args) => reviewCandidate(args),
);
const reviewBrainKnowledgeCandidateForActor = FunctionImpl.make(
  databaseSchema,
  group,
  "reviewBrainKnowledgeCandidateForActor",
  ({ userId, ...args }) => reviewCandidate(args, userId),
);

export default GroupImpl.make(databaseSchema, group).pipe(
  Layer.provide(reviewBrainKnowledgeCandidate),
  Layer.provide(reviewBrainKnowledgeCandidateForActor),
  Layer.provide(listBrainKnowledgeCandidates),
  Layer.provide(listBrainKnowledgeCandidatesForActor),
  GroupImpl.finalize,
);
