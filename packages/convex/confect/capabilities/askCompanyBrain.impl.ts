import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import { DatabaseReader } from "../_generated/services";
import { searchEvidence } from "../brain/evidence.impl";
import { ValidationFailed } from "../errors";
import {
  requireWorkspaceAccess,
  requireWorkspaceActorAccess,
} from "./_kit/workspaceAccess";
import {
  aggregateFreshness,
  canonicalContextPackHash,
  claimFreshness,
  CONTEXT_PACK_POLICY_VERSION,
  freshnessWeight,
  lexicalScore,
  MAX_CONTEXT_CITATIONS,
  normalizedEvidenceBody,
  probableEvidenceConflict,
  sourceAuthorityWeight,
  type BrainPackFreshness,
} from "./askCompanyBrain.domain";
import group from "./askCompanyBrain.spec";

const MAX_SUPPORTED_CLAIMS = 500;
const invalid = (field: string, message: string) =>
  new ValidationFailed({ field, message });
const withClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

type AskInput = {
  readonly workspaceId: GenericId<"workspaces">;
  readonly question: string;
  readonly evidenceMode?:
    "recent_evidence" | "company_truth" | "mixed" | undefined;
  readonly maxCitations?: number | undefined;
  readonly asOf?: number | undefined;
  readonly riskLevel?: "ordinary" | "high" | undefined;
};

const rolloutBucket = (input: string): number => {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1)
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  return hash % 100;
};

const contextV4Enabled = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const override = yield* reader
      .table("featureFlagPolicies")
      .index("by_workspace_key", (q) =>
        q.eq("workspaceId", workspaceId).eq("key", "template.brain.contextV4"),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (override.length === 0) return true;
    if (override.length !== 1) return false;
    const [policy] = override;
    if (policy === undefined) return false;
    return (
      policy.enabled &&
      rolloutBucket(`${policy.key}:${workspaceId}`) <
        Math.max(0, Math.min(100, Math.trunc(policy.rolloutPercent)))
    );
  });

const reopenCitationRevision = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly sourceKey: string;
  readonly revisionKey: string;
  readonly contentHash: string;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const revisions = yield* reader
      .table("brainEvidenceRevisions")
      .index("by_workspace_and_source_key_and_revision_key", (q) =>
        q
          .eq("workspaceId", input.workspaceId)
          .eq("sourceKey", input.sourceKey)
          .eq("revisionKey", input.revisionKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const [revision] = revisions;
    if (
      revisions.length !== 1 ||
      revision === undefined ||
      revision.tombstone ||
      revision.contentHash !== input.contentHash
    )
      return { status: "inaccessible" as const };
    const source = yield* reader
      .table("brainEvidenceSources")
      .index("by_workspace_and_source_key", (q) =>
        q.eq("workspaceId", input.workspaceId).eq("sourceKey", input.sourceKey),
      )
      .first()
      .pipe(Effect.orDie);
    if (source._tag !== "Some" || source.value.status !== "active")
      return { status: "withdrawn" as const };
    if (
      revision.provider === "brain_page" ||
      revision.provider === "transcript"
    )
      return {
        status: "eligible" as const,
        revision,
        isCurrent: source.value.currentRevisionKey === input.revisionKey,
      };
    const connectionProvider =
      revision.provider === "google_drive" ? "google-drive" : revision.provider;
    const connection = yield* reader
      .table("providerConnections")
      .index("by_workspace_and_provider", (q) =>
        q
          .eq("workspaceId", input.workspaceId)
          .eq("provider", connectionProvider),
      )
      .first()
      .pipe(Effect.orDie);
    return connection._tag === "Some" &&
      "workspaceId" in connection.value &&
      connection.value.status === "active"
      ? {
          status: "eligible" as const,
          revision,
          isCurrent: source.value.currentRevisionKey === input.revisionKey,
        }
      : { status: "withdrawn" as const };
  });

