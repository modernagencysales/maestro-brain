import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CONTRACT_REPROOF_FINDINGS_SCHEMA,
  CONTRACT_REPROOF_REFRESH_SCHEMA,
  buildContractReproofFindingsRequest,
  buildContractReproofRequest,
  buildRefreshedContractReproofRequest,
  validateContractReproofRequest,
} from "../src/contract-reproof.js";

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const identity = {
  controlHeadSha: "a".repeat(40),
  planSha256: "b".repeat(64),
  taskBlockHash: "c".repeat(64),
  taskId: "S13-T01",
};

const request = () =>
  buildContractReproofRequest({
    ...identity,
    priorArchiveSha256: "d".repeat(64),
    priorIntegrationHeadSha: "e".repeat(40),
    priorIntegrationId: "C1-contract-spine",
    priorIntegrationResultSha256: "f".repeat(64),
    priorLaneResultSha256: "1".repeat(64),
    priorEvidencePath: "/tmp/evidence/prior.json",
    reason: "canonical task block gained stronger fixture requirements",
  });

const finding = {
  id: "wave-000056-S04-T04-tenant-key-auth-mismatch",
  taskId: identity.taskId,
  candidateHeadSha: "2".repeat(40),
  summary: "Authorization uses the provider key as a durable ID",
  details: "Resolve the stable provider key before membership authorization.",
  severity: "high",
  affectedPaths: ["packages/convex/confect/slack/channelPolicies.impl.ts"],
  expectedBehavior: "Authorize against the durable organization ID.",
  requiredRegressionProof:
    "An organization admin can use its agency key without cross-tenant access.",
  priorEvidenceSha256: ["3".repeat(64)],
  changeExpectation: "source_or_test_delta" as const,
};

const findingsRequest = (overrides: Record<string, unknown> = {}) =>
  buildContractReproofFindingsRequest({
    ...request(),
    findings: [{ ...finding, ...overrides }],
  });

describe("contract reproof provenance", () => {
  it("binds a deterministic request to old and current authority", () => {
    const value = request();
    expect(validateContractReproofRequest(value, identity)).toEqual(value);
    expect(request()).toEqual(value);
  });

  it.each([
    ["task", { ...identity, taskId: "S13-T02" }],
    ["control head", { ...identity, controlHeadSha: "2".repeat(40) }],
    ["plan", { ...identity, planSha256: "2".repeat(64) }],
    ["task block", { ...identity, taskBlockHash: "2".repeat(64) }],
  ])("rejects mismatched current %s authority", (_label, expected) => {
    expect(() => validateContractReproofRequest(request(), expected)).toThrow(
      /current authority/,
    );
  });

  it("rejects mutation and unsafe identities", () => {
    expect(() =>
      validateContractReproofRequest(
        { ...request(), reason: "mutated after signing" },
        identity,
      ),
    ).toThrow(/hash mismatch/);
    expect(() =>
      buildContractReproofRequest({ ...request(), taskId: "../S13-T01" }),
    ).toThrow(/safe segment/);
  });

  it("rejects fields outside the signed request payload", () => {
    expect(() =>
      validateContractReproofRequest(
        { ...request(), unsignedNote: "mutable" },
        identity,
      ),
    ).toThrow(/unknown fields/);
  });
});

