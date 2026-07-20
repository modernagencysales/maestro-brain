import { describe, expect, it } from "vitest";

import {
  buildContractReproofRequest,
  buildRefreshedContractReproofRequest,
  validateContractReproofRequest,
} from "../src/contract-reproof.js";

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
  const refresh = (overrides = {}) =>
    buildRefreshedContractReproofRequest({
      currentControlHeadSha: "5".repeat(40),
      currentPlanSha256: "6".repeat(64),
      currentTaskBlockHash: previous.taskBlockHash,
      finalGateReport,
      lane,
      laneTreeSha,
      previousRequest: previous,
      proof,
      reason: "refresh proof against current control authority",
      taskId: previous.taskId,
      ...overrides,
    });

  it("mints a new signed authority request without changing prior lineage", () => {
    const refreshed = refresh();
    expect(refreshed).toMatchObject({
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
  ])("rejects %s", (_label, overrides, expected) => {
    expect(() => refresh(overrides)).toThrow(expected);
  });
});
