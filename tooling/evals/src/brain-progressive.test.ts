import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
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
    });
    expect(report.metrics).toEqual({
      casesPassing: { numerator: 4, denominator: 4, rate: 1 },
      exactCitationReopening: { numerator: 6, denominator: 6, rate: 1 },
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

  it("uses only adjudicated real tasks to advance maturity", () => {
    const base = {
      schemaVersion: 1 as const,
      datasetId: "external",
      payloadLocation: "external" as const,
      payloadHashes: [],
    };

    expect(
      evaluateBrainProgressive([], {
        ...base,
        realTaskCount: 24,
        adjudicatedTaskCount: 1,
      }).maturity,
    ).toBe("provisional");
    expect(
      evaluateBrainProgressive([], {
        ...base,
        realTaskCount: 25,
        adjudicatedTaskCount: 25,
      }).maturity,
    ).toBe("exit-eligible");
  });
});
