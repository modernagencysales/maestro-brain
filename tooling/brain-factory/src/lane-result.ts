type JsonRecord = Record<string, unknown>;

interface FinalLaneResultExpectation {
  readonly currentHeadSha: string;
  readonly taskId: string;
}

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
};
