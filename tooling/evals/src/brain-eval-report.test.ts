import { describe, expect, it } from "vitest";
import {
  approveBrainEvalArtifact,
  buildBrainEvalReport,
  checkFrozenBrainFixtures,
  wilsonLowerBound95,
} from "./brain-eval-report";

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

  it("approves only external run artifacts with passing suite receipts", () => {
    const report = buildBrainEvalReport();
    const approved = approveBrainEvalArtifact({
      schemaVersion: "maestro-brain-eval-approval-artifact/v1",
      runId: "external-run-2026-07-14",
      generatedAt: "2026-07-14T00:00:00.000Z",
      suiteResults: report.suites.map((suite) => ({
        ...suite,
        status: "approved",
        receipt: { ...suite.receipt, passed: true, failures: [] },
        runArtifact: {
          schemaVersion: "maestro-brain-suite-run-artifact/v1",
          artifactUri: `s3://maestro-brain-evals/${suite.suiteName}.jsonl`,
          artifactHash:
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      })),
    });

    expect(approved.runId).toBe("external-run-2026-07-14");
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
