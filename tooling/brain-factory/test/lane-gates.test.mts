import { describe, expect, it } from "vitest";

import type { ContractReproofFinding } from "../src/contract-reproof.js";
import type { PriorFindingDisposition } from "../src/review-lens.js";
import { validateBehavioralReproofClosure } from "../src/proof.js";

const finding: ContractReproofFinding = {
  id: "wave-000056-S04-T04-tenant-key-auth-mismatch",
  taskId: "S04-T04",
  candidateHeadSha: "a".repeat(40),
  summary: "Authorization uses the stable key as a durable ID.",
  details: "Resolve the provider key before membership authorization.",
  severity: "high",
  affectedPaths: ["packages/convex/confect/slack/channelPolicies.impl.ts"],
  expectedBehavior: "Authorization uses the durable organization ID.",
  requiredRegressionProof: "An agency-key admin regression passes.",
  priorEvidenceSha256: ["b".repeat(64)],
  changeExpectation: "source_or_test_delta",
};

const disposition: PriorFindingDisposition = {
  findingId: finding.id,
  status: "resolved",
  evidence: ["channelPolicies.impl.ts:42"],
  regressionTestPaths: ["packages/convex/test/channel-policies.test.ts"],
  changedPaths: [...finding.affectedPaths],
};

describe("finding-bound final lane gate", () => {
  it("requires an affected code delta and an owned regression-test delta", () => {
    expect(() =>
      validateBehavioralReproofClosure({
        findings: [finding],
        dispositions: [disposition],
        changedPaths: [...finding.affectedPaths],
        ownedPaths: [
          ...finding.affectedPaths,
          ...disposition.regressionTestPaths,
        ],
      }),
    ).toThrow(`${finding.id}: behavioral reproof lacks code and test delta`);

    expect(() =>
      validateBehavioralReproofClosure({
        findings: [finding],
        dispositions: [disposition],
        changedPaths: [
          ...finding.affectedPaths,
          ...disposition.regressionTestPaths,
        ],
        ownedPaths: [
          ...finding.affectedPaths,
          ...disposition.regressionTestPaths,
        ],
      }),
    ).not.toThrow();
  });

  it("rejects unresolved, missing, or unknown prior finding IDs", () => {
    const input = {
      findings: [finding],
      changedPaths: [
        ...finding.affectedPaths,
        ...disposition.regressionTestPaths,
      ],
      ownedPaths: [
        ...finding.affectedPaths,
        ...disposition.regressionTestPaths,
      ],
    };
    expect(() =>
      validateBehavioralReproofClosure({ ...input, dispositions: [] }),
    ).toThrow(/missing prior finding disposition/);
    expect(() =>
      validateBehavioralReproofClosure({
        ...input,
        dispositions: [{ ...disposition, status: "unresolved" }],
      }),
    ).toThrow(/is unresolved/);
    expect(() =>
      validateBehavioralReproofClosure({
        ...input,
        dispositions: [{ ...disposition, findingId: "unknown-prior-finding" }],
      }),
    ).toThrow(/unknown prior finding/);
  });
});
