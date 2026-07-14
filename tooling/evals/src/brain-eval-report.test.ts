import { describe, expect, it } from "vitest";
import {
  buildBrainEvalReport,
  checkFrozenBrainFixtures,
  wilsonLowerBound95,
} from "./brain-eval-report";

describe("Brain eval report", () => {
  it("builds approved receipts with immutable fixture hashes", () => {
    const report = buildBrainEvalReport();
    expect(report.passed).toBe(true);
    expect(report.fixtureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.suites.map((suite) => suite.suiteName)).toEqual([
      "classification",
      "answers",
      "maintenance",
      "promptInjection",
      "multilingual",
    ]);
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
