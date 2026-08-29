import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_788_019_200_000;

describe("Brain knowledge review contract", () => {
  it("lists only completed extraction, accepts exactly cited truth atomically, and replays idempotently", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const pageId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: seeded.workspaceId,
          slug: "pilot-pricing",
          title: "Pilot pricing",
          markdown: "The advisory pilot costs $5,000 per month.",
        },
      );
      const queued = yield* actor.mutation(
        refs.public.capabilities.extractBrainKnowledgeCandidates
          .queueBrainKnowledgeExtraction,
        { workspaceId: seeded.workspaceId, limit: 1 },
      );
      const candidateReceiptKey = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const writer = yield* DatabaseWriter;
          const entries = yield* reader
            .table("brainRetrievalEntries")
            .index("by_workspace_and_provider_and_status", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("provider", "brain_page")
                .eq("status", "current"),
            )
            .take(2)
            .pipe(Effect.orDie);
          const [entry] = entries;
          if (entry === undefined)
            return yield* Effect.die(
              "Expected one projected Brain page entry.",
            );
          const quote = "$5,000 per month";
          const startOffset = entry.markdown.indexOf(quote);
          const receipt = "candidate:test-pilot-price";
          yield* writer
            .table("brainRetrievalEntries")
            .patch(entry._id, {
              semanticPolicyVersion: "brain-extractor-v1",
              semanticStatus: "completed",
              semanticProposedCount: 1,
              semanticCandidateCount: 1,
              semanticGroundingFailureCount: 0,
              semanticProjectedAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("brainKnowledgeCandidates")
            .insert({
              workspaceId: seeded.workspaceId,
              candidateReceiptKey: receipt,
              sourceKey: entry.sourceKey,
              sourceRevisionKey: entry.revisionKey,
              extractionWindowKey: `full:0:${entry.markdown.length}`,
              extractionPolicyVersion: "brain-extractor-v1",
              propositionFingerprint: "sha256:pilot-price",
              body: "The advisory pilot costs $5,000 per month.",
              epistemics: "factual",
              quotability: 1,
              tags: ["pricing", "pilot"],
              evidence: [
                {
                  sourceKey: entry.sourceKey,
                  revisionKey: entry.revisionKey,
                  contentHash: entry.contentHash,
                  quote,
                  startOffset,
                  endOffset: startOffset + quote.length,
                  ...(entry.locator === undefined
                    ? {}
                    : { locator: entry.locator }),
                },
              ],
              extractionConfidence: 0.99,
              currentState: "unreviewed",
              reviewRevision: 0,
              reviewHistory: [],
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          return receipt;
        }),
        Schema.String,
      );
      const queue = yield* actor.query(
        refs.public.capabilities.reviewBrainKnowledgeCandidate
          .listBrainKnowledgeCandidates,
        { workspaceId: seeded.workspaceId },
      );
      const reviewInput = {
        workspaceId: seeded.workspaceId,
        candidateReceiptKey,
        expectedReviewRevision: 0,
        idempotencyKey: "review:test-pilot-price",
        action: "accept" as const,
      };
      const accepted = yield* actor.mutation(
        refs.public.capabilities.reviewBrainKnowledgeCandidate
          .reviewBrainKnowledgeCandidate,
        reviewInput,
      );
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const reader = yield* DatabaseReader;
          const stored = yield* reader
            .table("brainKnowledgeCandidates")
            .index("by_workspace_and_candidate_receipt_key", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("candidateReceiptKey", candidateReceiptKey),
            )
            .first()
            .pipe(Effect.orDie);
          if (stored._tag !== "Some")
            return yield* Effect.die("accepted candidate disappeared");
          yield* writer
            .table("brainKnowledgeCandidates")
            .patch(stored.value._id, { temporalExpiresAt: 0 })
            .pipe(Effect.orDie);
          return null;
        }),
        Schema.Null,
      );
      const replayed = yield* actor.mutation(
        refs.public.capabilities.reviewBrainKnowledgeCandidate
          .reviewBrainKnowledgeCandidate,
        reviewInput,
      );
      const conflictingReplay = yield* Effect.result(
        actor.mutation(
          refs.public.capabilities.reviewBrainKnowledgeCandidate
            .reviewBrainKnowledgeCandidate,
          { ...reviewInput, reviewHorizonDays: 365 },
        ),
      );
      const staleReview = yield* Effect.result(
        actor.mutation(
          refs.public.capabilities.reviewBrainKnowledgeCandidate
            .reviewBrainKnowledgeCandidate,
          {
            ...reviewInput,
            idempotencyKey: "review:stale-pilot-price",
          },
        ),
      );
      const currentPage = yield* actor.query(refs.public.brain.pages.get, {
        workspaceId: seeded.workspaceId,
        pageId,
      });
      yield* actor.mutation(refs.public.brain.pages.updateMarkdown, {
        workspaceId: seeded.workspaceId,
        pageId,
        markdown:
          "The advisory pilot costs $5,000 per month. Updated terms are under review.",
        expectedUpdatedAt: currentPage.updatedAt,
      });
      yield* confect.mutation(refs.internal.ops.flags.upsertPolicyInternal, {
        workspaceId: seeded.workspaceId,
        key: "template.brain.contextV4",
        description: "Enable reviewed company truth for the pilot workspace.",
        enabled: true,
        rolloutPercent: 100,
        audience: "workspace",
      });
      const answer = yield* actor.query(
        refs.public.capabilities.askCompanyBrain.askCompanyBrain,
        {
          workspaceId: seeded.workspaceId,
          question: "What does the advisory pilot cost?",
          evidenceMode: "company_truth",
          asOf: now,
        },
      );
      const repeatedAnswer = yield* actor.query(
        refs.public.capabilities.askCompanyBrain.askCompanyBrain,
        {
          workspaceId: seeded.workspaceId,
          question: "What does the advisory pilot cost?",
          evidenceMode: "company_truth",
          asOf: now,
        },
      );
      yield* confect.mutation(refs.internal.ops.flags.upsertPolicyInternal, {
        workspaceId: seeded.workspaceId,
        key: "template.brain.contextV4",
        description: "Disable reviewed-truth retrieval for fallback test.",
        enabled: false,
        rolloutPercent: 0,
        audience: "workspace",
      });
      const fallback = yield* actor.query(
        refs.public.capabilities.askCompanyBrain.askCompanyBrain,
        {
          workspaceId: seeded.workspaceId,
          question: "What does the advisory pilot cost?",
          evidenceMode: "company_truth",
          asOf: now,
        },
      );
      const updatedPage = yield* actor.query(refs.public.brain.pages.get, {
        workspaceId: seeded.workspaceId,
        pageId,
      });
      yield* actor.mutation(refs.public.brain.pages.archive, {
        workspaceId: seeded.workspaceId,
        pageId,
        expectedUpdatedAt: updatedPage.updatedAt,
      });
      const ledger = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const claims = yield* reader
            .table("claims")
            .index("by_workspace_status", (q) =>
              q.eq("workspaceId", seeded.workspaceId).eq("status", "supported"),
            )
            .take(10)
            .pipe(Effect.orDie);
          const citations = yield* reader
            .table("citations")
            .index("by_workspace", (q) =>
              q.eq("workspaceId", seeded.workspaceId),
            )
            .take(10)
            .pipe(Effect.orDie);
          return JSON.stringify({ claims, citations });
        }),
        Schema.String,
      );
      return {
        queued,
        queue,
        accepted,
        replayed,
        conflictingReplay,
        staleReview,
        answer,
        repeatedAnswer,
        fallback,
        ledger,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.queue).toHaveLength(1);
    expect(result.queued).toMatchObject({
      scheduledCount: 1,
      extractionPolicyVersion: "brain-extractor-v1",
    });
    expect(result.accepted).toMatchObject({
      status: "accepted",
      reviewRevision: 1,
      citationKey: expect.any(String),
    });
    expect(result.replayed).toEqual(result.accepted);
    expect(result.conflictingReplay._tag).toBe("Failure");
    expect(result.staleReview._tag).toBe("Failure");
    expect(JSON.parse(result.ledger)).toMatchObject({
      claims: [
        {
          status: "supported",
          citationIds: [expect.any(String)],
          sourceWithdrawnAt: expect.any(Number),
        },
      ],
      citations: [
        {
          quotedText: "$5,000 per month",
          sourceKey: expect.any(String),
          revisionKey: expect.any(String),
        },
      ],
    });
    expect(result.answer.contextPack.omissions).toEqual([]);
    expect(result.repeatedAnswer.contextPack.packHash).toBe(
      result.answer.contextPack.packHash,
    );
    expect(
      result.repeatedAnswer.contextPack.citations.map((citation) => [
        citation.citationKey,
        citation.sourceKey,
        citation.revisionKey,
      ]),
    ).toEqual(
      result.answer.contextPack.citations.map((citation) => [
        citation.citationKey,
        citation.sourceKey,
        citation.revisionKey,
      ]),
    );
    expect(result.answer).toMatchObject({
      status: "answered",
      contextPack: {
        schemaVersion: "4",
        evidenceMode: "company_truth",
        claims: [{ body: "The advisory pilot costs $5,000 per month." }],
        freshness: "review-due",
      },
    });
    expect(result.fallback).toMatchObject({
      status: "answered",
      contextPack: {
        requestedEvidenceMode: "company_truth",
        evidenceMode: "recent_evidence",
        fallbackReason: "context-v4-disabled",
        claims: [],
      },
    });
  }, 15_000);
});
