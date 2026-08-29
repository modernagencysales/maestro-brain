import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { evidenceContentHash } from "../confect/brain/evidenceProjection";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_788_019_200_000;

describe("Brain knowledge review contract", () => {
  it("keeps reviewed truth current when cleanup retires an identical old-scope citation", async () => {
    const oldScope = "slack:old-reviewed-scope";
    const activeScope = "slack:active-reviewed-scope";
    const sourceKey = "shared-reviewed-source";
    const revisionKey = "revision-1";
    const title = "Shared reviewed evidence";
    const markdown = "The shared advisory pilot costs $7,000 per month.";
    const quotedText = "$7,000 per month";
    const startOffset = markdown.indexOf(quotedText);
    const contentHash = evidenceContentHash(title, markdown);
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          yield* writer
            .table("providerConnections")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              status: "active",
              generation: 1,
              connectionRef: "reviewed-connection",
              evidenceScopeKey: activeScope,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          for (const scopeKey of [oldScope, activeScope]) {
            yield* writer
              .table("brainEvidenceSources")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "slack",
                scopeKey,
                sourceKey,
                title,
                status: "active",
                generation: 1,
                currentRevisionKey: revisionKey,
                sourceModifiedAt: now,
                observedAt: now,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("brainEvidenceRevisions")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "slack",
                scopeKey,
                sourceKey,
                revisionKey,
                title,
                markdown,
                contentHash,
                sourceModifiedAt: now,
                observedAt: now,
                tombstone: false,
                createdAt: now,
              })
              .pipe(Effect.orDie);
          }
          yield* writer
            .table("brainConnectorRuns")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              scopeKey: oldScope,
              connectionGeneration: 1,
              runKey: "old-reviewed-run",
              status: "complete",
              startedAt: now,
              completedAt: now,
              discoveredCount: 1,
              publishedCount: 1,
              retiredCount: 0,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("claims")
            .insert({
              workspaceId: seeded.workspaceId,
              claimId: "claim-shared-scope",
              conceptIds: [],
              body: "The shared advisory pilot costs $7,000 per month.",
              status: "supported",
              citationIds: ["citation-shared-scope"],
              propositionFingerprint: "sha256:shared-scope-claim",
              epistemics: "factual",
              verifiedAt: now,
              nextReviewAt: now + 86_400_000,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("citations")
            .insert({
              workspaceId: seeded.workspaceId,
              citationId: "citation-shared-scope",
              claimId: "claim-shared-scope",
              sourceId: sourceKey,
              sourceKind: "slack_thread",
              sourceTitle: title,
              quotedText,
              startOffset,
              endOffset: startOffset + quotedText.length,
              revisionKey,
              sourceKey,
              contentHash,
              provider: "slack",
              createdAt: now,
            })
            .pipe(Effect.orDie);
        }),
      );
      const cleanup = yield* confect.mutation(
        refs.internal.brain.evidence.retireInactiveProviderScopes,
        {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          activeScopeKey: activeScope,
          connectionGeneration: 1,
          observedAt: now + 1,
        },
      );
      const state = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const claims = yield* reader
            .table("claims")
            .index("by_workspace", (q) =>
              q.eq("workspaceId", seeded.workspaceId),
            )
            .take(2)
            .pipe(Effect.orDie);
          const oldSources = yield* reader
            .table("brainEvidenceSources")
            .index("by_workspace_provider_scope_source", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("provider", "slack")
                .eq("scopeKey", oldScope)
                .eq("sourceKey", sourceKey),
            )
            .take(2)
            .pipe(Effect.orDie);
          return JSON.stringify({ claims, oldSources });
        }),
        Schema.String,
      );
      return { cleanup, state };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.cleanup).toEqual({ complete: true, retiredCount: 1 });
    expect(JSON.parse(result.state)).toMatchObject({
      claims: [
        {
          claimId: "claim-shared-scope",
          status: "supported",
          nextReviewAt: now + 86_400_000,
        },
      ],
      oldSources: [{ status: "removed" }],
    });
    expect(JSON.parse(result.state).claims[0]).not.toHaveProperty(
      "sourceWithdrawnAt",
    );
  });

  it("withdraws a reviewed claim while its cited connector scope is pending", async () => {
    const title = "Pending Slack evidence";
    const markdown = "The pending pilot price is $7,000 per month.";
    const quote = "$7,000 per month";
    const contentHash = evidenceContentHash(title, markdown);
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          yield* writer
            .table("providerConnections")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              status: "active",
              generation: 1,
              connectionRef: "apero-slack",
              evidenceScopeKey: "slack:apero-slack:channel:C1:lookback:30",
              pendingEvidenceScopeKey:
                "slack:apero-slack:channel:C2:lookback:30",
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("brainEvidenceSources")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              scopeKey: "slack:apero-slack:channel:C2:lookback:30",
              sourceKey: "pending-reviewed-source",
              title,
              status: "active",
              generation: 1,
              currentRevisionKey: "revision-1",
              sourceModifiedAt: now,
              observedAt: now,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("brainEvidenceRevisions")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              scopeKey: "slack:apero-slack:channel:C2:lookback:30",
              sourceKey: "pending-reviewed-source",
              revisionKey: "revision-1",
              title,
              markdown,
              contentHash,
              sourceModifiedAt: now,
              observedAt: now,
              tombstone: false,
              createdAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("claims")
            .insert({
              workspaceId: seeded.workspaceId,
              claimId: "claim-pending-scope",
              conceptIds: [],
              body: "The pending pilot price is $7,000 per month.",
              status: "supported",
              citationIds: ["citation-pending-scope"],
              propositionFingerprint: "sha256:pending-scope-claim",
              epistemics: "factual",
              verifiedAt: now,
              nextReviewAt: now + 86_400_000,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          const startOffset = markdown.indexOf(quote);
          yield* writer
            .table("citations")
            .insert({
              workspaceId: seeded.workspaceId,
              citationId: "citation-pending-scope",
              claimId: "claim-pending-scope",
              sourceId: "pending-reviewed-source",
              sourceKind: "slack_thread",
              sourceTitle: title,
              quotedText: quote,
              startOffset,
              endOffset: startOffset + quote.length,
              revisionKey: "revision-1",
              sourceKey: "pending-reviewed-source",
              contentHash,
              provider: "slack",
              createdAt: now,
            })
            .pipe(Effect.orDie);
        }),
      );
      yield* confect.mutation(refs.internal.ops.flags.upsertPolicyInternal, {
        workspaceId: seeded.workspaceId,
        key: "template.brain.contextV4",
        description: "Enable reviewed truth for pending-scope regression.",
        enabled: true,
        rolloutPercent: 100,
        audience: "workspace",
      });
      return yield* actor.query(
        refs.public.capabilities.askCompanyBrain.askCompanyBrain,
        {
          workspaceId: seeded.workspaceId,
          question: "What is the pending pilot price?",
          evidenceMode: "company_truth",
          asOf: now,
        },
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toMatchObject({
      status: "insufficient-context",
      contextPack: { claims: [], citations: [] },
    });
  });

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