describe("finding-bound contract reproof provenance", () => {
  it("sorts and hashes the complete canonical finding payload", () => {
    const affectedPath = finding.affectedPaths[0];
    if (!affectedPath) throw new Error("fixture affected path missing");
    const second = {
      ...finding,
      id: "wave-000056-S04-T04-a-second-finding",
      priorEvidenceSha256: ["4".repeat(64)],
    };
    const value = buildContractReproofFindingsRequest({
      ...request(),
      findings: [finding, second],
    });
    expect(value.schemaVersion).toBe(CONTRACT_REPROOF_FINDINGS_SCHEMA);
    expect(value.findings?.map(({ id }) => id)).toEqual([
      second.id,
      finding.id,
    ]);
    expect(
      validateContractReproofRequest(value, {
        ...identity,
        fileLocks: [affectedPath],
      }),
    ).toEqual(value);
  });

  it.each([
    ["empty finding ID", { id: "" }, /id must be a non-empty string/],
    ["task mismatch", { taskId: "S04-T04" }, /task mismatch/],
    [
      "non-SHA candidate",
      { candidateHeadSha: "candidate" },
      /candidateHeadSha/,
    ],
    ["missing expected behavior", { expectedBehavior: "" }, /expectedBehavior/],
    [
      "missing regression proof",
      { requiredRegressionProof: "" },
      /requiredRegressionProof/,
    ],
    [
      "duplicate prior evidence",
      { priorEvidenceSha256: ["3".repeat(64), "3".repeat(64)] },
      /duplicate prior evidence hash/,
    ],
    [
      "evidence-only without rationale",
      { changeExpectation: "evidence_only" },
      /evidenceOnlyRationale/,
    ],
  ])("rejects %s", (_label, overrides, expected) => {
    expect(() => findingsRequest(overrides)).toThrow(expected);
  });

  it("rejects an affected path outside the exact owner locks", () => {
    const value = findingsRequest();
    expect(() =>
      validateContractReproofRequest(value, {
        ...identity,
        fileLocks: ["packages/convex/test/channel-policies.test.ts"],
      }),
    ).toThrow(/outside owner locks/);
  });

  it("preserves byte-for-byte v1 request hashing", () => {
    expect(request().requestSha256).toBe(
      "a045e72e78b08686152833b208d94dcd10f784be9c3294c699da75dd7ef7db80",
    );
  });
});

