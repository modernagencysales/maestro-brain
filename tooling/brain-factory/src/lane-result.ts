type JsonRecord = Record<string, unknown>;

const exactSha = (value: unknown, length: 40 | 64): boolean =>
  typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value);

interface FinalLaneResultExpectation {
  readonly currentHeadSha: string;
  readonly currentTreeSha: string;
  readonly finalGateReport?: unknown;
  readonly proof: unknown;
  readonly taskId: string;
}

const record = (value: unknown): JsonRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;

export const validateFinalLaneResult = (
  lane: JsonRecord,
  expected: FinalLaneResultExpectation,
): void => {
  if (lane.schemaVersion !== "maestro-brain-lane-result/v1") {
    throw new Error(`${expected.taskId}: lane result schemaVersion is invalid`);
  }
  if (lane.taskId !== expected.taskId) {
    throw new Error(`${expected.taskId}: lane result taskId does not match`);
  }
  if (lane.status !== "lane_green") {
    throw new Error(`${expected.taskId}: lane result status is not lane_green`);
  }
  if (lane.headSha !== expected.currentHeadSha) {
    throw new Error(
      `${expected.taskId}: lane result headSha does not match current HEAD`,
    );
  }
  if (lane.treeSha !== expected.currentTreeSha) {
    throw new Error(
      `${expected.taskId}: lane result treeSha does not match current tree`,
    );
  }

  const proof = record(expected.proof);
  if (!proof || proof.taskId !== expected.taskId) {
    throw new Error(`${expected.taskId}: final proof is invalid`);
  }
  if (proof.headSha !== expected.currentHeadSha) {
    throw new Error(`${expected.taskId}: final proof head does not match`);
  }
  if (proof.reviewVerdict !== "pass") {
    throw new Error(
      `${expected.taskId}: final proof review verdict is not pass`,
    );
  }
  if (proof.reviewHeadSha !== expected.currentHeadSha) {
    throw new Error(`${expected.taskId}: aggregate review head does not match`);
  }
  if (
    !Array.isArray(proof.reviewFindings) ||
    proof.reviewFindings.length !== 0
  ) {
    throw new Error(`${expected.taskId}: passed aggregate has review findings`);
  }

  const finalGate = record(expected.finalGateReport);
  if (
    !finalGate ||
    finalGate.schemaVersion !== "maestro-brain-lane-gate/v1" ||
    finalGate.taskId !== expected.taskId ||
    finalGate.stage !== "final" ||
    finalGate.status !== "passed" ||
    finalGate.headSha !== expected.currentHeadSha ||
    finalGate.currentHeadSha !== expected.currentHeadSha ||
    finalGate.currentTreeSha !== expected.currentTreeSha ||
    finalGate.planSha256 !== proof.planSha256 ||
    finalGate.taskBlockHash !== proof.taskBlockHash
  ) {
    throw new Error(`${expected.taskId}: final lane gate receipt is invalid`);
  }
  if (lane.reproof !== undefined) {
    if (
      typeof lane.reproof !== "object" ||
      lane.reproof === null ||
      Array.isArray(lane.reproof)
    ) {
      throw new Error(`${expected.taskId}: reproof lineage is invalid`);
    }
    const reproof = lane.reproof as JsonRecord;
    if (
      typeof reproof.requestPath !== "string" ||
      !reproof.requestPath ||
      !exactSha(reproof.requestSha256, 64) ||
      !exactSha(reproof.priorIntegrationHeadSha, 40) ||
      typeof reproof.priorIntegrationId !== "string" ||
      !reproof.priorIntegrationId
    ) {
      throw new Error(`${expected.taskId}: reproof lineage is incomplete`);
    }
  }
};
