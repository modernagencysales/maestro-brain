import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type BrainProgressiveCase,
  evaluateBrainProgressive,
  loadBrainExternalFixtureManifest,
  loadBrainProgressiveCases,
} from "./brain-progressive";

const fixturePath = fileURLToPath(
  new URL(
    "../../../examples/generic-ai-ops/evals/brain-safety.cases.json",
    import.meta.url,
  ),
);
const manifestPath = fileURLToPath(
  new URL(
    "../../../examples/generic-ai-ops/evals/brain-real-manifest.json",
    import.meta.url,
  ),
);

describe("progressive Brain evaluation", () => {
  it("accepts an empty external real-data manifest from day one", () => {
    const manifest = loadBrainExternalFixtureManifest(
      readFileSync(manifestPath, "utf8"),
    );

    expect(manifest).toEqual({
      schemaVersion: 1,
      datasetId: "brain-pilot-real-v1",
      payloadLocation: "external",
      realTaskCount: 0,
      adjudicatedTaskCount: 0,
      payloadHashes: [],
    });
  });

  it("passes synthetic reopening, withdrawal, abstention, and parity cases", () => {
    const cases = loadBrainProgressiveCases(readFileSync(fixturePath, "utf8"));
    const manifest = loadBrainExternalFixtureManifest(
      readFileSync(manifestPath, "utf8"),
    );
    const report = evaluateBrainProgressive(cases, manifest);

    expect(report.maturity).toBe("insufficient-sample");
    expect(report.sample).toEqual({
      realTasks: 0,
      adjudicatedRealTasks: 0,
      minimumExitSample: 25,
      manifestDeclaredRealTasks: 0,
      manifestDeclaredAdjudicatedTasks: 0,
      manifestMatchesInspectedCases: true,
    });
    expect(report.metrics).toEqual({
      casesPassing: { numerator: 4, denominator: 4, rate: 1 },
      exactCitationReopening: { numerator: 6, denominator: 6, rate: 1 },
      expectedAnswerStatus: { numerator: 7, denominator: 7, rate: 1 },
      supportingSourceRecallAt5: { numerator: 6, denominator: 6, rate: 1 },
      citationEntailment: { numerator: 0, denominator: 0, rate: null },
      highRiskCitationEntailment: {
        numerator: 0,
        denominator: 0,
        rate: null,
      },
      withdrawalExclusion: { numerator: 1, denominator: 1, rate: 1 },
      insufficientContext: { numerator: 1, denominator: 1, rate: 1 },
      surfaceParity: { numerator: 1, denominator: 1, rate: 1 },
    });
    expect(report.cases.every(({ passed }) => passed)).toBe(true);
  });

  it("is deterministic for repeated input regardless of caller ordering", () => {
    const cases = loadBrainProgressiveCases(readFileSync(fixturePath, "utf8"));
    const manifest = loadBrainExternalFixtureManifest(
      readFileSync(manifestPath, "utf8"),
    );

    expect(evaluateBrainProgressive([...cases].reverse(), manifest)).toEqual(
      evaluateBrainProgressive(cases, manifest),
    );
  });

  it("reports denominators of zero instead of manufacturing a rate", () => {
    const report = evaluateBrainProgressive([], {
      schemaVersion: 1,
      datasetId: "empty",
      payloadLocation: "external",
      realTaskCount: 0,
      adjudicatedTaskCount: 0,
      payloadHashes: [],
    });

    expect(report.metrics.exactCitationReopening).toEqual({
      numerator: 0,
      denominator: 0,
      rate: null,
    });
    expect(report.metrics.casesPassing.denominator).toBe(0);
  });

  it("does not advance maturity from uninspected manifest counts", () => {
    const base = {
      schemaVersion: 1 as const,
      datasetId: "external",
      payloadLocation: "external" as const,
      payloadHashes: [],
    };

    const partialManifest = evaluateBrainProgressive([], {
      ...base,
      realTaskCount: 24,
      adjudicatedTaskCount: 1,
    });
    const exitSizedManifest = evaluateBrainProgressive([], {
      ...base,
      realTaskCount: 25,
      adjudicatedTaskCount: 25,
    });

    expect(partialManifest.maturity).toBe("insufficient-sample");
    expect(exitSizedManifest.maturity).toBe("insufficient-sample");
    expect(partialManifest.sample).toMatchObject({
      realTasks: 0,
      adjudicatedRealTasks: 0,
      manifestDeclaredRealTasks: 24,
      manifestDeclaredAdjudicatedTasks: 1,
      manifestMatchesInspectedCases: false,
    });
    expect(exitSizedManifest.sample.manifestMatchesInspectedCases).toBe(false);
  });

  it("keeps citation entailment explicitly unassessed", () => {
    const report = evaluateBrainProgressive([], {
      schemaVersion: 1,
      datasetId: "empty",
      payloadLocation: "external",
      realTaskCount: 0,
      adjudicatedTaskCount: 0,
      payloadHashes: [],
    });
    expect(report.metrics.citationEntailment).toEqual({
      numerator: 0,
      denominator: 0,
      rate: null,
    });
  });

  it("parses explicit citation entailment adjudication", () => {
    const [testCase] = loadBrainProgressiveCases(
      JSON.stringify([
        {
          id: "real-entailed",
          fixtureClass: "external-real",
          adjudicated: true,
          riskLevel: "ordinary",
          expectedAnswerStatus: "answered",
          availableEvidence: [
            {
              sourceId: "source-1",
              revisionId: "revision-1",
              contentHash: "hash-1",
              eligible: true,
            },
          ],
          observations: [
            {
              surface: "cli",
              answerStatus: "answered",
              packHash: "sha256:pack-1",
              citations: [
                {
                  sourceId: "source-1",
                  revisionId: "revision-1",
                  contentHash: "hash-1",
                  reopenedContentHash: "hash-1",
                  accessible: true,
                  entailed: true,
                },
              ],
            },
          ],
        },
      ]),
    );

    expect(testCase?.observations[0]?.citations[0]?.entailed).toBe(true);
  });

  it("requires complete citation entailment adjudication at or above 95 percent for exit eligibility", () => {
    const casesFor = (entailments: readonly (boolean | undefined)[]) =>
      entailments.map((entailed, index) => ({
        id: `real-${index}`,
        fixtureClass: "external-real" as const,
        adjudicated: true,
        riskLevel: index === 0 ? ("high" as const) : ("ordinary" as const),
        expectedAnswerStatus: "answered" as const,
        availableEvidence: [
          {
            sourceId: `source-${index}`,
            revisionId: "revision-1",
            contentHash: `hash-${index}`,
            eligible: true,
          },
        ],
        observations: [
          {
            surface: "cli" as const,
            answerStatus: "answered" as const,
            packHash: `sha256:pack-${index}`,
            citations: [
              {
                sourceId: `source-${index}`,
                revisionId: "revision-1",
                contentHash: `hash-${index}`,
                reopenedContentHash: `hash-${index}`,
                accessible: true,
                ...(entailed === undefined ? {} : { entailed }),
              },
            ],
          },
        ],
      }));
    const manifest = {
      schemaVersion: 1 as const,
      datasetId: "external",
      payloadLocation: "external" as const,
      realTaskCount: 25,
      adjudicatedTaskCount: 25,
      payloadHashes: [],
    };
    const safetyCases = loadBrainProgressiveCases(
      readFileSync(fixturePath, "utf8"),
    );
    const evaluate = (cases: readonly BrainProgressiveCase[]) =>
      evaluateBrainProgressive([...safetyCases, ...cases], manifest);

    const unassessed = evaluate(
      casesFor([...Array<boolean>(24).fill(true), undefined]),
    );
    const passing = evaluate(
      casesFor([...Array<boolean>(24).fill(true), false]),
    );
    const belowThreshold = evaluate(
      casesFor([...Array<boolean>(23).fill(true), false, false]),
    );
    const qualityFailureCases = casesFor(Array<boolean>(25).fill(true)).map(
      (testCase, index) =>
        index === 0
          ? {
              ...testCase,
              observations: testCase.observations.map((observation) => ({
                ...observation,
                answerStatus: "insufficient_context" as const,
              })),
            }
          : testCase,
    );
    const failedQualityGate = evaluate(qualityFailureCases);
    const highRiskFailure = evaluate(
      casesFor([false, ...Array<boolean>(24).fill(true)]),
    );

    expect(unassessed.metrics.citationEntailment).toEqual({
      numerator: 23,
      denominator: 23,
      rate: 1,
    });
    expect(unassessed.maturity).toBe("provisional");
    expect(passing.metrics.citationEntailment).toEqual({
      numerator: 23,
      denominator: 24,
      rate: 23 / 24,
    });
    expect(passing.metrics.highRiskCitationEntailment).toEqual({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
    expect(passing.maturity).toBe("exit-eligible");
    expect(belowThreshold.metrics.citationEntailment).toEqual({
      numerator: 22,
      denominator: 24,
      rate: 22 / 24,
    });
    expect(belowThreshold.maturity).toBe("provisional");
    expect(failedQualityGate.metrics.expectedAnswerStatus.rate).toBeGreaterThan(
      0.95,
    );
    expect(failedQualityGate.metrics.casesPassing.rate).toBeLessThan(1);
    expect(failedQualityGate.maturity).toBe("provisional");
    expect(highRiskFailure.metrics.citationEntailment.rate).toBe(1);
    expect(highRiskFailure.metrics.highRiskCitationEntailment.rate).toBe(0);
    expect(highRiskFailure.maturity).toBe("provisional");
  });

  it("scores only adjudicated evidence as expected support", () => {
    const report = evaluateBrainProgressive(
      [
        {
          id: "real-1",
          fixtureClass: "external-real",
          adjudicated: true,
          riskLevel: "ordinary",
          expectedAnswerStatus: "answered",
          availableEvidence: [
            {
              sourceId: "slack:expected",
              revisionId: "revision-1",
              contentHash: "expected-hash",
              eligible: true,
            },
          ],
          observations: [
            {
              surface: "cli",
              answerStatus: "insufficient_context",
              packHash: "sha256:observed",
              citations: [],
            },
          ],
        },
      ],
      {
        schemaVersion: 1,
        datasetId: "external",
        payloadLocation: "external",
        realTaskCount: 1,
        adjudicatedTaskCount: 1,
        payloadHashes: [],
      },
    );

    expect(report.maturity).toBe("provisional");
    expect(report.sample.adjudicatedRealTasks).toBe(1);
    expect(report.sample.manifestMatchesInspectedCases).toBe(true);
    expect(report.metrics.expectedAnswerStatus).toEqual({
      numerator: 0,
      denominator: 1,
      rate: 0,
    });
    expect(report.metrics.supportingSourceRecallAt5).toEqual({
      numerator: 0,
      denominator: 1,
      rate: 0,
    });
    expect(report.metrics.casesPassing).toEqual({
      numerator: 0,
      denominator: 1,
      rate: 0,
    });
    expect(report.cases[0]).toMatchObject({
      passed: false,
      checks: {
        expectedAnswerStatus: false,
        supportingSourceRecallAt5: false,
      },
    });
  });
});
