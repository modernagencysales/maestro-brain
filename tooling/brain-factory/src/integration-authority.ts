import { basename } from "node:path";

import { type JsonRecord, record } from "./integration-check-support.js";

const BROAD_GATE_COMMAND = "rtk host-test-slot --class full pnpm verify";

const resultIntegrationId = (
  result: JsonRecord,
  resultDirectory: string,
): string | undefined => {
  const directoryId = basename(resultDirectory);
  if (typeof result.integrationId === "string" && result.integrationId) {
    return result.integrationId === directoryId ? directoryId : undefined;
  }
  return result.schemaVersion === "maestro-brain-integration-result/v1" &&
    result.tranche === directoryId
    ? directoryId
    : undefined;
};

/** Bind historical lane state only to a complete, exact integration receipt. */
export const authoritativeIntegrationResultBindsLane = (input: {
  readonly integrationHeadSha: string;
  readonly integrationId: string;
  readonly laneHeadSha: string;
  readonly result: JsonRecord;
  readonly resultDirectory: string;
  readonly taskId: string;
  readonly taskTranche?: string;
}): boolean => {
  const resultId = resultIntegrationId(input.result, input.resultDirectory);
  if (
    resultId !== input.integrationId ||
    !new Set([
      "maestro-brain-integration-result/v1",
      "maestro-brain-integration-result/v2",
      "maestro-brain-integration-result/v3",
    ]).has(String(input.result.schemaVersion)) ||
    input.result.status !== "passed" ||
    input.result.reviewVerdict !== "pass" ||
    input.result.headSha !== input.integrationHeadSha ||
    !Array.isArray(input.result.remainingFindings) ||
    input.result.remainingFindings.length !== 0 ||
    !Array.isArray(input.result.includedTasks)
  ) {
    return false;
  }
  const broadGate =
    typeof input.result.broadGate === "object" &&
    input.result.broadGate !== null
      ? record(input.result.broadGate, `${input.integrationId}: broadGate`)
      : undefined;
  if (
    broadGate?.status !== "passed" ||
    broadGate.headSha !== input.integrationHeadSha ||
    broadGate.command !== BROAD_GATE_COMMAND
  ) {
    return false;
  }
  const matchingTasks = input.result.includedTasks
    .map((value, index) =>
      record(value, `${input.integrationId}: includedTasks[${index}]`),
    )
    .filter((included) => included.taskId === input.taskId);
  return (
    matchingTasks.length === 1 &&
    matchingTasks[0]?.laneHeadSha === input.laneHeadSha &&
    (!input.taskTranche ||
      ((typeof matchingTasks[0].tranche !== "string" ||
        matchingTasks[0].tranche === input.taskTranche) &&
        (typeof matchingTasks[0].manifestTranche !== "string" ||
          matchingTasks[0].manifestTranche === input.taskTranche)))
  );
};
