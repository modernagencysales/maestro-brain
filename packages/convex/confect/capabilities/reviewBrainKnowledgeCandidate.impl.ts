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

const REVIEW_HORIZON_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_QUEUE_LIMIT = 50;
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
    const boundedLimit = limit ?? 25;
    if (
      !Number.isInteger(boundedLimit) ||
      boundedLimit < 1 ||
      boundedLimit > MAX_QUEUE_LIMIT
    )
      return yield* invalid(
        "limit",
        `Candidate queue limit must be between 1 and ${MAX_QUEUE_LIMIT}.`,
      );
    const reader = yield* DatabaseReader;
    const candidates = yield* reader
      .table("brainKnowledgeCandidates")
      .index("by_workspace_and_current_state_and_updated_at", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("currentState", state ?? "unreviewed"),
      )
      .take(boundedLimit * 3)
      .pipe(Effect.orDie);
    const visible = [];
    for (const candidate of candidates) {
      if (visible.length >= boundedLimit) break;
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
        sourceTitle: entry.title,
        sourceProvider: entry.provider,
        evidence: [...candidate.evidence],
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
      });
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
    const prior = candidate.reviewHistory.find(
      (event) => event.idempotencyKey === args.idempotencyKey,
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
          : { claimId: candidate.claimId }),
        reviewedAt: prior.occurredAt,
      };
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
    const now = yield* withClock(Clock.currentTimeMillis);
    const body = acceptedReviewBody({
      action: args.action,
      candidateBody: candidate.body,
      ...(args.body === undefined ? {} : { editedBody: args.body }),
    });
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
          reviewHistory: [...candidate.reviewHistory.slice(-19), event],
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
    const claimKey = `claim:${sha256Hex(candidate.candidateReceiptKey)}`;
    const citationKey = `citation:${sha256Hex(
      `${candidate.candidateReceiptKey}:${evidence.startOffset}:${evidence.endOffset}`,
    )}`;
    const claimDbId = yield* writer
      .table("claims")
      .insert({
        workspaceId: args.workspaceId,
        claimId: claimKey,
        conceptIds: [],
        body,
        status: "supported",
        citationIds: [],
        candidateReceiptKey: candidate.candidateReceiptKey,
        propositionFingerprint: candidate.propositionFingerprint,
        epistemics: candidate.epistemics,
        tags: [...candidate.tags],
        verifiedAt: now,
        nextReviewAt: now + REVIEW_HORIZON_MS,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
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
      .patch(claimDbId, { citationIds: [citationKey], updatedAt: now })
      .pipe(Effect.orDie);
    yield* writer
      .table("brainKnowledgeCandidates")
      .patch(candidate._id, {
        body,
        currentState: "accepted",
        reviewRevision: nextRevision,
        reviewHistory: [...candidate.reviewHistory.slice(-19), event],
        claimId: claimDbId,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return {
      status: "accepted" as const,
      candidateReceiptKey: candidate.candidateReceiptKey,
      reviewRevision: nextRevision,
      claimId: claimDbId,
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
