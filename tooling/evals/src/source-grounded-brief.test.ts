import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateSourceGroundedBrief,
  loadSourceGroundedBriefCases,
} from "./source-grounded-brief";

const fixturePath = fileURLToPath(
  new URL(
    "../../../examples/generic-ai-ops/evals/source-grounded-brief.cases.json",
    import.meta.url,
  ),
);

describe("source grounded brief eval", () => {
  it("loads reusable fixture cases for the template capability", () => {
    const cases = loadSourceGroundedBriefCases(
      readFileSync(fixturePath, "utf8"),
    );

    expect(cases).toHaveLength(2);
    expect(cases[0]).toMatchObject({
      id: "happy-path-grounded-brief",
      expectedTrustClaim: "source-backed-no-default-rag",
    });
  });

  it("scores grounded markdown with source, policy, and model provenance", () => {
    const [testCase] = loadSourceGroundedBriefCases(
      readFileSync(fixturePath, "utf8"),
    );

    if (!testCase) {
      throw new Error("Expected at least one source grounded brief case");
    }

    const result = evaluateSourceGroundedBrief(testCase);

    expect(result).toEqual({
      caseId: "happy-path-grounded-brief",
      passed: true,
      score: 1,
      checks: {
        groundedness: true,
        sourceCitations: true,
        policyCompliance: true,
        missingSourceRefusal: true,
      },
      failures: [],
    });
  });

  it("fails when a brief invents output without required sources", () => {
    const [, missingSourceCase] = loadSourceGroundedBriefCases(
      readFileSync(fixturePath, "utf8"),
    );

    if (!missingSourceCase) {
      throw new Error("Expected a missing-source eval case");
    }

    const result = evaluateSourceGroundedBrief(missingSourceCase);

    expect(result).toMatchObject({
      caseId: "missing-source-refusal",
      passed: false,
      checks: {
        groundedness: false,
        sourceCitations: false,
        policyCompliance: true,
        missingSourceRefusal: false,
      },
      failures: [
        "Brief must include every required source title.",
        "Brief must cite source titles in markdown.",
        "Missing-source cases must refuse instead of inventing a brief.",
      ],
    });
    expect(result.score).toBe(0.25);
  });
});
