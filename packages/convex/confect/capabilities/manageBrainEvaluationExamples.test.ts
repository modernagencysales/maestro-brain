import { describe, expect, it } from "vitest";
import {
  buildRedactedEvaluationExport,
  selectEvaluationHoldout,
  type FreezeExample,
} from "./manageBrainEvaluationExamples.domain";

const example = (
  index: number,
  overrides: Partial<FreezeExample> = {},
): FreezeExample => ({
  exampleKey: `example-${String(index).padStart(2, "0")}`,
  createdAt: index,
  updatedAt: index,
  split: "development",
  captureKind: "test",
  adjudicationState: "adjudicated",
  expectedAnswerStatus: "answered",
  expectedEvidenceReferences: [
    {
      sourceKey: `source-${index}`,
      revisionKey: "revision-1",
      contentHash: `hash-${index}`,
    },
  ],
  riskLevel: "ordinary",
  ...overrides,
});

describe("Brain evaluation management domain", () => {
  it("selects five deterministic time- and source-separated holdout examples", () => {
    const examples = Array.from({ length: 25 }, (_, index) => example(index));
    examples[20] = example(20, {
      expectedEvidenceReferences: [
        {
          sourceKey: "source-1",
          revisionKey: "new-revision",
          contentHash: "new-hash",
        },
      ],
    });
    examples.push(example(25));

    const selected = selectEvaluationHoldout(examples, 20);

    expect(selected).toMatchObject({
      maturity: "ready",
      adjudicatedCount: 26,
      excludedForSourceOverlap: 1,
      selectedExampleKeys: [
        "example-21",
        "example-22",
        "example-23",
        "example-24",
        "example-25",
      ],
    });
    expect(selected.previewHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(selectEvaluationHoldout([...examples].reverse(), 20)).toEqual(
      selected,
    );
  });

  it("reports insufficient-sample without fabricating a holdout", () => {
    const result = selectEvaluationHoldout(
      Array.from({ length: 24 }, (_, index) => example(index)),
      19,
    );
    expect(result.maturity).toBe("insufficient-sample");
    expect(result.adjudicatedCount).toBe(24);
  });

  it("binds selected adjudicated gold and row state into the preview hash", () => {
    const examples = Array.from({ length: 25 }, (_, index) => example(index));
    const first = selectEvaluationHoldout(examples, 20);
    const changed = examples.map((candidate) =>
      candidate.exampleKey === "example-20"
        ? {
            ...candidate,
            expectedAnswerStatus: "insufficient-context" as const,
            expectedEvidenceReferences: [],
            riskLevel: "high" as const,
            updatedAt: candidate.updatedAt + 1,
          }
        : candidate,
    );

    expect(selectEvaluationHoldout(changed, 20).selectedExampleKeys).toEqual(
      first.selectedExampleKeys,
    );
    expect(selectEvaluationHoldout(changed, 20).previewHash).not.toBe(
      first.previewHash,
    );
  });

  it("builds a stable redacted export without questions or excerpts", () => {
    const input = [
      {
        exampleKey: "example-1",
        question: "What is our private launch date?",
        purpose: "company-question",
        evidenceMode: "mixed" as const,
        surface: "cli" as const,
        answerStatus: "answered" as const,
        packHash: `sha256:${"a".repeat(64)}`,
        maxCitations: 5,
        capturedAsOf: 123,
        policyVersion: "brain-context-v2",
        evidenceReferences: [
          {
            sourceKey: "source-1",
            revisionKey: "revision-1",
            contentHash: "hash-1",
          },
        ],
        captureKind: "test" as const,
        usefulness: "unrated" as const,
        adjudicationState: "adjudicated" as const,
        expectedAnswerStatus: "answered" as const,
        expectedEvidenceReferences: [],
        riskLevel: "ordinary" as const,
        split: "development" as const,
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const first = buildRedactedEvaluationExport(input);
    const replay = buildRedactedEvaluationExport(input);
    expect(replay).toEqual(first);
    expect(first.exportHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(first)).not.toContain("private launch date");
    expect(JSON.stringify(first)).not.toContain("excerpt");
    expect(first.rows[0]).toMatchObject({
      maxCitations: 5,
      capturedAsOf: 123,
      policyVersion: "brain-context-v2",
    });
  });

  it("removes frozen holdout gold from redacted exports", () => {
    const exported = buildRedactedEvaluationExport([
      {
        exampleKey: "holdout-1",
        question: "Secret holdout question",
        purpose: "company-question",
        evidenceMode: "mixed",
        surface: "cli",
        answerStatus: "answered",
        packHash: `sha256:${"a".repeat(64)}`,
        evidenceReferences: [],
        captureKind: "test",
        usefulness: "unrated",
        adjudicationState: "adjudicated",
        expectedAnswerStatus: "answered",
        expectedEvidenceReferences: [
          {
            sourceKey: "secret-source",
            revisionKey: "secret-revision",
            contentHash: "secret-hash",
          },
        ],
        riskLevel: "high",
        split: "holdout",
        freezeKey: "freeze-1",
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    expect(exported.rows[0]?.expectedEvidenceReferences).toEqual([]);
    expect(exported.rows[0]?.expectedAnswerStatus).toBeUndefined();
    expect(exported.rows[0]?.riskLevel).toBeUndefined();
    expect(JSON.stringify(exported)).not.toContain("secret-source");
  });
});
