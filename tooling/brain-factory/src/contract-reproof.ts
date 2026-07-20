import { createHash } from "node:crypto";

import { validateFinalLaneResult } from "./lane-result.js";
import { validateProofContract } from "./proof.js";

export const CONTRACT_REPROOF_SCHEMA =
  "maestro-brain-contract-reproof/v1" as const;

export interface ContractReproofRequest {
  readonly controlHeadSha: string;
  readonly planSha256: string;
  readonly priorArchiveSha256: string;
  readonly priorIntegrationHeadSha: string;
  readonly priorIntegrationId: string;
  readonly priorIntegrationResultSha256: string;
  readonly priorLaneResultSha256: string;
  readonly priorEvidencePath: string;
  readonly reason: string;
  readonly requestSha256: string;
  readonly schemaVersion: typeof CONTRACT_REPROOF_SCHEMA;
  readonly taskBlockHash: string;
  readonly taskId: string;
}

type ReproofPayload = Omit<ContractReproofRequest, "requestSha256">;

const CONTRACT_REPROOF_KEYS = [
  "controlHeadSha",
  "planSha256",
  "priorArchiveSha256",
  "priorEvidencePath",
  "priorIntegrationHeadSha",
  "priorIntegrationId",
  "priorIntegrationResultSha256",
  "priorLaneResultSha256",
  "reason",
  "requestSha256",
  "schemaVersion",
  "taskBlockHash",
  "taskId",
] as const;

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const exactSha = (value: string, label: string, length: 40 | 64): string => {
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw new Error(`${label} must be an exact ${length}-character SHA`);
  }
  return value;
};

const safeSegment = (value: string, label: string): string => {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`${label} is not a safe segment`);
  }
  return value;
};

const payloadHash = (payload: ReproofPayload): string =>
  sha256(JSON.stringify(payload));

export const buildContractReproofRequest = (input: {
  readonly controlHeadSha: string;
  readonly planSha256: string;
  readonly priorArchiveSha256: string;
  readonly priorIntegrationHeadSha: string;
  readonly priorIntegrationId: string;
  readonly priorIntegrationResultSha256: string;
  readonly priorLaneResultSha256: string;
  readonly priorEvidencePath: string;
  readonly reason: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
}): ContractReproofRequest => {
  const payload = {
    schemaVersion: CONTRACT_REPROOF_SCHEMA,
    taskId: safeSegment(input.taskId, "taskId"),
    reason: input.reason.trim(),
    controlHeadSha: exactSha(input.controlHeadSha, "controlHeadSha", 40),
    planSha256: exactSha(input.planSha256, "planSha256", 64),
    taskBlockHash: exactSha(input.taskBlockHash, "taskBlockHash", 64),
    priorIntegrationId: safeSegment(
      input.priorIntegrationId,
      "priorIntegrationId",
    ),
    priorIntegrationHeadSha: exactSha(
      input.priorIntegrationHeadSha,
      "priorIntegrationHeadSha",
      40,
    ),
    priorIntegrationResultSha256: exactSha(
      input.priorIntegrationResultSha256,
      "priorIntegrationResultSha256",
      64,
    ),
    priorLaneResultSha256: exactSha(
      input.priorLaneResultSha256,
      "priorLaneResultSha256",
      64,
    ),
    priorArchiveSha256: exactSha(
      input.priorArchiveSha256,
      "priorArchiveSha256",
      64,
    ),
    priorEvidencePath: input.priorEvidencePath,
  } satisfies ReproofPayload;
  if (!payload.reason) throw new Error("reproof reason must not be empty");
  if (!payload.priorEvidencePath) {
    throw new Error("priorEvidencePath must not be empty");
  }
  return { ...payload, requestSha256: payloadHash(payload) };
};

