import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { Id } from "../confect/_generated/id";
import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  SeededTenancy,
  seedTenancy,
  seedWorkspaceForMember,
} from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

describe("grounded assistant Confect contract", () => {
  it("captures only explicit, exactly reopenable evaluation examples", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* actor.mutation(refs.public.brain.pages.createMarkdown, {
        workspaceId: seeded.workspaceId,
        slug: "evaluation-source",
        title: "Evaluation source",
        markdown: "The advisory offer launches on Friday.",
      });
      const question = "When does the advisory offer launch?";
      const answer = yield* actor.query(
        refs.public.agents.assistant.answerQuestion,
        { workspaceId: seeded.workspaceId, question },
      );
      const before = yield* confect.run(
        Effect.gen(function* () {
          const rows = yield* (yield* DatabaseReader)
            .table("brainEvaluationExamples")
            .index("by_workspace", (q) =>
              q.eq("workspaceId", seeded.workspaceId),
            )
            .take(10)
            .pipe(Effect.orDie);
          return JSON.stringify(rows);
        }),
        Schema.String,
      );
      const evidenceReferences = answer.contextPack.citations.map(
        ({ sourceId, revisionKey, contentHash }) => ({
          sourceKey: sourceId,
          revisionKey,
          contentHash,
        }),
      );
      const input = {
        workspaceId: seeded.workspaceId,
        exampleKey: "evaluation-example-1",
        question,
        purpose: "company-question",
        evidenceMode: "recent_evidence" as const,
        surface: "web" as const,
        answerStatus: answer.status,
        packHash: answer.contextPack.packHash,
        evidenceReferences,
        captureKind: "test" as const,
        usefulness: "unrated" as const,
      };
      const firstId = yield* actor.mutation(
        refs.public.agents.assistant.saveEvaluationExample,
        input,
      );
      const replayId = yield* actor.mutation(
        refs.public.agents.assistant.saveEvaluationExample,
        input,
      );
      const after = yield* confect.run(
        Effect.gen(function* () {
          const rows = yield* (yield* DatabaseReader)
            .table("brainEvaluationExamples")
            .index("by_workspace", (q) =>
              q.eq("workspaceId", seeded.workspaceId),
            )
            .take(10)
            .pipe(Effect.orDie);
          return JSON.stringify(rows);
        }),
        Schema.String,
      );
      return {
        after: JSON.parse(after) as Record<string, unknown>[],
        answer,
        before: JSON.parse(before) as Record<string, unknown>[],
        firstId,
        replayId,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.before).toEqual([]);
    expect(result.answer.contextPack.packHash).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(result.replayId).toBe(result.firstId);
    expect(result.after).toHaveLength(1);
    expect(result.after[0]).toMatchObject({
      exampleKey: "evaluation-example-1",
      question: "When does the advisory offer launch?",
      split: "development",
      evidenceReferences: [
        expect.objectContaining({
          sourceKey: expect.stringContaining("brain-page:"),
        }),
      ],
    });
    expect(JSON.stringify(result.after)).not.toContain(
      "The advisory offer launches on Friday.",
    );
  }, 15_000);

  it("rejects an evaluation example whose evidence cannot reopen", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      return yield* Effect.result(
        actor.mutation(refs.public.agents.assistant.saveEvaluationExample, {
          workspaceId: seeded.workspaceId,
          exampleKey: "fabricated-example",
          question: "What is the answer?",
          purpose: "company-question",
          evidenceMode: "recent_evidence",
          surface: "cli",
          answerStatus: "answered",
          packHash: `sha256:${"a".repeat(64)}`,
          evidenceReferences: [
            {
              sourceKey: "slack:missing",
              revisionKey: "missing",
              contentHash: "fabricated",
            },
          ],
          captureKind: "test",
          usefulness: "unrated",
        }),
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ValidationFailed", field: "evidenceReferences" },
    });
  });

  it("returns only exact current evidence from the authorized workspace", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const otherWorkspaceId = yield* confect.run(
        seedWorkspaceForMember({
          organizationId: seeded.organizationId,
          ownerUserId: seeded.memberUserId,
          name: "Other Workspace",
          slug: "other-workspace-grounding",
          now,
        }),
        Id("workspaces"),
      );
      const currentPageId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: seeded.workspaceId,
          slug: "acme-launch",
          title: "Acme launch plan",
          markdown: "Acme launches the customer portal on Friday.",
        },
      );
      yield* actor.mutation(refs.public.brain.pages.createMarkdown, {
        workspaceId: otherWorkspaceId,
        slug: "acme-secret",
        title: "Acme secret plan",
        markdown: "Acme launches the unreleased product on Monday.",
      });

      return yield* actor
        .query(refs.public.agents.assistant.answerQuestion, {
          workspaceId: seeded.workspaceId,
          question: "When does Acme launch the customer portal?",
        })
        .pipe(Effect.map((answer) => ({ answer, currentPageId })));
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.answer.status).toBe("answered");
    expect(result.answer.answerMarkdown).toContain("Friday");
    expect(result.answer.contextPack).toMatchObject({
      schemaVersion: "3",
      candidateManifest: { schemaVersion: "2" },
    });
    expect(result.answer.contextPack.citations).toEqual([
      expect.objectContaining({
        provider: "brain_page",
        sourceId: `brain-page:${result.currentPageId}`,
        excerpt: "Acme launches the customer portal on Friday.",
      }),
    ]);
    expect(result.answer.answerMarkdown).not.toContain("Monday");
  });

  it("keeps weak generic overlap in broad search but abstains in Ask", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const genericPageId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: seeded.workspaceId,
          slug: "source-guide",
          title: "Source Guide",
          markdown:
            "Use the source guide to reopen a source. This operational page contains no customer profile.",
        },
      );
      const repeatedPageId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: seeded.workspaceId,
          slug: "delivery-guide",
          title: "Delivery Guide",
          markdown: "Delivery delivery delivery. This is an unrelated guide.",
        },
      );

      const question = "Where is the authoritative source for our ICP?";
      const broad = yield* actor.query(refs.public.brain.evidence.search, {
        workspaceId: seeded.workspaceId,
        query: question,
        asOf: now,
        limit: 3,
      });
      const answer = yield* actor.query(
        refs.public.agents.assistant.answerQuestion,
        { workspaceId: seeded.workspaceId, question },
      );
      const repeatedQuestion = "What are our delivery workflow priorities?";
      const repeatedBroad = yield* actor.query(
        refs.public.brain.evidence.search,
        {
          workspaceId: seeded.workspaceId,
          query: repeatedQuestion,
          asOf: now,
          limit: 3,
        },
      );
      const repeatedAnswer = yield* actor.query(
        refs.public.agents.assistant.answerQuestion,
        { workspaceId: seeded.workspaceId, question: repeatedQuestion },
      );
      return {
        answer,
        broad,
        genericPageId,
        repeatedAnswer,
        repeatedBroad,
        repeatedPageId,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.broad).toContainEqual(
      expect.objectContaining({
        sourceKey: `brain-page:${result.genericPageId}`,
      }),
    );
    expect(result.answer).toMatchObject({
      status: "insufficient-context",
      reason: "no-eligible-evidence",
      answerMarkdown: null,
      contextPack: { citations: [] },
    });
    expect(result.repeatedBroad).toContainEqual(
      expect.objectContaining({
        sourceKey: `brain-page:${result.repeatedPageId}`,
      }),
    );
    expect(result.repeatedAnswer).toMatchObject({
      status: "insufficient-context",
      reason: "no-eligible-evidence",
      answerMarkdown: null,
      contextPack: { citations: [] },
    });
  });

  it("uses one meaningful token and ignores a title-weighted question word", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* confect.run(
        Effect.gen(function* () {
          yield* (yield* DatabaseWriter)
            .table("providerConnections")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              status: "active",
              generation: 1,
              connectionRef: "apero-slack",
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
        }),
      );
      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "run-single-token",
        startedAt: now,
      });
      yield* confect.mutation(refs.internal.brain.evidence.publishRunItem, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "run-single-token",
        sourceKey: "slack:icp-message",
        revisionKey: "revision-1",
        title: "Sales notes",
        markdown: "ICP",
        sourceModifiedAt: now,
        observedAt: now,
      });
      yield* confect.mutation(refs.internal.brain.evidence.publishRunItem, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "run-single-token",
        sourceKey: "slack:zeta-message",
        revisionKey: "revision-1",
        title: "Reference notes",
        markdown: "Zeta",
        sourceModifiedAt: now,
        observedAt: now,
      });
      yield* actor.mutation(refs.public.brain.pages.createMarkdown, {
        workspaceId: seeded.workspaceId,
        slug: "what-we-do",
        title: "What We Do",
        markdown: "A generic operational introduction.",
      });

      const question = "What is our ICP?";
      const broad = yield* actor.query(refs.public.brain.evidence.search, {
        workspaceId: seeded.workspaceId,
        query: question,
        asOf: now,
        limit: 3,
      });
      const answer = yield* actor.query(
        refs.public.agents.assistant.answerQuestion,
        { workspaceId: seeded.workspaceId, question },
      );
      const verboseAnswer = yield* actor.query(
        refs.public.agents.assistant.answerQuestion,
        {
          workspaceId: seeded.workspaceId,
          question:
            "Could you explain what current authoritative company context evidence sources show, and tell me where Zeta is used?",
        },
      );
      return { answer, broad, verboseAnswer };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.answer.status).toBe("answered");
    expect(result.answer.contextPack.citations).toEqual([
      expect.objectContaining({
        provider: "slack",
        sourceId: "slack:icp-message",
        excerpt: "ICP",
      }),
    ]);
    expect(result.broad.map(({ title }) => title)).toContain("What We Do");
    expect(result.verboseAnswer).toMatchObject({
      status: "answered",
      contextPack: {
        citations: [
          expect.objectContaining({
            sourceId: "slack:zeta-message",
            excerpt: "Zeta",
          }),
        ],
      },
    });
  });

  it("combines distinct terms across sources for a conjunctive question", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const icpId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: seeded.workspaceId,
          slug: "customer-profile",
          title: "Customer profile notes",
          markdown: "ICP",
        },
      );
      const pricingId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: seeded.workspaceId,
          slug: "commercial-notes",
          title: "Commercial notes",
          markdown: "pricing",
        },
      );

      return yield* actor
        .query(refs.public.agents.assistant.answerQuestion, {
          workspaceId: seeded.workspaceId,
          question: "What are our ICP and pricing?",
        })
        .pipe(Effect.map((answer) => ({ answer, icpId, pricingId })));
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    const sourceIds = result.answer.contextPack.citations.map(
      ({ sourceId }) => sourceId,
    );

    expect(result.answer.status).toBe("answered");
    expect(sourceIds).toEqual(
      expect.arrayContaining([
        `brain-page:${result.icpId}`,
        `brain-page:${result.pricingId}`,
      ]),
    );
    expect(sourceIds).toHaveLength(2);
  });
});
