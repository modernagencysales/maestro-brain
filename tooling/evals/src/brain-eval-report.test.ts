import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateBrainAnswers } from "./brain-answers";
import { evaluateBrainClassification } from "./brain-classification";
import { evaluateBrainMaintenance } from "./brain-maintenance";
import { evaluateBrainMultilingual } from "./brain-multilingual";
import { evaluateBrainPromptInjection } from "./brain-prompt-injection";
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
  return {
    fixture,
    run:
      suiteName === "answers"
        ? answerRunFor(fixture)
        : suiteName === "classification"
          ? classificationRunFor(fixture)
          : genericRunFor(fixture),
  };
};

const recomputedReceiptFor = (suiteName: string, rawArtifact: unknown) => {
  const raw = rawArtifact as { fixture: unknown; run: unknown };
  if (suiteName === "answers") {
    return evaluateBrainAnswers(raw.fixture, raw.run).receipt;
  }
  if (suiteName === "classification") {
    return evaluateBrainClassification(raw.fixture, raw.run).receipt;
  }
  if (suiteName === "maintenance") {
    return evaluateBrainMaintenance(raw.fixture, raw.run).receipt;
  }
  if (suiteName === "promptInjection") {
    return evaluateBrainPromptInjection(raw.fixture, raw.run).receipt;
  }
  if (suiteName === "multilingual") {
    return evaluateBrainMultilingual(raw.fixture, raw.run).receipt;
  }
  throw new Error(`missing suite ${suiteName}`);
};

const classificationRunFor = (fixture: unknown): unknown => {
  const suite = fixture as {
    cases: Array<{
      id: string;
      outputTargets: readonly string[];
      committedTarget: string | null;
    }>;
  };
  return {
    schemaVersion: "maestro-brain-classification-run/v1",
    results: suite.cases.map((entry) => ({
      caseId: entry.id,
      outputTargets: entry.outputTargets,
      committedTarget: entry.committedTarget,
    })),
  };
};

const genericRunFor = (fixture: unknown): unknown => {
  const suite = fixture as { cases: Array<{ id: string; output: unknown }> };
  return {
    schemaVersion: "maestro-brain-suite-run/v1",
    results: suite.cases.map((entry) => ({
      caseId: entry.id,
      output: entry.output,
    })),
  };
};

const badOutputFor = (suiteName: string): Record<string, boolean> => {
  if (suiteName === "maintenance") {
    return {
      factualChangeCited: false,
      acceptedWithoutFactualCorrection: true,
      staleOrRevokedPublish: false,
    };
  }
  if (suiteName === "promptInjection") {
    return {
      tenantInvariant: false,
      allowlistInvariant: true,
      instructionInvariant: true,
      toolInvariant: true,
      deliveryInvariant: true,
    };
  }
  return {
    semanticMatch: true,
    abstainedWhenNoEvidence: true,
    authorizationInvariant: false,
    keywordOnlyBypass: false,
  };
};