export const validateContractReproofRequest = (
  value: unknown,
  expected: {
    readonly controlHeadSha: string;
    readonly planSha256: string;
    readonly taskBlockHash: string;
    readonly taskId: string;
  },
): ContractReproofRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("contract reproof request must be an object");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== CONTRACT_REPROOF_KEYS.length ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        !CONTRACT_REPROOF_KEYS.includes(
          key as (typeof CONTRACT_REPROOF_KEYS)[number],
        ),
    )
  ) {
    throw new Error("contract reproof request has unknown fields");
  }
  const request = value as unknown as ContractReproofRequest;
  const rebuilt = buildContractReproofRequest(request);
  if (request.schemaVersion !== CONTRACT_REPROOF_SCHEMA) {
    throw new Error("unexpected contract reproof schema");
  }
  if (request.requestSha256 !== rebuilt.requestSha256) {
    throw new Error("contract reproof request hash mismatch");
  }
  if (
    request.taskId !== expected.taskId ||
    request.controlHeadSha !== expected.controlHeadSha ||
    request.planSha256 !== expected.planSha256 ||
    request.taskBlockHash !== expected.taskBlockHash
  ) {
    throw new Error("contract reproof request does not bind current authority");
  }
  return rebuilt;
};

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const exactObjectKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void => {
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    throw new Error(`${label} has unknown fields`);
  }
};

export const buildRefreshedContractReproofRequest = (input: {
  readonly currentControlHeadSha: string;
  readonly currentPlanSha256: string;
  readonly currentTaskBlockHash: string;
  readonly finalGateReport: unknown;
  readonly lane: unknown;
  readonly laneTreeSha: string;
  readonly previousRequest: unknown;
  readonly proof: unknown;
  readonly reason: string;
  readonly taskId: string;
}): ContractReproofRequest => {
  const previousRecord = record(input.previousRequest, "prior reproof request");
  const previous = validateContractReproofRequest(previousRecord, {
    controlHeadSha: String(previousRecord.controlHeadSha ?? ""),
    planSha256: String(previousRecord.planSha256 ?? ""),
    taskBlockHash: input.currentTaskBlockHash,
    taskId: input.taskId,
  });
  const lane = record(input.lane, `${input.taskId}: prior reproof lane`);
  const laneReproof = record(
    lane.reproof,
    `${input.taskId}: prior lane reproof lineage`,
  );
  exactObjectKeys(
    laneReproof,
    [
      "priorIntegrationHeadSha",
      "priorIntegrationId",
      "requestPath",
      "requestSha256",
    ],
    `${input.taskId}: prior lane reproof lineage`,
  );
  if (
    laneReproof.requestSha256 !== previous.requestSha256 ||
    laneReproof.priorIntegrationId !== previous.priorIntegrationId ||
    laneReproof.priorIntegrationHeadSha !== previous.priorIntegrationHeadSha
  ) {
    throw new Error(`${input.taskId}: lane reproof lineage drift`);
  }
  const proof = record(input.proof, `${input.taskId}: prior reproof proof`);
  const proofPlanSha256 = validateProofContract(proof, {
    taskBlockHash: input.currentTaskBlockHash,
    taskId: input.taskId,
  });
  validateFinalLaneResult(lane, {
    allowHistoricalMissingTreeSha: true,
    currentHeadSha: String(lane.headSha ?? ""),
    currentTreeSha: input.laneTreeSha,
    finalGateReport: input.finalGateReport,
    proof,
    taskId: input.taskId,
  });
  if (
    proof.baseSha !== previous.controlHeadSha ||
    proofPlanSha256 !== previous.planSha256
  ) {
    throw new Error(`${input.taskId}: proof does not bind prior request`);
  }
  return buildContractReproofRequest({
    controlHeadSha: input.currentControlHeadSha,
    planSha256: input.currentPlanSha256,
    priorArchiveSha256: previous.priorArchiveSha256,
    priorEvidencePath: previous.priorEvidencePath,
    priorIntegrationHeadSha: previous.priorIntegrationHeadSha,
    priorIntegrationId: previous.priorIntegrationId,
    priorIntegrationResultSha256: previous.priorIntegrationResultSha256,
    priorLaneResultSha256: previous.priorLaneResultSha256,
    reason: input.reason,
    taskBlockHash: input.currentTaskBlockHash,
    taskId: input.taskId,
  });
};
