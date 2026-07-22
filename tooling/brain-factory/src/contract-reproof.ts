import { createHash } from "node:crypto";

import { validateFinalLaneResult } from "./lane-result.js";
import { validateProofContract } from "./proof.js";

export const CONTRACT_REPROOF_SCHEMA =
  "maestro-brain-contract-reproof/v1" as const;
export const CONTRACT_REPROOF_REFRESH_SCHEMA =
  "maestro-brain-contract-reproof-refresh/v2" as const;
export const CONTRACT_REPROOF_FINDINGS_SCHEMA =
  "maestro-brain-contract-reproof/v2" as const;

export interface ContractReproofFinding {
  readonly id: string;
  readonly taskId: string;
  readonly candidateHeadSha: string;
  readonly summary: string;
  readonly details: string;
  readonly severity: string;
  readonly affectedPaths: readonly string[];
  readonly expectedBehavior: string;
  readonly requiredRegressionProof: string;
  readonly priorEvidenceSha256: readonly string[];
  readonly changeExpectation: "source_or_test_delta" | "evidence_only";
  readonly evidenceOnlyRationale?: string;
}

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
  readonly schemaVersion:
    | typeof CONTRACT_REPROOF_SCHEMA
    | typeof CONTRACT_REPROOF_REFRESH_SCHEMA
    | typeof CONTRACT_REPROOF_FINDINGS_SCHEMA;
  readonly taskBlockHash: string;
  readonly taskId: string;
  readonly priorReproofFinalGatePath?: string;
  readonly priorReproofFinalGateSha256?: string;
  readonly priorReproofLaneResultPath?: string;
  readonly priorReproofLaneResultSha256?: string;
  readonly priorReproofProofPath?: string;
  readonly priorReproofProofSha256?: string;
  readonly priorReproofRequestPath?: string;
  readonly priorReproofRequestSha256?: string;
  readonly priorReproofSourceHeadSha?: string;
  readonly findings?: readonly ContractReproofFinding[];
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

const CONTRACT_REPROOF_REFRESH_KEYS = [
  ...CONTRACT_REPROOF_KEYS,
  "priorReproofFinalGatePath",
  "priorReproofFinalGateSha256",
  "priorReproofLaneResultPath",
  "priorReproofLaneResultSha256",
  "priorReproofProofPath",
  "priorReproofProofSha256",
  "priorReproofRequestPath",
  "priorReproofRequestSha256",
  "priorReproofSourceHeadSha",
] as const;

const CONTRACT_REPROOF_FINDINGS_KEYS = [
  ...CONTRACT_REPROOF_KEYS,
  "findings",
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

const nonEmptyPath = (value: string, label: string): string => {
  if (!value) throw new Error(`${label} must not be empty`);
  return value;
};

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

const nonEmptyString = (value: string, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
};

const canonicalFinding = (
  value: ContractReproofFinding,
  taskId: string,
): ContractReproofFinding => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("contract reproof finding must be an object");
  }
  const allowedKeys = new Set([
    "id",
    "taskId",
    "candidateHeadSha",
    "summary",
    "details",
    "severity",
    "affectedPaths",
    "expectedBehavior",
    "requiredRegressionProof",
    "priorEvidenceSha256",
    "changeExpectation",
    "evidenceOnlyRationale",
  ]);
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !allowedKeys.has(key),
    )
  ) {
    throw new Error("contract reproof finding has unknown fields");
  }
  if (value.taskId !== taskId) throw new Error(`${value.id}: task mismatch`);
  if (!Array.isArray(value.priorEvidenceSha256)) {
    throw new Error(`${value.id}: priorEvidenceSha256 must be an array`);
  }
  const priorEvidenceSha256 = value.priorEvidenceSha256.map((digest) =>
    exactSha(digest, `${value.id}: priorEvidenceSha256`, 64),
  );
  if (priorEvidenceSha256.length === 0) {
    throw new Error(`${value.id}: priorEvidenceSha256 must not be empty`);
  }
  if (new Set(priorEvidenceSha256).size !== priorEvidenceSha256.length) {
    throw new Error(`${value.id}: duplicate prior evidence hash`);
  }
  if (!Array.isArray(value.affectedPaths) || value.affectedPaths.length === 0) {
    throw new Error(`${value.id}: affectedPaths must not be empty`);
  }
  const affectedPaths = value.affectedPaths.map((path) =>
    nonEmptyString(path, `${value.id}: affectedPath`),
  );
  if (new Set(affectedPaths).size !== affectedPaths.length) {
    throw new Error(`${value.id}: duplicate affected path`);
  }
  if (
    value.changeExpectation !== "source_or_test_delta" &&
    value.changeExpectation !== "evidence_only"
  ) {
    throw new Error(`${value.id}: invalid changeExpectation`);
  }
  const evidenceOnlyRationale = value.evidenceOnlyRationale?.trim();
  if (value.changeExpectation === "evidence_only" && !evidenceOnlyRationale) {
    throw new Error(`${value.id}: evidenceOnlyRationale is required`);
  }
  return {
    id: nonEmptyString(value.id, "finding id"),
    taskId: value.taskId,
    candidateHeadSha: exactSha(
      value.candidateHeadSha,
      `${value.id}: candidateHeadSha`,
      40,
    ),
    summary: nonEmptyString(value.summary, `${value.id}: summary`),
    details: nonEmptyString(value.details, `${value.id}: details`),
    severity: nonEmptyString(value.severity, `${value.id}: severity`),
    affectedPaths: [...affectedPaths].sort(),
    expectedBehavior: nonEmptyString(
      value.expectedBehavior,
      `${value.id}: expectedBehavior`,
    ),
    requiredRegressionProof: nonEmptyString(
      value.requiredRegressionProof,
      `${value.id}: requiredRegressionProof`,
    ),
    priorEvidenceSha256: [...priorEvidenceSha256].sort(),
    changeExpectation: value.changeExpectation,
    ...(evidenceOnlyRationale ? { evidenceOnlyRationale } : {}),
  };
};