const rawSha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const answerRunFor = (fixture: unknown): unknown => {
  const suite = fixture as {
    cases: Array<{ id: string; kind: string; output: Record<string, unknown> }>;
  };
  const sourceArtifacts = suite.cases
    .filter((entry) => entry.kind === "claim")
    .map((entry) => {
      const bytes = `${entry.id} Verified source quote for ${entry.id}`;
      const hash = rawSha256(bytes);
      return { hash, bytes };
    });
  return {
    schemaVersion: "maestro-brain-answer-run/v1",
    sourceArtifacts,
    results: suite.cases.map((entry) => ({
      caseId: entry.id,
      output:
        entry.kind === "claim"
          ? {
              ...entry.output,
              claimEntailed: true,
              citationLocatorResolved: true,
              claimText: entry.id,
              citedQuote: `${entry.id} Verified source quote for ${entry.id}`,
              citationLocator: `brain://page/rev#${entry.id}`,
              sourceArtifactHash: rawSha256(
                `${entry.id} Verified source quote for ${entry.id}`,
              ),
            }
          : entry.output,
    })),
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

  it("approves a real all-suite external run with recomputed passing receipts", () => {
    const report = buildBrainEvalReport();
    const approval = approveBrainEvalArtifact({
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
    });

    expect(approval.suiteResults).toHaveLength(5);
    expect(approval.suiteResults.map((suite) => suite.suiteName)).toEqual([
      "classification",
      "answers",
      "maintenance",
      "promptInjection",
      "multilingual",
    ]);
    expect(approval.suiteResults.every((suite) => suite.receipt.passed)).toBe(
      true,
    );
  });

  it("rejects bad external maintenance, prompt-injection, and multilingual runs", () => {
    const report = buildBrainEvalReport();
    for (const badSuiteName of [
      "maintenance",
      "promptInjection",
      "multilingual",
    ]) {
      expect(() =>
        approveBrainEvalArtifact({
          schemaVersion: "maestro-brain-eval-approval-artifact/v1",
          runId: `external-run-bad-${badSuiteName}`,
          generatedAt: "2026-07-14T00:00:00.000Z",
          suiteResults: report.suites.map((suite) => {
            const rawArtifact = rawArtifactFor(suite.suiteName) as {
              fixture: unknown;
              run: { results: Array<{ caseId: string; output: unknown }> };
            };
            const effectiveArtifact =
              suite.suiteName === badSuiteName
                ? {
                    ...rawArtifact,
                    run: {
                      ...rawArtifact.run,
                      results: rawArtifact.run.results.map((result, index) =>
                        index === 0
                          ? { ...result, output: badOutputFor(badSuiteName) }
                          : result,
                      ),
                    },
                  }
                : rawArtifact;
            return {
              ...suite,
              status: "approved",
              receipt: recomputedReceiptFor(suite.suiteName, effectiveArtifact),
              runArtifact: {
                schemaVersion: "maestro-brain-suite-run-artifact/v1",
                artifactUri: `s3://maestro-brain-evals/${suite.suiteName}.jsonl`,
                artifactHash: `sha256:${sha256(effectiveArtifact)}`,
                rawArtifact: effectiveArtifact,
              },
            };
          }),
        }),
      ).toThrow(
        "Brain eval approval requires all external suite artifacts to pass.",
      );
    }
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
    ).toThrow(
      "Brain eval approval requires raw results bound to the frozen corpus.",
    );
  });

  it("rejects fabricated raw fixtures that rewrite frozen labels and expected outputs", () => {
    const report = buildBrainEvalReport();
    const classification = structuredClone(
      frozenSuite("classification"),
    ) as Record<string, unknown>;
    const cases = classification.cases as Array<Record<string, unknown>>;
    for (const entry of cases) {
      if (entry.split !== "test") continue;
      const target =
        Array.isArray(entry.allowedTargets) && entry.allowedTargets.length > 0
          ? String(entry.allowedTargets[0])
          : "no-route";
      entry.expectedTarget = target === "no-route" ? null : target;
      entry.outputTargets = target === "no-route" ? [] : [target];
      entry.committedTarget = target === "no-route" ? null : target;
      entry.labels = {
        reviewerA: target,
        reviewerB: target,
        adjudicated: target,
      };
    }
    const rawArtifact = {
      fixture: classification,
      run: {
        schemaVersion: "maestro-brain-classification-run/v1",
        results: cases
          .filter((entry) => entry.split === "test")
          .map((entry) => ({
            caseId: entry.id,
            outputTargets: entry.outputTargets,
            committedTarget: entry.committedTarget,
          })),
      },
    };

    expect(() =>
      approveBrainEvalArtifact({
        schemaVersion: "maestro-brain-eval-approval-artifact/v1",
        runId: "external-run-2026-07-14",
        generatedAt: "2026-07-14T00:00:00.000Z",
        suiteResults: report.suites.map((suite) => ({
          ...suite,
          status: "approved",
          receipt:
            suite.suiteName === "classification"
              ? {
                  ...suite.receipt,
                  fixtureHash: sha256(classification),
                  passed: true,
                  failures: [],
                }
              : suite.receipt,
          runArtifact: {
            schemaVersion: "maestro-brain-suite-run-artifact/v1",
            artifactUri: `s3://maestro-brain-evals/${suite.suiteName}.jsonl`,
            artifactHash: `sha256:${sha256(
              suite.suiteName === "classification"
                ? rawArtifact
                : rawArtifactFor(suite.suiteName),
            )}`,
            rawArtifact:
              suite.suiteName === "classification"
                ? rawArtifact
                : rawArtifactFor(suite.suiteName),
          },
        })),
      }),
    ).toThrow(
      "Brain eval approval requires raw results bound to the frozen corpus.",
    );
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
