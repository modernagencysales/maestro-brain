import { describe, expect, it } from "vitest";
import { evaluateBrainAnswers } from "./brain-answers";
import {
  approveBrainEvalArtifact,
  buildBrainEvalReport,
  checkFrozenBrainFixtures,
  loadFrozenBrainEvalFixture,
  sha256,
  wilsonLowerBound95,
} from "./brain-eval-report";

const frozenSuite = (suiteName: string): unknown =>
  (loadFrozenBrainEvalFixture() as Record<string, unknown>)[suiteName];

const suiteKey = (suiteName: string): string =>
  suiteName === "promptInjection" ? "promptInjection" : suiteName;

const rawArtifactFor = (suiteName: string): unknown => {
  const fixture = structuredClone(frozenSuite(suiteKey(suiteName)));
  return suiteName === "answers" ? answerRunFor(fixture) : fixture;
};

const recomputedReceiptFor = (suiteName: string, rawArtifact: unknown) => {
  if (suiteName === "answers") {
    const raw = rawArtifact as { fixture: unknown; run: unknown };
    return evaluateBrainAnswers(raw.fixture, raw.run).receipt;
  }
  const suite = buildBrainEvalReport().suites.find(
    (entry) => entry.suiteName === suiteName,
  );
  if (suite === undefined) throw new Error(`missing suite ${suiteName}`);
  return suite.receipt;
};

const answerRunFor = (fixture: unknown): unknown => {
  const suite = fixture as {
    cases: Array<{ id: string; kind: string; output: Record<string, unknown> }>;
  };
  const sourceArtifacts = suite.cases
    .filter((entry) => entry.kind === "claim")
    .map((entry) => {
      const bytes = `${entry.id} Verified source quote for ${entry.id}`;
      const hash = `sha256:${sha256(bytes)}`;
      entry.output.claimText = entry.id;
      entry.output.citedQuote = bytes;
      entry.output.citationLocator = `brain://page/rev#${entry.id}`;
      entry.output.sourceArtifactHash = hash;
      return { hash, bytes };
    });
  return {
    fixture: suite,
    run: {
      schemaVersion: "maestro-brain-answer-run/v1",
      sourceArtifacts,
      results: suite.cases.map((entry) => ({
        caseId: entry.id,
        output: entry.output,
      })),
    },
  };
};

describe("Brain eval report", () => {
  it("builds fixture reports without approving model promotion", () => {
    const report = buildBrainEvalReport();
    expect(report.passed).toBe(false);
    expect(report.approval).toBe("rejected-fixture-only");
    expect(report.fixtureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.suites.map((suite) => suite.suiteName)).toEqual([
      "classification",
      "answers",
      "maintenance",
      "promptInjection",
      "multilingual",
    ]);
    expect(() => approveBrainEvalArtifact(report)).toThrow(
      "Brain eval approval requires an external run artifact.",
    );
  });

  it("approves only raw external artifacts with recomputed passing receipts", () => {
    const report = buildBrainEvalReport();
    expect(() =>
      approveBrainEvalArtifact({
        schemaVersion: "maestro-brain-eval-approval-artifact/v1",
        runId: "external-run-2026-07-14",
        generatedAt: "2026-07-14T00:00:00.000Z",
        suiteResults: report.suites.map((suite) => {
          const rawArtifact = rawArtifactFor(suite.suiteName);
          return {
            ...suite,
            status: "approved",
            receipt: recomputedReceiptFor(suite.suiteName, rawArtifact),
            runArtifact: {
              schemaVersion: "maestro-brain-suite-run-artifact/v1",
              artifactUri: `s3://maestro-brain-evals/${suite.suiteName}.jsonl`,
              artifactHash: `sha256:${sha256(rawArtifact)}`,
              rawArtifact,
            },
          };
        }),
      }),
    ).toThrow(
      "Brain eval approval requires all external suite artifacts to pass.",
    );
  });

  it("rejects passing receipts that do not name immutable external run artifacts", () => {
    const report = buildBrainEvalReport();

    expect(() =>
      approveBrainEvalArtifact({
        schemaVersion: "maestro-brain-eval-approval-artifact/v1",
        runId: "external-run-2026-07-14",
        generatedAt: "2026-07-14T00:00:00.000Z",
        suiteResults: report.suites.map((suite) => ({
          ...suite,
          status: "approved",
          receipt: { ...suite.receipt, passed: true, failures: [] },
        })),
      }),
    ).toThrow("Brain eval approval requires immutable external run artifacts.");
  });

  it("rejects substituted raw artifacts and self-attested receipt flags", () => {
    const report = buildBrainEvalReport();
    expect(() =>
      approveBrainEvalArtifact({
        schemaVersion: "maestro-brain-eval-approval-artifact/v1",
        runId: "external-run-2026-07-14",
        generatedAt: "2026-07-14T00:00:00.000Z",
        suiteResults: report.suites.map((suite) => {
          const rawArtifact =
            suite.suiteName === "answers"
              ? rawArtifactFor("classification")
              : rawArtifactFor(suite.suiteName);
          return {
            ...suite,
            status: "approved",
            receipt: { ...suite.receipt, passed: true, failures: [] },
            runArtifact: {
              schemaVersion: "maestro-brain-suite-run-artifact/v1",
              artifactUri: `s3://maestro-brain-evals/${suite.suiteName}.jsonl`,
              artifactHash: `sha256:${sha256(rawArtifact)}`,
              rawArtifact,
            },
          };
        }),
      }),
    ).toThrow("Brain eval approval requires recomputed suite receipts.");
  });

  it("checks frozen fixture completeness and Appendix J denominators", () => {
    const receipt = checkFrozenBrainFixtures();
    expect(receipt.passed).toBe(true);
    expect(receipt.fixtureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.metrics.classificationDenominator?.passed).toBe(true);
    expect(receipt.metrics.classificationNoRouteDenominator?.passed).toBe(true);
    expect(receipt.metrics.classificationMixedClientDenominator?.passed).toBe(
      true,
    );
    expect(receipt.metrics.answerClaimDenominator?.passed).toBe(true);
    expect(receipt.metrics.answerNoEvidenceDenominator?.passed).toBe(true);
    expect(receipt.metrics.multilingualLanguageDenominator?.passed).toBe(true);
  });

  it("rejects incomplete fixture denominators during fixture check", async () => {
    const { checkBrainFixture } = await import("./brain-eval-report");
    const receipt = checkBrainFixture({
      suiteVersion: "bad",
      modelId: "fake",
      promptVersion: "bad",
      toolSchemaVersion: "bad",
      classification: { cases: [] },
      answers: { cases: [] },
      maintenance: { cases: [] },
      promptInjection: { cases: [] },
      multilingual: { cases: [] },
    });

    expect(receipt.passed).toBe(false);
    expect(receipt.failures.map((entry) => entry.caseId)).toEqual(
      expect.arrayContaining([
        "classification",
        "answers",
        "maintenance",
        "promptInjection",
        "multilingual",
      ]),
    );
  });

  it("uses the frozen two-sided 95% Wilson lower-bound algorithm", () => {
    expect(wilsonLowerBound95(500, 500)).toBeGreaterThan(0.99);
    expect(wilsonLowerBound95(90, 100)).toBeLessThan(0.9);
  });
});