export const buildContractReproofFindingsRequest = (
  input: Omit<
    ContractReproofRequest,
    "findings" | "requestSha256" | "schemaVersion"
  > & {
    readonly findings: readonly ContractReproofFinding[];
  },
): ContractReproofRequest => {
  const common = buildContractReproofRequest(input);
  if (!Array.isArray(input.findings) || input.findings.length === 0) {
    throw new Error("finding-bound reproof requires findings");
  }
  const findings = input.findings.map((finding) =>
    canonicalFinding(finding, common.taskId),
  );
  if (new Set(findings.map(({ id }) => id)).size !== findings.length) {
    throw new Error("duplicate finding ID");
  }
  findings.sort((left, right) => (left.id < right.id ? -1 : 1));
  const payload = {
    schemaVersion: CONTRACT_REPROOF_FINDINGS_SCHEMA,
    taskId: common.taskId,
    reason: common.reason,
    controlHeadSha: common.controlHeadSha,
    planSha256: common.planSha256,
    taskBlockHash: common.taskBlockHash,
    priorIntegrationId: common.priorIntegrationId,
    priorIntegrationHeadSha: common.priorIntegrationHeadSha,
    priorIntegrationResultSha256: common.priorIntegrationResultSha256,
    priorLaneResultSha256: common.priorLaneResultSha256,
    priorArchiveSha256: common.priorArchiveSha256,
    priorEvidencePath: common.priorEvidencePath,
    findings,
  } satisfies ReproofPayload;
  return { ...payload, requestSha256: payloadHash(payload) };
};