describe("contract reproof authority refresh", () => {
  const previous = request();
  const laneHeadSha = "3".repeat(40);
  const laneTreeSha = "4".repeat(40);
  const lane = {
    headSha: laneHeadSha,
    reproof: {
      priorIntegrationHeadSha: previous.priorIntegrationHeadSha,
      priorIntegrationId: previous.priorIntegrationId,
      requestPath: "/tmp/evidence/reproofs/S13-T01/old/request.json",
      requestSha256: previous.requestSha256,
    },
    schemaVersion: "maestro-brain-lane-result/v1",
    status: "lane_green",
    taskId: previous.taskId,
    tranche: "R0-release",
  };
  const proof = {
    baseSha: previous.controlHeadSha,
    headSha: laneHeadSha,
    planSha256: previous.planSha256,
    reviewFindings: [],
    reviewHeadSha: laneHeadSha,
    reviewVerdict: "pass",
    schemaVersion: "maestro-brain-ci-proof/v1",
    taskBlockHash: previous.taskBlockHash,
    taskId: previous.taskId,
  };
  const finalGateReport = {
    currentHeadSha: laneHeadSha,
    currentTreeSha: laneTreeSha,
    headSha: laneHeadSha,
    planSha256: previous.planSha256,
    schemaVersion: "maestro-brain-lane-gate/v1",
    stage: "final",
    status: "passed",
    taskBlockHash: previous.taskBlockHash,
    taskId: previous.taskId,
  };
  const refresh = (overrides: Record<string, unknown> = {}) => {
    const input = {
      currentControlHeadSha: "5".repeat(40),
      currentPlanSha256: "6".repeat(64),
      currentTaskBlockHash: previous.taskBlockHash,
      finalGateReport,
      finalGateContent: json(finalGateReport),
      finalGatePath: "/tmp/evidence/reproofs/S13-T01/new/prior-final-gate.json",
      lane,
      laneContent: json(lane),
      lanePath: "/tmp/evidence/reproofs/S13-T01/new/prior-lane-result.json",
      laneTreeSha,
      previousRequest: previous,
      previousRequestContent: json(previous),
      previousRequestPath: lane.reproof.requestPath,
      proof,
      proofContent: json(proof),
      proofPath: "/tmp/evidence/reproofs/S13-T01/new/prior-proof.json",
      priorReproofSourceHeadSha: laneHeadSha,
      reason: "refresh proof against current control authority",
      taskId: previous.taskId,
      ...overrides,
    };
    if ("lane" in overrides && !("laneContent" in overrides)) {
      input.laneContent = json(input.lane);
    }
    if ("proof" in overrides && !("proofContent" in overrides)) {
      input.proofContent = json(input.proof);
    }
    if ("finalGateReport" in overrides && !("finalGateContent" in overrides)) {
      input.finalGateContent = json(input.finalGateReport);
    }
    return buildRefreshedContractReproofRequest(input);
  };

  it("mints a new signed authority request without changing prior lineage", () => {
    const refreshed = refresh();
    expect(refreshed).toMatchObject({
      schemaVersion: CONTRACT_REPROOF_REFRESH_SCHEMA,
      controlHeadSha: "5".repeat(40),
      planSha256: "6".repeat(64),
      priorArchiveSha256: previous.priorArchiveSha256,
      priorIntegrationHeadSha: previous.priorIntegrationHeadSha,
      priorIntegrationId: previous.priorIntegrationId,
      priorIntegrationResultSha256: previous.priorIntegrationResultSha256,
      priorLaneResultSha256: previous.priorLaneResultSha256,
      priorEvidencePath: previous.priorEvidencePath,
      taskBlockHash: previous.taskBlockHash,
      taskId: previous.taskId,
      priorReproofFinalGateSha256: sha256(json(finalGateReport)),
      priorReproofLaneResultSha256: sha256(json(lane)),
      priorReproofProofSha256: sha256(json(proof)),
      priorReproofRequestSha256: sha256(json(previous)),
      priorReproofSourceHeadSha: laneHeadSha,
    });
    expect(refreshed.requestSha256).not.toBe(previous.requestSha256);
    expect(previous.controlHeadSha).toBe(identity.controlHeadSha);
  });

  it.each([
    [
      "task-block drift",
      { currentTaskBlockHash: "7".repeat(64) },
      /current authority/,
    ],
    [
      "lane request drift",
      {
        lane: {
          ...lane,
          reproof: { ...lane.reproof, requestSha256: "7".repeat(64) },
        },
      },
      /lane reproof lineage/,
    ],
    [
      "lane request path drift",
      { previousRequestPath: "/tmp/evidence/reproofs/S13-T01/other.json" },
      /lane reproof lineage/,
    ],
    [
      "proof base drift",
      { proof: { ...proof, baseSha: "7".repeat(40) } },
      /proof does not bind prior request/,
    ],
    [
      "unsigned request field",
      { previousRequest: { ...previous, unsignedNote: "mutable" } },
      /unknown fields/,
    ],
    [
      "ambiguous lane lineage",
      { lane: { ...lane, reproof: { ...lane.reproof, alternate: "request" } } },
      /unknown fields/,
    ],
    [
      "unknown lane field",
      { lane: { ...lane, unsignedNote: "mutable" } },
      /prior reproof lane has unknown fields/,
    ],
    [
      "unknown proof field",
      { proof: { ...proof, unsignedNote: "mutable" } },
      /prior reproof proof has unknown fields/,
    ],
    [
      "unknown final gate field",
      { finalGateReport: { ...finalGateReport, unsignedNote: "mutable" } },
      /prior reproof final gate has unknown fields/,
    ],
    [
      "source commit drift",
      { priorReproofSourceHeadSha: "8".repeat(40) },
      /source head drift/,
    ],
  ])("rejects %s", (_label, overrides, expected) => {
    expect(() => refresh(overrides)).toThrow(expected);
  });

  it.each([
    "priorReproofRequestSha256",
    "priorReproofLaneResultSha256",
    "priorReproofProofSha256",
    "priorReproofFinalGateSha256",
  ])("rejects a mutated signed %s", (field) => {
    const refreshed = refresh();
    expect(() =>
      validateContractReproofRequest(
        { ...refreshed, [field]: "9".repeat(64) },
        {
          controlHeadSha: refreshed.controlHeadSha,
          planSha256: refreshed.planSha256,
          taskBlockHash: refreshed.taskBlockHash,
          taskId: refreshed.taskId,
        },
      ),
    ).toThrow(/hash mismatch/);
  });
});
