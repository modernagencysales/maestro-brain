import { describe, expect, it } from "vitest";

import { validateFinalLaneResult } from "../src/lane-result.js";

const taskId = "S04-T01";
const currentHeadSha = "a".repeat(40);
const currentTreeSha = "b".repeat(40);
const proof = {
  taskId,
  headSha: currentHeadSha,
  planSha256: "c".repeat(64),
  taskBlockHash: "d".repeat(64),
  reviewVerdict: "pass",
  reviewHeadSha: currentHeadSha,
  reviewFindings: [],
};
const finalGateReport = {
  schemaVersion: "maestro-brain-lane-gate/v1",
  taskId,
  headSha: currentHeadSha,
  currentHeadSha,
  currentTreeSha,
  planSha256: proof.planSha256,
  taskBlockHash: proof.taskBlockHash,
  stage: "final",
  status: "passed",
};
const expected = {
  currentHeadSha,
  currentTreeSha,
  taskId,
  proof,
  finalGateReport,
};
const validResult = {
  schemaVersion: "maestro-brain-lane-result/v1",
  taskId,
  headSha: currentHeadSha,
  treeSha: currentTreeSha,
  status: "lane_green",
};

describe("final lane result", () => {
  it("accepts an exact task, green status, and current-head binding", () => {
    expect(() => validateFinalLaneResult(validResult, expected)).not.toThrow();
  });

  it("keeps missing tree bindings strict unless historical admission opts in", () => {
    const { treeSha: _treeSha, ...historicalResult } = validResult;
    expect(() => validateFinalLaneResult(historicalResult, expected)).toThrow(
      "treeSha",
    );
    expect(() =>
      validateFinalLaneResult(historicalResult, {
        ...expected,
        allowHistoricalMissingTreeSha: true,
      }),
    ).not.toThrow();
  });

  it("requires an exact-head passed final lane gate receipt", () => {
    const { finalGateReport: _finalGateReport, ...expectedWithoutFinalGate } =
      expected;
    expect(() =>
      validateFinalLaneResult(validResult, expectedWithoutFinalGate),
    ).toThrow("final lane gate");

    for (const finalGateReport of [
      { ...expected.finalGateReport, stage: "pre-review" },
      { ...expected.finalGateReport, status: "failed" },
      { ...expected.finalGateReport, currentHeadSha: "e".repeat(40) },
      { ...expected.finalGateReport, currentTreeSha: "f".repeat(40) },
    ]) {
      expect(() =>
        validateFinalLaneResult(validResult, { ...expected, finalGateReport }),
      ).toThrow("final lane gate");
    }
  });

  it.each(["pending", "rework"])(
    "rejects lane green when proof review is %s",
    (reviewVerdict) => {
      expect(() =>
        validateFinalLaneResult(validResult, {
          ...expected,
          proof: { ...proof, reviewVerdict },
        }),
      ).toThrow("review verdict");
    },
  );

  it("rejects lane green when the aggregate review head is stale", () => {
    expect(() =>
      validateFinalLaneResult(validResult, {
        ...expected,
        proof: { ...proof, reviewHeadSha: "e".repeat(40) },
      }),
    ).toThrow("review head");
  });

  it.each([
    ["stale final head", { ...finalGateReport, headSha: "e".repeat(40) }],
    ["wrong schema", { ...finalGateReport, schemaVersion: "wrong" }],
    ["wrong task", { ...finalGateReport, taskId: "S99-T99" }],
    ["plan hash drift", { ...finalGateReport, planSha256: "e".repeat(64) }],
    ["task hash drift", { ...finalGateReport, taskBlockHash: "e".repeat(64) }],
  ])("rejects %s in the final receipt", (_label, finalGateReport) => {
    expect(() =>
      validateFinalLaneResult(validResult, { ...expected, finalGateReport }),
    ).toThrow("final lane gate");
  });

  it("rejects a pass proof with non-empty findings", () => {
    expect(() =>
      validateFinalLaneResult(validResult, {
        ...expected,
        proof: { ...proof, reviewFindings: [{ id: "RV-001" }] },
      }),
    ).toThrow("review findings");
  });

  it.each([
    [
      "schema",
      { ...validResult, schemaVersion: "maestro-brain-lane-result/v0" },
    ],
    ["task", { ...validResult, taskId: "S04-T02" }],
    ["status", { ...validResult, status: "integrated" }],
    ["head", { ...validResult, headSha: "b".repeat(40) }],
  ])("rejects an adversarial %s mismatch", (_label, result) => {
    expect(() => validateFinalLaneResult(result, expected)).toThrow();
  });

  it("accepts complete reproof lineage and rejects partial lineage", () => {
    const reproof = {
      priorIntegrationHeadSha: "b".repeat(40),
      priorIntegrationId: "wave-000001",
      requestPath: "/tmp/evidence/reproofs/S04-T01/request.json",
      requestSha256: "c".repeat(64),
    };
    expect(() =>
      validateFinalLaneResult({ ...validResult, reproof }, expected),
    ).not.toThrow();
    expect(() =>
      validateFinalLaneResult(
        { ...validResult, reproof: { ...reproof, requestSha256: "short" } },
        expected,
      ),
    ).toThrow(/lineage is incomplete/);
  });
});
