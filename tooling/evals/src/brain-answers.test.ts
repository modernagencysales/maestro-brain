import { describe, expect, it } from "vitest";
import { evaluateBrainAnswers } from "./brain-answers";
import { assertRecord, loadFrozenBrainEvalFixture } from "./brain-eval-report";

const fixture = () =>
  assertRecord(loadFrozenBrainEvalFixture(), "fixture").answers;

describe("Brain answers eval", () => {
  it("does not approve fixture answer booleans without claim/citation/source artifacts", () => {
    const result = evaluateBrainAnswers(fixture());
    expect(result.receipt.passed).toBe(false);
    expect(result.receipt.totals.testCases).toBe(400);
    expect(result.receipt.metrics.entailment?.passed).toBe(false);
  });

  it("scores answer claims from artifact fields instead of trusting booleans", () => {
    const result = evaluateBrainAnswers({
      suiteVersion: "artifact-v1",
      modelId: "candidate",
      promptVersion: "prompt",
      toolSchemaVersion: "tool",
      cases: [
        {
          id: "claim-a",
          split: "test",
          labels: {
            reviewerA: "entailed",
            reviewerB: "entailed",
            adjudicated: "entailed",
          },
          kind: "claim",
          output: {
            claimEntailed: false,
            citationLocatorResolved: true,
            redactionMarker: false,
            abstained: false,
            inventedSource: false,
            claimText: "Agency key is stable",
            citedQuote: "Agency key is stable across exports",
            citationLocator: "brain://page/rev#L1",
            sourceArtifactHash:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
        {
          id: "abstain-a",
          split: "test",
          labels: {
            reviewerA: "abstain",
            reviewerB: "abstain",
            adjudicated: "abstain",
          },
          kind: "no-evidence",
          output: {
            claimEntailed: false,
            citationLocatorResolved: false,
            redactionMarker: true,
            abstained: true,
            inventedSource: false,
          },
        },
      ],
    });

    expect(result.receipt.metrics.entailment?.numerator).toBe(1);
    expect(result.receipt.failures).toEqual([]);
  });

  it("fails unsupported claims, bad citations, and no-evidence invention", () => {
    const result = evaluateBrainAnswers({
      suiteVersion: "bad",
      modelId: "fake",
      promptVersion: "bad",
      toolSchemaVersion: "bad",
      cases: [
        {
          id: "bad-claim",
          split: "test",
          labels: {
            reviewerA: "entailed",
            reviewerB: "entailed",
            adjudicated: "entailed",
          },
          kind: "claim",
          output: {
            claimEntailed: false,
            citationLocatorResolved: false,
            redactionMarker: false,
            abstained: false,
            inventedSource: false,
          },
        },
        {
          id: "bad-no-evidence",
          split: "test",
          labels: {
            reviewerA: "abstain",
            reviewerB: "abstain",
            adjudicated: "abstain",
          },
          kind: "no-evidence",
          output: {
            claimEntailed: false,
            citationLocatorResolved: false,
            redactionMarker: true,
            abstained: false,
            inventedSource: true,
          },
        },
      ],
    });
    expect(result.receipt.passed).toBe(false);
    expect(result.receipt.failures.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        "Answer claim must be entailed by cited exact revision.",
        "Answer citation locator must resolve or return explicit redaction.",
        "No-evidence answer must abstain without invented sources.",
      ]),
    );
  });
  it("rejects run results when every answer prediction is wrong", () => {
    const result = evaluateBrainAnswers(
      {
        suiteVersion: "run-v1",
        modelId: "candidate",
        promptVersion: "prompt",
        toolSchemaVersion: "tool",
        cases: [
          {
            id: "claim-a",
            split: "test",
            labels: {
              reviewerA: "entailed",
              reviewerB: "entailed",
              adjudicated: "entailed",
            },
            kind: "claim",
            output: {
              claimEntailed: true,
              citationLocatorResolved: true,
              redactionMarker: false,
              abstained: false,
              inventedSource: false,
            },
          },
          {
            id: "abstain-a",
            split: "test",
            labels: {
              reviewerA: "abstain",
              reviewerB: "abstain",
              adjudicated: "abstain",
            },
            kind: "no-evidence",
            output: {
              claimEntailed: false,
              citationLocatorResolved: false,
              redactionMarker: true,
              abstained: true,
              inventedSource: false,
            },
          },
        ],
      },
      {
        schemaVersion: "maestro-brain-answer-run/v1",
        results: [
          {
            caseId: "claim-a",
            output: {
              claimEntailed: false,
              citationLocatorResolved: false,
              redactionMarker: false,
              abstained: false,
              inventedSource: true,
            },
          },
          {
            caseId: "abstain-a",
            output: {
              claimEntailed: false,
              citationLocatorResolved: false,
              redactionMarker: false,
              abstained: false,
              inventedSource: true,
            },
          },
        ],
      },
    );

    expect(result.receipt.passed).toBe(false);
    expect(result.receipt.metrics.entailment?.numerator).toBe(0);
    expect(result.receipt.metrics.noEvidenceAbstention?.numerator).toBe(0);
  });
});
