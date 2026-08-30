import { TestConfect } from "@confect/test";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { MAX_EVALUATION_EXAMPLES } from "../confect/capabilities/manageBrainEvaluationExamples.domain";
import { evidenceContentHash } from "../confect/brain/evidenceProjection";
import { seedTenancy, SeededTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_788_000_000_000;

const insertExample = (
  workspaceId: GenericId<"workspaces">,
  actorUserId: GenericId<"users">,
  index: number,
) =>
  Effect.gen(function* () {
    const beforeCutoff = index < 20;
    return yield* (yield* DatabaseWriter)
      .table("brainEvaluationExamples")
      .insert({
        workspaceId,
        exampleKey: `freeze-${String(index).padStart(2, "0")}`,
        question: `Synthetic question ${index}`,
        purpose: "company-question",
        evidenceMode: "mixed",
        surface: "cli",
        answerStatus: beforeCutoff ? "answered" : "insufficient-context",
        packHash: `sha256:${index.toString(16).padStart(64, "0")}`,
        evidenceReferences: [],
        captureKind: "test",
        usefulness: "unrated",
        adjudicationState: "adjudicated",
        expectedAnswerStatus: "insufficient-context",
        expectedEvidenceReferences: [],
        riskLevel: "ordinary",
        adjudicatedAt: now + index,
        adjudicatedByUserId: actorUserId,
        split: "development",
        actorUserId,
        createdAt: beforeCutoff ? now + index : now + 100 + index,
        updatedAt: now + index,
      })
      .pipe(Effect.orDie);
  });

const insertPendingExample = (
  workspaceId: GenericId<"workspaces">,
  actorUserId: GenericId<"users">,
  exampleKey: string,
  createdAt: number,
) =>
  Effect.gen(function* () {
    return yield* (yield* DatabaseWriter)
      .table("brainEvaluationExamples")
      .insert({
        workspaceId,
        exampleKey,
        question: `Question for ${exampleKey}`,
        purpose: "company-question",
        evidenceMode: "company_truth",
        surface: "cli",
        answerStatus: "insufficient-context",
        packHash: `sha256:${"a".repeat(64)}`,
        evidenceReferences: [],
        captureKind: "test",
        usefulness: "unrated",
        adjudicationState: "pending",
        expectedEvidenceReferences: [],
        split: "development",
        actorUserId,
        createdAt,
        updatedAt: createdAt,
      })
      .pipe(Effect.orDie);
  });

const saveInput = (
  workspaceId: GenericId<"workspaces">,
  exampleKey: string,
) => ({
  workspaceId,
  exampleKey,
  question: `Question for ${exampleKey}`,
  purpose: "company-question",
  evidenceMode: "company_truth" as const,
  surface: "cli" as const,
  answerStatus: "insufficient-context" as const,
  packHash: `sha256:${"a".repeat(64)}`,
  evidenceReferences: [],
  captureKind: "test" as const,
  usefulness: "unrated" as const,
});

describe("Brain evaluation management contract", () => {
  it("paginates stably and freezes five deterministic examples idempotently", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      for (let index = 0; index < 25; index += 1)
        yield* confect.run(
          insertExample(seeded.workspaceId, seeded.memberUserId, index),
        );
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const first = yield* actor.query(
        refs.public.capabilities.manageBrainEvaluationExamples
          .listBrainEvaluationExamples,
        { workspaceId: seeded.workspaceId, limit: 3 },
      );
      const second = yield* actor.query(
        refs.public.capabilities.manageBrainEvaluationExamples
          .listBrainEvaluationExamples,
        {
          workspaceId: seeded.workspaceId,
          limit: 3,
          cursorCreatedAt: first.nextCursorCreatedAt,
          cursorExampleKey: first.nextCursorExampleKey,
        },
      );
      const adjudicationInput = {
        workspaceId: seeded.workspaceId,
        exampleKey: "freeze-00",
        expectedUpdatedAt: now,
        expectedAnswerStatus: "insufficient-context" as const,
        expectedEvidenceReferences: [],
        riskLevel: "high" as const,
      };
      const adjudicated = yield* actor.mutation(
        refs.public.capabilities.manageBrainEvaluationExamples
          .adjudicateBrainEvaluationExample,
        adjudicationInput,
      );
      const adjudicationReplay = yield* actor.mutation(
        refs.public.capabilities.manageBrainEvaluationExamples
          .adjudicateBrainEvaluationExample,
        adjudicationInput,
      );
      const previewBeforeGoldChange = yield* actor.query(
        refs.public.capabilities.manageBrainEvaluationExamples
          .previewBrainEvaluationFreeze,
        { workspaceId: seeded.workspaceId, cutoffCreatedAt: now + 100 },
      );
      yield* actor.mutation(
        refs.public.capabilities.manageBrainEvaluationExamples
          .adjudicateBrainEvaluationExample,
        {
          workspaceId: seeded.workspaceId,
          exampleKey: "freeze-20",
          expectedUpdatedAt: now + 20,
          expectedAnswerStatus: "insufficient-context",
          expectedEvidenceReferences: [],
          riskLevel: "high",
        },
      );
      const preview = yield* actor.query(
        refs.public.capabilities.manageBrainEvaluationExamples
          .previewBrainEvaluationFreeze,
        { workspaceId: seeded.workspaceId, cutoffCreatedAt: now + 100 },
      );
      const staleApply = yield* Effect.result(
        actor.mutation(
          refs.public.capabilities.manageBrainEvaluationExamples
            .applyBrainEvaluationFreeze,
          {
            workspaceId: seeded.workspaceId,
            cutoffCreatedAt: now + 100,
            expectedPreviewHash: previewBeforeGoldChange.previewHash,
            freezeKey: "stale-pilot-holdout",
          },
        ),
      );
      const input = {
        workspaceId: seeded.workspaceId,
        cutoffCreatedAt: now + 100,
        expectedPreviewHash: preview.previewHash,
        freezeKey: "pilot-holdout-1",
      };
      const applied = yield* actor.mutation(
        refs.public.capabilities.manageBrainEvaluationExamples
          .applyBrainEvaluationFreeze,
        input,
      );
      const replay = yield* actor.mutation(
        refs.public.capabilities.manageBrainEvaluationExamples
          .applyBrainEvaluationFreeze,
        input,
      );
      yield* confect.run(
        Effect.gen(function* () {
          yield* (yield* DatabaseWriter)
            .table("workspaceMembers")
            .insert({
              workspaceId: seeded.workspaceId,
              userId: seeded.outsiderUserId,
              role: "viewer",
              status: "active",
              acceptedAt: now,
              revokedAt: null,
              deletedAt: null,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
        }),
      );
      const viewer = confect.withIdentity({
        subject: "outsider-subject",
        email: "outsider@example.com",
      });
      const exported = yield* viewer.query(
        refs.public.capabilities.manageBrainEvaluationExamples
          .exportBrainEvaluationExamples,
        { workspaceId: seeded.workspaceId, split: "holdout" },
      );
      const hidden = yield* actor.query(
        refs.public.capabilities.manageBrainEvaluationExamples
          .getBrainEvaluationExample,
        {
          workspaceId: seeded.workspaceId,
          exampleKey: applied.selectedExampleKeys[0] ?? "",
        },
      );
      const revealed = yield* actor.query(
        refs.public.capabilities.manageBrainEvaluationExamples
          .getBrainEvaluationExample,
        {
          workspaceId: seeded.workspaceId,
          exampleKey: applied.selectedExampleKeys[0] ?? "",
          includeHoldoutGold: true,
        },
      );
      const frozenKey = applied.selectedExampleKeys[0] ?? "";
      const saveReplayId = yield* actor.mutation(
        refs.public.agents.assistant.saveEvaluationExample,
        {
          workspaceId: seeded.workspaceId,
          exampleKey: frozenKey,
          question: "Synthetic question 20",
          purpose: "company-question",
          evidenceMode: "mixed",
          surface: "cli",
          answerStatus: "insufficient-context",
          packHash: `sha256:${(20).toString(16).padStart(64, "0")}`,
          evidenceReferences: [],
          captureKind: "test",
          usefulness: "unrated",
        },
      );
      return {
        adjudicated,
        adjudicationReplay,
        applied,
        first,
        hidden,
        preview,
        previewBeforeGoldChange,
        replay,
        revealed,
        saveReplayId,
        second,
        staleApply,
        exported,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.first.examples.map(({ exampleKey }) => exampleKey)).toEqual([
      "freeze-00",
      "freeze-01",
      "freeze-02",
    ]);
    expect(result.second.examples[0]?.exampleKey).toBe("freeze-03");
    expect(result.adjudicationReplay).toEqual(result.adjudicated);
    expect(result.preview).toMatchObject({
      maturity: "ready",
      adjudicatedCount: 25,
      selectedExampleKeys: [
        "freeze-20",
        "freeze-21",
        "freeze-22",
        "freeze-23",
        "freeze-24",
      ],
    });
    expect(result.preview.previewHash).not.toBe(
      result.previewBeforeGoldChange.previewHash,
    );
    expect(result.staleApply).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "ValidationFailed",
        field: "expectedPreviewHash",
      },
    });
    expect(result.replay).toEqual(result.applied);
    expect(result.hidden.expectedEvidenceReferences).toEqual([]);
    expect(result.hidden.expectedAnswerStatus).toBeUndefined();
    expect(result.revealed.expectedEvidenceReferences).toEqual([]);
    expect(result.revealed.expectedAnswerStatus).toBe("insufficient-context");
    expect(result.revealed.riskLevel).toBe("high");
    expect(result.saveReplayId).toBe(result.revealed.evaluationExampleId);
    const exportedGold = result.exported.rows.find(
      ({ exampleKey }) => exampleKey === "freeze-21",
    );
    expect(exportedGold?.expectedEvidenceReferences).toEqual([]);
    expect(exportedGold?.expectedAnswerStatus).toBeUndefined();
    expect(exportedGold?.riskLevel).toBeUndefined();
  });

  it("uses locale ordering consistently across mixed-case cursors", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      for (const exampleKey of ["cursor-a", "cursor-B", "cursor-b"])
        yield* confect.run(
          insertPendingExample(
            seeded.workspaceId,
            seeded.memberUserId,
            exampleKey,
            now,
          ),
        );
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const keys: string[] = [];
      let cursorCreatedAt: number | undefined;
      let cursorExampleKey: string | undefined;
      for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
        const page = yield* actor.query(
          refs.public.capabilities.manageBrainEvaluationExamples
            .listBrainEvaluationExamples,
          {
            workspaceId: seeded.workspaceId,
            limit: 1,
            ...(cursorCreatedAt === undefined
              ? {}
              : { cursorCreatedAt, cursorExampleKey }),
          },
        );
        keys.push(...page.examples.map(({ exampleKey }) => exampleKey));
        cursorCreatedAt = page.nextCursorCreatedAt;
        cursorExampleKey = page.nextCursorExampleKey;
      }
      return keys;
    });

    expect(
      await Effect.runPromise(program.pipe(Effect.provide(testConfectLayer()))),
    ).toEqual(["cursor-a", "cursor-b", "cursor-B"]);
  });

  it("rejects inaccessible or integrity-invalid evidence during adjudication", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(
        Effect.gen(function* () {
          yield* insertPendingExample(
            seeded.workspaceId,
            seeded.memberUserId,
            "revoked-scope",
            now,
          );
          yield* insertPendingExample(
            seeded.workspaceId,
            seeded.memberUserId,
            "corrupt-content",
            now + 1,
          );
          const writer = yield* DatabaseWriter;
          yield* writer
            .table("brainEvidenceSources")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              scopeKey: "slack:revoked",
              sourceKey: "slack:revoked:message:1",
              title: "Slack message",
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
              scopeKey: "slack:revoked",
              sourceKey: "slack:revoked:message:1",
              revisionKey: "revision-1",
              title: "Slack message",
              markdown: "Revoked provider content",
              contentHash: "hash-revoked",
              sourceModifiedAt: now,
              observedAt: now,
              tombstone: false,
              createdAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("brainEvidenceSources")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "brain_page",
              scopeKey: "brain-pages",
              sourceKey: "brain-page:corrupt",
              title: "Corrupt page",
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
              provider: "brain_page",
              scopeKey: "brain-pages",
              sourceKey: "brain-page:corrupt",
              revisionKey: "revision-1",
              title: "Corrupt page",
              markdown: "Stored content does not match its claimed hash.",
              contentHash: "claimed-hash",
              sourceModifiedAt: now,
              observedAt: now,
              tombstone: false,
              createdAt: now,
            })
            .pipe(Effect.orDie);
        }),
      );
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const inaccessible = yield* Effect.result(
        actor.mutation(
          refs.public.capabilities.manageBrainEvaluationExamples
            .adjudicateBrainEvaluationExample,
          {
            workspaceId: seeded.workspaceId,
            exampleKey: "revoked-scope",
            expectedUpdatedAt: now,
            expectedAnswerStatus: "answered",
            expectedEvidenceReferences: [
              {
                sourceKey: "slack:revoked:message:1",
                revisionKey: "revision-1",
                contentHash: "hash-revoked",
              },
            ],
            riskLevel: "ordinary",
          },
        ),
      );
      const corrupt = yield* Effect.result(
        actor.mutation(
          refs.public.capabilities.manageBrainEvaluationExamples
            .adjudicateBrainEvaluationExample,
          {
            workspaceId: seeded.workspaceId,
            exampleKey: "corrupt-content",
            expectedUpdatedAt: now + 1,
            expectedAnswerStatus: "answered",
            expectedEvidenceReferences: [
              {
                sourceKey: "brain-page:corrupt",
                revisionKey: "revision-1",
                contentHash: "claimed-hash",
              },
            ],
            riskLevel: "ordinary",
          },
        ),
      );
      return { corrupt, inaccessible };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    for (const failure of [result.inaccessible, result.corrupt])
      expect(failure).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "ValidationFailed",
          field: "expectedEvidenceReferences",
        },
      });
  });

  it("revalidates cited gold atomically when applying a freeze", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      for (let index = 0; index < 25; index += 1)
        yield* confect.run(
          insertExample(seeded.workspaceId, seeded.memberUserId, index),
        );
      const sourceKey = "brain-page:freeze-evidence";
      const revisionKey = "revision-1";
      const title = "Freeze evidence";
      const markdown = "The approved pilot price is $5,000.";
      const contentHash = evidenceContentHash(title, markdown);
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          yield* writer
            .table("brainEvidenceSources")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "brain_page",
              scopeKey: "brain-pages",
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
              provider: "brain_page",
              scopeKey: "brain-pages",
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
          const examples = yield* (yield* DatabaseReader)
            .table("brainEvaluationExamples")
            .index("by_workspace_and_example_key", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("exampleKey", "freeze-20"),
            )
            .take(2)
            .pipe(Effect.orDie);
          const example = examples[0];
          if (example === undefined)
            return yield* Effect.die("missing example");
          yield* writer
            .table("brainEvaluationExamples")
            .patch(example._id, {
              expectedAnswerStatus: "answered",
              expectedEvidenceReferences: [
                { sourceKey, revisionKey, contentHash },
              ],
              updatedAt: now + 200,
            })
            .pipe(Effect.orDie);
        }),
      );
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const preview = yield* actor.query(
        refs.public.capabilities.manageBrainEvaluationExamples
          .previewBrainEvaluationFreeze,
        { workspaceId: seeded.workspaceId, cutoffCreatedAt: now + 100 },
      );
      yield* confect.run(
        Effect.gen(function* () {
          const sources = yield* (yield* DatabaseReader)
            .table("brainEvidenceSources")
            .index("by_workspace_and_source_key", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("sourceKey", sourceKey),
            )
            .take(2)
            .pipe(Effect.orDie);
          const source = sources[0];
          if (source === undefined) return yield* Effect.die("missing source");
          yield* (yield* DatabaseWriter)
            .table("brainEvidenceSources")
            .patch(source._id, { status: "removed", updatedAt: now + 300 })
            .pipe(Effect.orDie);
        }),
      );
      const applied = yield* Effect.result(
        actor.mutation(
          refs.public.capabilities.manageBrainEvaluationExamples
            .applyBrainEvaluationFreeze,
          {
            workspaceId: seeded.workspaceId,
            cutoffCreatedAt: now + 100,
            expectedPreviewHash: preview.previewHash,
            freezeKey: "withdrawn-freeze",
          },
        ),
      );
      const holdoutCount = yield* confect.run(
        Effect.gen(function* () {
          const examples = yield* (yield* DatabaseReader)
            .table("brainEvaluationExamples")
            .index("by_workspace", (q) =>
              q.eq("workspaceId", seeded.workspaceId),
            )
            .take(30)
            .pipe(Effect.orDie);
          return examples.filter(({ split }) => split === "holdout").length;
        }),
        Schema.Number,
      );
      return { applied, holdoutCount, preview };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.preview).toMatchObject({
      maturity: "ready",
      selectedExampleKeys: expect.arrayContaining(["freeze-20"]),
    });
    expect(result.applied).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "ValidationFailed",
        field: "expectedEvidenceReferences",
      },
    });
    expect(result.holdoutCount).toBe(0);
  });

  it("admits the 500th distinct save, rejects the 501st, and replays at capacity", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(
        Effect.gen(function* () {
          for (let index = 0; index < MAX_EVALUATION_EXAMPLES - 1; index += 1)
            yield* insertPendingExample(
              seeded.workspaceId,
              seeded.memberUserId,
              `capacity-${index}`,
              now + index,
            );
        }),
      );
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const finalInput = saveInput(
        seeded.workspaceId,
        `capacity-${MAX_EVALUATION_EXAMPLES - 1}`,
      );
      const finalId = yield* actor.mutation(
        refs.public.agents.assistant.saveEvaluationExample,
        finalInput,
      );
      const overflow = yield* Effect.result(
        actor.mutation(
          refs.public.agents.assistant.saveEvaluationExample,
          saveInput(seeded.workspaceId, "capacity-overflow"),
        ),
      );
      const replayId = yield* actor.mutation(
        refs.public.agents.assistant.saveEvaluationExample,
        finalInput,
      );
      const management = yield* actor.query(
        refs.public.capabilities.manageBrainEvaluationExamples
          .listBrainEvaluationExamples,
        { workspaceId: seeded.workspaceId, limit: 1 },
      );
      return { finalId, management, overflow, replayId };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.replayId).toBe(result.finalId);
    expect(result.overflow).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ValidationFailed", field: "workspaceId" },
    });
    expect(result.management.examples).toHaveLength(1);
  }, 20_000);
});