export const validateContractReproofRequest = (
  value: unknown,
  expected: {
    readonly controlHeadSha: string;
    readonly planSha256: string;
    readonly taskBlockHash: string;
    readonly taskId: string;
    readonly fileLocks?: readonly string[];
  },
): ContractReproofRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("contract reproof request must be an object");
  }
  const schemaVersion = (value as Record<string, unknown>).schemaVersion;
  const expectedKeys =
    schemaVersion === CONTRACT_REPROOF_SCHEMA
      ? CONTRACT_REPROOF_KEYS
      : schemaVersion === CONTRACT_REPROOF_REFRESH_SCHEMA
        ? CONTRACT_REPROOF_REFRESH_KEYS
        : schemaVersion === CONTRACT_REPROOF_FINDINGS_SCHEMA
          ? CONTRACT_REPROOF_FINDINGS_KEYS
          : undefined;
  if (!expectedKeys) throw new Error("unexpected contract reproof schema");
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        !(expectedKeys as readonly string[]).includes(key),
    )
  ) {
    throw new Error("contract reproof request has unknown fields");
  }
  const request = value as unknown as ContractReproofRequest;
  const rebuilt =
    request.schemaVersion === CONTRACT_REPROOF_REFRESH_SCHEMA
      ? buildContractReproofRefreshRequest({
          ...request,
          priorReproofFinalGatePath: String(
            request.priorReproofFinalGatePath ?? "",
          ),
          priorReproofFinalGateSha256: String(
            request.priorReproofFinalGateSha256 ?? "",
          ),
          priorReproofLaneResultPath: String(
            request.priorReproofLaneResultPath ?? "",
          ),
          priorReproofLaneResultSha256: String(
            request.priorReproofLaneResultSha256 ?? "",
          ),
          priorReproofProofPath: String(request.priorReproofProofPath ?? ""),
          priorReproofProofSha256: String(
            request.priorReproofProofSha256 ?? "",
          ),
          priorReproofRequestPath: String(
            request.priorReproofRequestPath ?? "",
          ),
          priorReproofRequestSha256: String(
            request.priorReproofRequestSha256 ?? "",
          ),
          priorReproofSourceHeadSha: String(
            request.priorReproofSourceHeadSha ?? "",
          ),
        })
      : request.schemaVersion === CONTRACT_REPROOF_FINDINGS_SCHEMA
        ? buildContractReproofFindingsRequest({
            ...request,
            findings: request.findings ?? [],
          })
        : buildContractReproofRequest(request);
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
  if (request.findings && expected.fileLocks) {
    const ownedPaths = new Set(expected.fileLocks);
    for (const finding of request.findings) {
      for (const path of finding.affectedPaths) {
        if (!ownedPaths.has(path)) {
          throw new Error(
            `${finding.id}: affected path is outside owner locks`,
          );
        }
      }
    }
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

const rejectUnknownObjectKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void => {
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !allowed.includes(key),
    )
  ) {
    throw new Error(`${label} has unknown fields`);
  }
};

export const buildContractReproofRefreshRequest = (
  input: Omit<ContractReproofRequest, "requestSha256" | "schemaVersion"> & {
    readonly priorReproofFinalGatePath: string;
    readonly priorReproofFinalGateSha256: string;
    readonly priorReproofLaneResultPath: string;
    readonly priorReproofLaneResultSha256: string;
    readonly priorReproofProofPath: string;
    readonly priorReproofProofSha256: string;
    readonly priorReproofRequestPath: string;
    readonly priorReproofRequestSha256: string;
    readonly priorReproofSourceHeadSha: string;
  },
): ContractReproofRequest => {
  const common = buildContractReproofRequest(input);
  const commonPayload = {
    schemaVersion: common.schemaVersion,
    taskId: common.taskId,
    reason: common.reason,
    controlHeadSha: common.controlHeadSha,
    planSha256: common.planSha256,
    taskBlockHash: common.taskBlockHash,
    priorIntegrationId: common.priorIntegrationId,
    priorIntegrationHeadSha: common.priorIntegrationHeadSha,
    priorIntegrationResultSha256: common.priorIntegrationResultSha256,
    priorLaneResultSha256: common.priorLaneResultSha256,
    priorArchiveSha256: common.priorArchiveSha256,
    priorEvidencePath: common.priorEvidencePath,
  };
  const payload = {
    ...commonPayload,
    schemaVersion: CONTRACT_REPROOF_REFRESH_SCHEMA,
    priorReproofRequestPath: nonEmptyPath(
      input.priorReproofRequestPath,
      "priorReproofRequestPath",
    ),
    priorReproofRequestSha256: exactSha(
      input.priorReproofRequestSha256,
      "priorReproofRequestSha256",
      64,
    ),
    priorReproofLaneResultPath: nonEmptyPath(
      input.priorReproofLaneResultPath,
      "priorReproofLaneResultPath",
    ),
    priorReproofLaneResultSha256: exactSha(
      input.priorReproofLaneResultSha256,
      "priorReproofLaneResultSha256",
      64,
    ),
    priorReproofProofPath: nonEmptyPath(
      input.priorReproofProofPath,
      "priorReproofProofPath",
    ),
    priorReproofProofSha256: exactSha(
      input.priorReproofProofSha256,
      "priorReproofProofSha256",
      64,
    ),
    priorReproofFinalGatePath: nonEmptyPath(
      input.priorReproofFinalGatePath,
      "priorReproofFinalGatePath",
    ),
    priorReproofFinalGateSha256: exactSha(
      input.priorReproofFinalGateSha256,
      "priorReproofFinalGateSha256",
      64,
    ),
    priorReproofSourceHeadSha: exactSha(
      input.priorReproofSourceHeadSha,
      "priorReproofSourceHeadSha",
      40,
    ),
  } satisfies ReproofPayload;
  return { ...payload, requestSha256: payloadHash(payload) };
};