export const assembleCompanyBrainContext = (input: AskInput) =>
  Effect.gen(function* () {
    const question = input.question.trim();
    if (question.length === 0 || question.length > 2_000)
      return yield* invalid(
        "question",
        "Question must contain between 1 and 2000 characters.",
      );
    const maxCitations = input.maxCitations ?? 5;
    if (
      !Number.isInteger(maxCitations) ||
      maxCitations < 1 ||
      maxCitations > MAX_CONTEXT_CITATIONS
    )
      return yield* invalid(
        "maxCitations",
        `maxCitations must be between 1 and ${MAX_CONTEXT_CITATIONS}.`,
      );
    const asOf = input.asOf ?? (yield* withClock(Clock.currentTimeMillis));
    if (!Number.isFinite(asOf) || asOf < 0)
      return yield* invalid("asOf", "asOf must be a non-negative timestamp.");
    const requestedEvidenceMode = input.evidenceMode ?? "mixed";
    const v4Enabled = yield* contextV4Enabled(input.workspaceId);
    const evidenceMode = v4Enabled
      ? requestedEvidenceMode
      : ("recent_evidence" as const);
    const fallbackReason =
      !v4Enabled && requestedEvidenceMode !== "recent_evidence"
        ? ("context-v4-disabled" as const)
        : undefined;
    const includeTruth = evidenceMode !== "recent_evidence";
    const includeRecent = evidenceMode !== "company_truth";
    const reader = yield* DatabaseReader;
    type OmissionReason =
      | "archived"
      | "revision-mismatch"
      | "not-relevant"
      | "citation-inaccessible"
      | "stale-high-risk"
      | "possible-conflict"
      | "capacity";
    const omissions = new Map<OmissionReason, number>();
    const omit = (reason: OmissionReason, count = 1) =>
      omissions.set(reason, (omissions.get(reason) ?? 0) + count);
    const claims = [];
    const citations = [];

    if (includeTruth) {
      const supported = yield* reader
        .table("claims")
        .index("by_workspace_status", (q) =>
          q.eq("workspaceId", input.workspaceId).eq("status", "supported"),
        )
        .take(MAX_SUPPORTED_CLAIMS + 1)
        .pipe(Effect.orDie);
      if (supported.length > MAX_SUPPORTED_CLAIMS) omit("capacity");
      const truthLimit = includeRecent
        ? Math.max(0, maxCitations - 1)
        : maxCitations;
      const ranked = supported
        .slice(0, MAX_SUPPORTED_CLAIMS)
        .map((claim) => ({
          claim,
          score: lexicalScore(
            question,
            `${claim.body} ${(claim.tags ?? []).join(" ")}`,
          ),
        }))
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.claim.claimId.localeCompare(right.claim.claimId),
        )
        .slice(0, truthLimit);
      omit("not-relevant", Math.max(0, supported.length - ranked.length));
      for (const { claim } of ranked) {
        if (
          claim.epistemics === undefined ||
          claim.verifiedAt === undefined ||
          claim.nextReviewAt === undefined ||
          claim.propositionFingerprint === undefined
        ) {
          omit("citation-inaccessible");
          continue;
        }
        const stored = yield* reader
          .table("citations")
          .index("by_claim", (q) => q.eq("claimId", String(claim._id)))
          .take(3)
          .pipe(Effect.orDie);
        const [citation] = stored;
        if (stored.length !== 1 || citation === undefined) {
          omit("citation-inaccessible");
          continue;
        }
        if (
          citation.sourceKey === undefined ||
          citation.revisionKey === undefined ||
          citation.contentHash === undefined
        ) {
          omit("citation-inaccessible");
          continue;
        }
        const reopened = yield* reopenCitationRevision({
          workspaceId: input.workspaceId,
          sourceKey: citation.sourceKey,
          revisionKey: citation.revisionKey,
          contentHash: citation.contentHash,
        });
        if (
          reopened.status !== "eligible" ||
          !Number.isInteger(citation.startOffset) ||
          !Number.isInteger(citation.endOffset) ||
          citation.startOffset < 0 ||
          citation.endOffset <= citation.startOffset ||
          (reopened.status === "eligible" &&
            reopened.revision.markdown.slice(
              citation.startOffset,
              citation.endOffset,
            )) !== citation.quotedText
        ) {
          omit(
            reopened.status === "withdrawn"
              ? "archived"
              : "citation-inaccessible",
          );
          continue;
        }
        const horizonFreshness = claimFreshness(claim.nextReviewAt, asOf);
        const freshness =
          !reopened.isCurrent && horizonFreshness === "current"
            ? ("review-due" as const)
            : horizonFreshness;
        const citationKey = citation.citationId;
        const claimTags = [...(claim.tags ?? [])];
        const claimRelevance = lexicalScore(
          question,
          `${claim.body} ${claimTags.join(" ")}`,
        );
        const claimTagMatch = lexicalScore(question, claimTags.join(" "));
        claims.push({
          claimId: claim._id,
          body: claim.body,
          epistemics: claim.epistemics,
          tags: claimTags,
          verifiedAt: claim.verifiedAt,
          nextReviewAt: claim.nextReviewAt,
          freshness,
          propositionFingerprint: claim.propositionFingerprint,
          citationKeys: [citationKey],
        });
        citations.push({
          citationKey,
          supportKind: "claim" as const,
          claimId: claim._id,
          sourceKey: citation.sourceKey,
          revisionKey: citation.revisionKey,
          provider: reopened.revision.provider,
          title: citation.sourceTitle,
          excerpt: citation.quotedText,
          startOffset: citation.startOffset,
          endOffset: citation.endOffset,
          contentHash: citation.contentHash,
          ...(citation.locator === undefined
            ? reopened.revision.locator === undefined
              ? {}
              : { locator: reopened.revision.locator }
            : { locator: citation.locator }),
          sourceModifiedAt: reopened.revision.sourceModifiedAt,
          observedAt: reopened.revision.observedAt,
          freshness: freshness === "unknown" ? ("stale" as const) : freshness,
          ranking: {
            relevance: claimRelevance,
            reviewState: 3,
            sourceAuthority: sourceAuthorityWeight(reopened.revision.provider),
            freshness: freshnessWeight(freshness),
            tagMatch: claimTagMatch,
            corroboration: 0,
            total:
              claimRelevance * 10 +
              3 * 3 +
              sourceAuthorityWeight(reopened.revision.provider) * 2 +
              freshnessWeight(freshness) * 2 +
              claimTagMatch * 2,
          },
        });
      }
    }

    const recentCitations = [];
    if (includeRecent || includeTruth) {
      const recent = yield* searchEvidence({
        workspaceId: input.workspaceId,
        query: question,
        limit: maxCitations,
        asOf,
        relevanceMode: "grounded",
      });
      const rankedRecent = recent
        .map((item) => {
          const relevance = lexicalScore(
            question,
            `${item.title} ${item.excerpt}`,
          );
          const sourceAuthority = sourceAuthorityWeight(item.provider);
          const freshness = freshnessWeight(item.freshness);
          const corroboration = Math.max(
            0,
            recent.filter(
              (other) =>
                other.sourceKey !== item.sourceKey &&
                normalizedEvidenceBody(other.excerpt) ===
                  normalizedEvidenceBody(item.excerpt),
            ).length,
          );
          const ranking = {
            relevance,
            reviewState: item.provider === "brain_page" ? 1 : 0,
            sourceAuthority,
            freshness,
            tagMatch: 0,
            corroboration,
            total:
              relevance * 10 +
              (item.provider === "brain_page" ? 3 : 0) +
              sourceAuthority * 2 +
              freshness * 2 +
              corroboration,
          };
          return { item, ranking };
        })
        .sort(
          (left, right) =>
            right.ranking.total - left.ranking.total ||
            left.item.sourceKey.localeCompare(right.item.sourceKey),
        );
      for (const { item, ranking } of rankedRecent) {
        if (!includeRecent && item.provider !== "brain_page") continue;
        const duplicate = citations.some((citation) => {
          const exactRange =
            citation.sourceKey === item.sourceKey &&
            citation.revisionKey === item.revisionKey &&
            citation.startOffset === item.startOffset &&
            citation.endOffset === item.endOffset;
          const pageDrivePair =
            [citation.provider, item.provider].every((provider) =>
              ["brain_page", "google_drive"].includes(provider),
            ) &&
            (citation.contentHash === item.contentHash ||
              ("bodyIdentity" in citation &&
                citation.bodyIdentity === item.bodyIdentity));
          return exactRange || pageDrivePair;
        });
        if (duplicate || citations.length >= maxCitations) continue;
        const packedCitation = {
          citationKey: `citation:${item.entryKey}:${item.startOffset}:${item.endOffset}`,
          supportKind:
            item.provider === "brain_page"
              ? ("page" as const)
              : ("recent_evidence" as const),
          sourceKey: item.sourceKey,
          revisionKey: item.revisionKey,
          provider: item.provider,
          title: item.title,
          excerpt: item.excerpt,
          startOffset: item.startOffset,
          endOffset: item.endOffset,
          contentHash: item.contentHash,
          bodyIdentity: item.bodyIdentity,
          ...(item.locator === undefined ? {} : { locator: item.locator }),
          sourceModifiedAt: item.sourceModifiedAt,
          observedAt: item.observedAt,
          freshness: item.freshness,
          ranking,
        };
        citations.push(packedCitation);
        recentCitations.push(packedCitation);
      }
    }

    const conflictGroups = new Map<string, typeof claims>();
    for (const claim of claims) {
      const group = conflictGroups.get(claim.propositionFingerprint) ?? [];
      group.push(claim);
      conflictGroups.set(claim.propositionFingerprint, group);
    }
    const conflicts = [...conflictGroups.entries()].flatMap(
      ([propositionFingerprint, group]) =>
        group.length > 1 &&
        new Set(group.map(({ body }) => body.trim().toLowerCase())).size > 1
          ? [
              {
                propositionFingerprint,
                claimIds: group.map(({ claimId }) => claimId),
                citationKeys: group.flatMap(({ citationKeys }) => citationKeys),
                reason: "possible-contradiction" as const,
              },
            ]
          : [],
    );
    for (const claim of claims) {
      for (const citation of recentCitations) {
        if (
          citation.sourceModifiedAt > claim.verifiedAt &&
          probableEvidenceConflict(claim.body, citation.excerpt)
        )
          conflicts.push({
            propositionFingerprint: claim.propositionFingerprint,
            claimIds: [claim.claimId],
            citationKeys: [citation.citationKey],
            reason: "possible-contradiction" as const,
          });
      }
    }
    if (conflicts.length > 0) omit("possible-conflict", conflicts.length);
    const publicClaims = claims.map((claim) => ({
      claimId: claim.claimId,
      body: claim.body,
      epistemics: claim.epistemics,
      tags: claim.tags,
      verifiedAt: claim.verifiedAt,
      nextReviewAt: claim.nextReviewAt,
      freshness: claim.freshness,
      citationKeys: claim.citationKeys,
    }));
    const freshness = aggregateFreshness([
      ...publicClaims.map(({ freshness }) => freshness),
      ...citations.map(({ freshness }) => freshness),
    ] as BrainPackFreshness[]);
    const sortedCitations = citations.sort(
      (left, right) =>
        right.ranking.total - left.ranking.total ||
        left.sourceKey.localeCompare(right.sourceKey) ||
        left.revisionKey.localeCompare(right.revisionKey) ||
        left.startOffset - right.startOffset,
    );
    const sortedClaims = publicClaims.sort((left, right) =>
      String(left.claimId).localeCompare(String(right.claimId)),
    );
    const sortedConflicts = conflicts.sort((left, right) =>
      left.propositionFingerprint.localeCompare(right.propositionFingerprint),
    );
    const sortedOmissions = [...omissions.entries()]
      .filter(([, count]) => count > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]) => ({ reason, count }));
    const withoutHash = {
      schemaVersion: "4" as const,
      policyVersion: CONTEXT_PACK_POLICY_VERSION,
      requestedEvidenceMode,
      evidenceMode,
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      workspaceId: input.workspaceId,
      question,
      asOf,
      freshness,
      claims: sortedClaims,
      citations: sortedCitations,
      conflicts: sortedConflicts,
      omissions: sortedOmissions,
    };
    const contextPack = {
      ...withoutHash,
      packHash: canonicalContextPackHash(withoutHash),
    };
    const highRiskStale =
      input.riskLevel === "high" &&
      (sortedClaims.some(({ freshness }) => freshness === "stale") ||
        sortedCitations.some(({ freshness }) => freshness === "stale"));
    const blockedReason =
      input.riskLevel === "high" && sortedConflicts.length > 0
        ? ("possible-conflict" as const)
        : highRiskStale
          ? ("stale-high-risk" as const)
          : sortedCitations.length === 0
            ? ("no-eligible-evidence" as const)
            : null;
    if (blockedReason !== null)
      return {
        status: "insufficient-context" as const,
        reason: blockedReason,
        answerMarkdown: null,
        contextPack,
      };
    const claimLines = sortedClaims.map((claim) => {
      const citationIndex = sortedCitations.findIndex(
        ({ citationKey }) => citationKey === claim.citationKeys[0],
      );
      return `${claim.body} [${citationIndex + 1}]`;
    });
    const claimCitationKeys = new Set(
      sortedClaims.flatMap(({ citationKeys }) => citationKeys),
    );
    const evidenceLines = sortedCitations.flatMap((citation, index) =>
      claimCitationKeys.has(citation.citationKey)
        ? []
        : [`${citation.excerpt} [${index + 1}]`],
    );
    return {
      status: "answered" as const,
      answerMarkdown: [...claimLines, ...evidenceLines].join("\n\n"),
      contextPack,
    };
  });

const askCompanyBrain = FunctionImpl.make(
  databaseSchema,
  group,
  "askCompanyBrain",
  (args) =>
    Effect.gen(function* () {
      yield* withClock(requireWorkspaceAccess(args.workspaceId, "viewer"));
      return yield* assembleCompanyBrainContext(args);
    }),
);
const askCompanyBrainForActor = FunctionImpl.make(
  databaseSchema,
  group,
  "askCompanyBrainForActor",
  ({ userId, ...args }) =>
    Effect.gen(function* () {
      yield* withClock(
        requireWorkspaceActorAccess(args.workspaceId, userId, "viewer"),
      );
      return yield* assembleCompanyBrainContext(args);
    }),
);

export default GroupImpl.make(databaseSchema, group).pipe(
  Layer.provide(askCompanyBrain),
  Layer.provide(askCompanyBrainForActor),
  GroupImpl.finalize,
);
