import { createHash } from "node:crypto";

import type { IntegrationWaveTaskSnapshot } from "./integration-wave.js";

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const record = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

export const parseRecord = (
  content: string,
  label: string,
): Record<string, unknown> => {
  if (!content) throw new Error(`${label} is missing`);
  return record(JSON.parse(content), label);
};

export const exactSha = (
  value: unknown,
  label: string,
  length: 40 | 64,
): string => {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[0-9a-f]{${length}}$`).test(value)
  ) {
    throw new Error(`${label} must be an exact ${length}-character SHA`);
  }
  return value;
};

export const sameRecord = (
  actual: unknown,
  expected: Record<string, unknown>,
  label: string,
): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} drift`);
  }
};

export const validateLaneBindings = (input: {
  readonly gate: Record<string, unknown>;
  readonly gateContent: string;
  readonly lane: Record<string, unknown>;
  readonly laneContent: string;
  readonly proof: Record<string, unknown>;
  readonly proofContent: string;
  readonly selected: IntegrationWaveTaskSnapshot;
  readonly taskId: string;
}): void => {
  if (
    input.lane.status !== "lane_green" ||
    input.lane.taskId !== input.taskId ||
    input.selected.taskId !== input.taskId
  ) {
    throw new Error(`${input.taskId}: task owner mismatch`);
  }
  if (sha256(input.laneContent) !== input.selected.laneResultSha256) {
    throw new Error(`${input.taskId}: lane result digest drift`);
  }
  if (sha256(input.proofContent) !== input.selected.proofSha256) {
    throw new Error(`${input.taskId}: proof digest drift`);
  }
  if (sha256(input.gateContent) !== input.selected.gateSha256) {
    throw new Error(`${input.taskId}: gate digest drift`);
  }
  if (
    input.selected.headSha !== input.lane.headSha ||
    input.selected.proofHeadSha !== input.lane.headSha ||
    input.selected.gateHeadSha !== input.lane.headSha ||
    input.proof.headSha !== input.lane.headSha ||
    input.proof.reviewHeadSha !== input.lane.headSha ||
    input.gate.headSha !== input.lane.headSha ||
    input.gate.currentHeadSha !== input.lane.headSha
  ) {
    throw new Error(`${input.taskId}: lane proof/gate head drift`);
  }
  if (
    input.proof.planSha256 !== input.selected.planSha256 ||
    input.gate.planSha256 !== input.selected.planSha256 ||
    input.proof.taskBlockHash !== input.selected.taskBlockHash ||
    input.gate.taskBlockHash !== input.selected.taskBlockHash
  ) {
    throw new Error(`${input.taskId}: lane authority binding drift`);
  }
  if (
    input.proof.reviewVerdict !== "pass" ||
    input.gate.status !== "passed" ||
    input.gate.stage !== "final"
  ) {
    throw new Error(`${input.taskId}: lane proof/gate is not green`);
  }
};

export const validateFailedBroadGate = (input: {
  readonly broadGate: Record<string, unknown>;
  readonly candidateHeadSha: string;
}): void => {
  const { broadGate } = input;
  if (broadGate.status !== "failed") {
    throw new Error("failed integration broad gate is not failed");
  }
  if (broadGate.headSha !== input.candidateHeadSha) {
    throw new Error("failed integration broad gate candidate head drift");
  }
  if (broadGate.command !== "rtk host-test-slot --class full pnpm verify") {
    throw new Error("failed integration broad gate command drift");
  }
  if (!Array.isArray(broadGate.attempts) || broadGate.attempts.length === 0) {
    throw new Error("failed integration broad gate has no attempts");
  }
  for (const [index, value] of broadGate.attempts.entries()) {
    const attempt = record(value, `broad gate attempt ${index + 1}`);
    if (
      attempt.attempt !== index + 1 ||
      attempt.status !== "failed" ||
      attempt.headSha !== input.candidateHeadSha ||
      attempt.command !== broadGate.command ||
      typeof attempt.outputSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(attempt.outputSha256)
    ) {
      throw new Error(`broad gate attempt ${index + 1} identity drift`);
    }
  }
};

export const validateSupersession = (input: {
  readonly broadGateContent: string;
  readonly integrationResultContent: string;
  readonly selectionFileSha256: string;
  readonly selectionPayloadSha256: string;
  readonly selectionPlanSha256: string;
  readonly selectionBaseSha: string;
  readonly integrationId: string;
  readonly supersession: Record<string, unknown>;
  readonly taskId: string;
}): void => {
  const receiptSha256 = input.supersession.receiptSha256;
  const payload = { ...input.supersession };
  delete payload.receiptSha256;
  if (receiptSha256 !== sha256(JSON.stringify(payload))) {
    throw new Error("failed integration supersession receipt digest drift");
  }
  if (
    input.supersession.schemaVersion !==
      "maestro-brain-integration-wave-supersession/v2" ||
    input.supersession.status !== "superseded" ||
    input.supersession.integrationId !== input.integrationId ||
    input.supersession.baseSha !== input.selectionBaseSha ||
    input.supersession.controlHeadSha !== input.selectionBaseSha ||
    input.supersession.planSha256 !== input.selectionPlanSha256 ||
    input.supersession.selectionFileSha256 !== input.selectionFileSha256 ||
    input.supersession.selectionPayloadSha256 !==
      input.selectionPayloadSha256 ||
    JSON.stringify(input.supersession.selectedTaskIds) !==
      JSON.stringify([input.taskId])
  ) {
    throw new Error("failed integration supersession identity drift");
  }
  if (
    !Array.isArray(input.supersession.runAttempts) ||
    input.supersession.runAttempts.length === 0 ||
    input.supersession.runAttempts.some(
      (value, index) =>
        record(value, `supersession run ${index + 1}`).status !== "failed",
    )
  ) {
    throw new Error("failed integration wave is not terminal failed");
  }
  const evidence = input.supersession.evidence;
  if (
    !Array.isArray(evidence) ||
    !evidence.includes(`broad-gate-sha256:${sha256(input.broadGateContent)}`) ||
    !evidence.includes(
      `integration-result-sha256:${sha256(input.integrationResultContent)}`,
    )
  ) {
    throw new Error("failed integration supersession evidence drift");
  }
};