export const buildRefreshedContractReproofRequest = (input: {
  readonly currentControlHeadSha: string;
  readonly currentPlanSha256: string;
  readonly currentTaskBlockHash: string;
  readonly finalGateReport: unknown;
  readonly finalGateContent: string;
  readonly finalGatePath: string;
  readonly lane: unknown;
  readonly laneContent: string;
  readonly lanePath: string;
  readonly laneTreeSha: string;
  readonly previousRequest: unknown;
  readonly previousRequestContent: string;
  readonly previousRequestPath: string;
  readonly proof: unknown;
  readonly proofContent: string;
  readonly proofPath: string;
  readonly priorReproofSourceHeadSha: string;
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
  rejectUnknownObjectKeys(
    lane,
    [
      "headSha",
      "reproof",
      "schemaVersion",
      "status",
      "taskId",
      "tranche",
      "treeSha",
    ],
    `${input.taskId}: prior reproof lane`,
  );
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
    laneReproof.requestPath !== input.previousRequestPath ||
    laneReproof.priorIntegrationId !== previous.priorIntegrationId ||
    laneReproof.priorIntegrationHeadSha !== previous.priorIntegrationHeadSha
  ) {
    throw new Error(`${input.taskId}: lane reproof lineage drift`);
  }
  const proof = record(input.proof, `${input.taskId}: prior reproof proof`);
  rejectUnknownObjectKeys(
    proof,
    [
      "baseSha",
      "changedFiles",
      "commandResults",
      "focusedCommands",
      "headSha",
      "knownRisks",
      "planSha256",
      "reviewFindings",
      "reviewHeadSha",
      "reviewVerdict",
      "schemaVersion",
      "taskBlockHash",
      "taskId",
      "testsAdded",
    ],
    `${input.taskId}: prior reproof proof`,
  );
  const finalGate = record(
    input.finalGateReport,
    `${input.taskId}: prior reproof final gate`,
  );
  rejectUnknownObjectKeys(
    finalGate,
    [
      "changedSourceLines",
      "commandSetHash",
      "commands",
      "currentHeadSha",
      "currentTreeSha",
      "estimatedSourceLines",
      "estimateDrift",
      "gateProfiles",
      "headSha",
      "planSha256",
      "reusedPreReview",
      "schemaVersion",
      "sourceSliceBudget",
      "sourceSliceLimit",
      "sourceSlices",
      "stage",
      "status",
      "taskBlockHash",
      "taskId",
    ],
    `${input.taskId}: prior reproof final gate`,
  );
  const proofPlanSha256 = validateProofContract(proof, {
    taskBlockHash: input.currentTaskBlockHash,
    taskId: input.taskId,
  });
  validateFinalLaneResult(lane, {
    allowHistoricalMissingTreeSha: true,
    currentHeadSha: String(lane.headSha ?? ""),
    currentTreeSha: input.laneTreeSha,
    finalGateReport: finalGate,
    proof,
    taskId: input.taskId,
  });
  if (
    proof.baseSha !== previous.controlHeadSha ||
    proofPlanSha256 !== previous.planSha256
  ) {
    throw new Error(`${input.taskId}: proof does not bind prior request`);
  }
  if (
    input.priorReproofSourceHeadSha !== lane.headSha ||
    proof.headSha !== input.priorReproofSourceHeadSha ||
    finalGate.headSha !== input.priorReproofSourceHeadSha
  ) {
    throw new Error(`${input.taskId}: prior reproof source head drift`);
  }
  for (const [content, parsed, label] of [
    [input.previousRequestContent, previousRecord, "request"],
    [input.laneContent, lane, "lane"],
    [input.proofContent, proof, "proof"],
    [input.finalGateContent, finalGate, "final gate"],
  ] as const) {
    if (JSON.stringify(JSON.parse(content)) !== JSON.stringify(parsed)) {
      throw new Error(`${input.taskId}: prior reproof ${label} content drift`);
    }
  }
  return buildContractReproofRefreshRequest({
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
    priorReproofFinalGatePath: input.finalGatePath,
    priorReproofFinalGateSha256: sha256(input.finalGateContent),
    priorReproofLaneResultPath: input.lanePath,
    priorReproofLaneResultSha256: sha256(input.laneContent),
    priorReproofProofPath: input.proofPath,
    priorReproofProofSha256: sha256(input.proofContent),
    priorReproofRequestPath: input.previousRequestPath,
    priorReproofRequestSha256: sha256(input.previousRequestContent),
    priorReproofSourceHeadSha: input.priorReproofSourceHeadSha,
  });
};
