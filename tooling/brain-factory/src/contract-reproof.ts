import { createHash } from "node:crypto";

import { validateFinalLaneResult } from "./lane-result.js";
import { validateProofContract } from "./proof.js";

export const CONTRACT_REPROOF_SCHEMA =
  "maestro-brain-contract-reproof/v1" as const;
export const CONTRACT_REPROOF_REFRESH_SCHEMA =
  "maestro-brain-contract-reproof-refresh/v2" as const;
export const CONTRACT_REPROOF_FINDINGS_SCHEMA =
  "maestro-brain-contract-reproof/v2" as const;
export const CONTRACT_REPROOF_FINDINGS_REFRESH_SCHEMA =
  "maestro-brain-contract-reproof-refresh/v3" as const;
export const CONTRACT_REPROOF_TERMINAL_REFRESH_SCHEMA =
  "maestro-brain-contract-reproof-terminal-refresh/v1" as const;

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
    | typeof CONTRACT_REPROOF_FINDINGS_SCHEMA
    | typeof CONTRACT_REPROOF_FINDINGS_REFRESH_SCHEMA
    | typeof CONTRACT_REPROOF_TERMINAL_REFRESH_SCHEMA;
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
  readonly authorityDeltaBaseSha?: string;
  readonly authorityDeltaPaths?: readonly string[];
  readonly currentControlHeadSha?: string;
  readonly terminalRunId?: string;
  readonly terminalRunStatus?: string;
  readonly terminalSourceHeadSha?: string;
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

const CONTRACT_REPROOF_FINDINGS_REFRESH_KEYS = [
  ...CONTRACT_REPROOF_REFRESH_KEYS,
  "findings",
] as const;

const CONTRACT_REPROOF_TERMINAL_REFRESH_KEYS = [
  ...CONTRACT_REPROOF_FINDINGS_KEYS,
  "authorityDeltaBaseSha",
  "authorityDeltaPaths",
  "currentControlHeadSha",
  "priorReproofFinalGatePath",
  "priorReproofFinalGateSha256",
  "priorReproofProofPath",
  "priorReproofProofSha256",
  "priorReproofRequestPath",
  "priorReproofRequestSha256",
  "terminalRunId",
  "terminalRunStatus",
  "terminalSourceHeadSha",
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

export const canonicalContractReproofFinding = (
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
    canonicalContractReproofFinding(finding, common.taskId),
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
          : schemaVersion === CONTRACT_REPROOF_FINDINGS_REFRESH_SCHEMA
            ? CONTRACT_REPROOF_FINDINGS_REFRESH_KEYS
            : schemaVersion === CONTRACT_REPROOF_TERMINAL_REFRESH_SCHEMA
              ? CONTRACT_REPROOF_TERMINAL_REFRESH_KEYS
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
      : request.schemaVersion === CONTRACT_REPROOF_FINDINGS_REFRESH_SCHEMA
        ? buildContractReproofFindingsRefreshRequest({
            ...request,
            findings: request.findings ?? [],
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
        : request.schemaVersion === CONTRACT_REPROOF_TERMINAL_REFRESH_SCHEMA
          ? buildTerminalContractReproofRefreshRequest({
              ...request,
              authorityDeltaBaseSha: String(
                request.authorityDeltaBaseSha ?? "",
              ),
              authorityDeltaPaths: request.authorityDeltaPaths ?? [],
              currentControlHeadSha: String(
                request.currentControlHeadSha ?? "",
              ),
              currentPlanSha256: request.planSha256,
              currentTaskBlockHash: request.taskBlockHash,
              currentTaskFileLocks: expected.fileLocks ?? [],
              finalGateContent: "",
              finalGatePath: String(request.priorReproofFinalGatePath ?? ""),
              finalGateReport: undefined,
              previousRequest: undefined,
              previousRequestContent: "",
              previousRequestPath: String(
                request.priorReproofRequestPath ?? "",
              ),
              proof: undefined,
              proofContent: "",
              proofPath: String(request.priorReproofProofPath ?? ""),
              reason: request.reason,
              taskId: request.taskId,
              terminalRunId: String(request.terminalRunId ?? ""),
              terminalRunStatus: String(request.terminalRunStatus ?? ""),
              terminalSourceHeadSha: String(
                request.terminalSourceHeadSha ?? "",
              ),
              trustedRequest: request,
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

const terminalAuthorityPath = (path: string): boolean =>
  path === ".fabro/workflows/brain-build-task/workflow.fabro" ||
  path ===
    "docs/superpowers/execution/maestro-brain/parallelism-contract.json" ||
  path === "docs/superpowers/execution/maestro-brain/task-manifest.json" ||
  path.startsWith("docs/superpowers/plans/") ||
  path.startsWith("docs/superpowers/specs/") ||
  path.startsWith("tooling/brain-factory/src/") ||
  path.startsWith("tooling/brain-factory/test/");

export const buildTerminalContractReproofRefreshRequest = (input: {
  readonly authorityDeltaBaseSha: string;
  readonly authorityDeltaPaths: readonly string[];
  readonly currentControlHeadSha: string;
  readonly currentPlanSha256: string;
  readonly currentTaskBlockHash: string;
  readonly currentTaskFileLocks: readonly string[];
  readonly finalGateContent: string;
  readonly finalGatePath: string;
  readonly finalGateReport: unknown;
  readonly previousRequest: unknown;
  readonly previousRequestContent: string;
  readonly previousRequestPath: string;
  readonly proof: unknown;
  readonly proofContent: string;
  readonly proofPath: string;
  readonly reason: string;
  readonly taskId: string;
  readonly terminalRunId: string;
  readonly terminalRunStatus: string;
  readonly terminalSourceHeadSha: string;
  readonly trustedRequest?: ContractReproofRequest;
}): ContractReproofRequest => {
  if (input.trustedRequest) {
    const request = input.trustedRequest;
    const common = buildContractReproofFindingsRequest({
      ...request,
      findings: request.findings ?? [],
    });
    const authorityDeltaPaths = [...(request.authorityDeltaPaths ?? [])].sort();
    const authorityDeltaBaseSha = exactSha(
      String(request.authorityDeltaBaseSha ?? ""),
      "authorityDeltaBaseSha",
      40,
    );
    if (
      authorityDeltaPaths.length === 0 ||
      new Set(authorityDeltaPaths).size !== authorityDeltaPaths.length ||
      authorityDeltaPaths.some(
        (path) =>
          !terminalAuthorityPath(path) ||
          input.currentTaskFileLocks.includes(path),
      )
    ) {
      throw new Error(`${request.taskId}: terminal authority delta is unsafe`);
    }
    const terminalRunId = String(request.terminalRunId ?? "");
    const terminalRunStatus = String(request.terminalRunStatus ?? "");
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(terminalRunId)) {
      throw new Error(`${request.taskId}: terminal run ID is invalid`);
    }
    if (
      !new Set(["canceled", "cancelled", "failed", "succeeded"]).has(
        terminalRunStatus,
      )
    ) {
      throw new Error(`${request.taskId}: terminal run status is not terminal`);
    }
    const payload = {
      ...common,
      schemaVersion: CONTRACT_REPROOF_TERMINAL_REFRESH_SCHEMA,
      authorityDeltaBaseSha,
      authorityDeltaPaths,
      currentControlHeadSha: exactSha(
        String(request.currentControlHeadSha ?? ""),
        "currentControlHeadSha",
        40,
      ),
      priorReproofFinalGatePath: nonEmptyPath(
        String(request.priorReproofFinalGatePath ?? ""),
        "priorReproofFinalGatePath",
      ),
      priorReproofFinalGateSha256: exactSha(
        String(request.priorReproofFinalGateSha256 ?? ""),
        "priorReproofFinalGateSha256",
        64,
      ),
      priorReproofProofPath: nonEmptyPath(
        String(request.priorReproofProofPath ?? ""),
        "priorReproofProofPath",
      ),
      priorReproofProofSha256: exactSha(
        String(request.priorReproofProofSha256 ?? ""),
        "priorReproofProofSha256",
        64,
      ),
      priorReproofRequestPath: nonEmptyPath(
        String(request.priorReproofRequestPath ?? ""),
        "priorReproofRequestPath",
      ),
      priorReproofRequestSha256: exactSha(
        String(request.priorReproofRequestSha256 ?? ""),
        "priorReproofRequestSha256",
        64,
      ),
      terminalRunId,
      terminalRunStatus,
      terminalSourceHeadSha: exactSha(
        String(request.terminalSourceHeadSha ?? ""),
        "terminalSourceHeadSha",
        40,
      ),
    };
    delete (payload as { requestSha256?: string }).requestSha256;
    return { ...payload, requestSha256: payloadHash(payload) };
  }
  const previousRecord = record(
    input.previousRequest,
    "terminal prior request",
  );
  const previous = validateContractReproofRequest(previousRecord, {
    controlHeadSha: String(previousRecord.controlHeadSha ?? ""),
    planSha256: String(previousRecord.planSha256 ?? ""),
    taskBlockHash: input.currentTaskBlockHash,
    taskId: input.taskId,
    fileLocks: input.currentTaskFileLocks,
  });
  const immediatelyPriorControlHeadSha =
    previous.schemaVersion === CONTRACT_REPROOF_TERMINAL_REFRESH_SCHEMA
      ? String(previous.currentControlHeadSha ?? "")
      : previous.controlHeadSha;
  const authorityDeltaBaseSha = exactSha(
    input.authorityDeltaBaseSha,
    "authorityDeltaBaseSha",
    40,
  );
  if (authorityDeltaBaseSha !== immediatelyPriorControlHeadSha) {
    throw new Error(
      `${input.taskId}: terminal delta does not bind immediately prior control authority`,
    );
  }
  const proof = record(input.proof, `${input.taskId}: terminal proof`);
  const gate = record(input.finalGateReport, `${input.taskId}: terminal gate`);
  const proofPlanSha256 = validateProofContract(proof, {
    taskBlockHash: input.currentTaskBlockHash,
    taskId: input.taskId,
  });
  const terminalSourceHeadSha = exactSha(
    input.terminalSourceHeadSha,
    "terminalSourceHeadSha",
    40,
  );
  if (
    proof.baseSha !== previous.controlHeadSha ||
    proofPlanSha256 !== previous.planSha256 ||
    proof.headSha !== terminalSourceHeadSha ||
    proof.reviewHeadSha !== terminalSourceHeadSha ||
    gate.schemaVersion !== "maestro-brain-lane-gate/v1" ||
    gate.taskId !== input.taskId ||
    gate.headSha !== terminalSourceHeadSha ||
    gate.currentHeadSha !== terminalSourceHeadSha ||
    gate.planSha256 !== previous.planSha256 ||
    gate.taskBlockHash !== input.currentTaskBlockHash ||
    gate.status !== "passed" ||
    !(
      (gate.stage === "pre-review" &&
        new Set(["pending", "rework"]).has(String(proof.reviewVerdict))) ||
      (gate.stage === "final" && proof.reviewVerdict === "pass")
    )
  ) {
    throw new Error(`${input.taskId}: terminal proof or gate lineage drift`);
  }
  for (const [content, parsed, label] of [
    [input.previousRequestContent, previousRecord, "request"],
    [input.proofContent, proof, "proof"],
    [input.finalGateContent, gate, "gate"],
  ] as const) {
    if (JSON.stringify(JSON.parse(content)) !== JSON.stringify(parsed)) {
      throw new Error(`${input.taskId}: terminal ${label} content drift`);
    }
  }
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(input.terminalRunId)) {
    throw new Error(`${input.taskId}: terminal run ID is invalid`);
  }
  if (
    !new Set(["canceled", "cancelled", "failed", "succeeded"]).has(
      input.terminalRunStatus,
    )
  ) {
    throw new Error(`${input.taskId}: terminal run status is not terminal`);
  }
  const authorityDeltaPaths = [...input.authorityDeltaPaths].sort();
  if (
    authorityDeltaPaths.length === 0 ||
    new Set(authorityDeltaPaths).size !== authorityDeltaPaths.length ||
    authorityDeltaPaths.some(
      (path) =>
        !terminalAuthorityPath(path) ||
        input.currentTaskFileLocks.includes(path),
    )
  ) {
    throw new Error(`${input.taskId}: terminal authority delta is unsafe`);
  }
  const common = buildContractReproofFindingsRequest({
    ...previous,
    controlHeadSha: previous.controlHeadSha,
    planSha256: input.currentPlanSha256,
    taskBlockHash: input.currentTaskBlockHash,
    findings: previous.findings ?? [],
    reason: input.reason,
  });
  const payload = {
    ...common,
    schemaVersion: CONTRACT_REPROOF_TERMINAL_REFRESH_SCHEMA,
    authorityDeltaBaseSha,
    authorityDeltaPaths,
    currentControlHeadSha: exactSha(
      input.currentControlHeadSha,
      "currentControlHeadSha",
      40,
    ),
    priorReproofFinalGatePath: nonEmptyPath(
      input.finalGatePath,
      "priorReproofFinalGatePath",
    ),
    priorReproofFinalGateSha256: sha256(input.finalGateContent),
    priorReproofProofPath: nonEmptyPath(
      input.proofPath,
      "priorReproofProofPath",
    ),
    priorReproofProofSha256: sha256(input.proofContent),
    priorReproofRequestPath: nonEmptyPath(
      input.previousRequestPath,
      "priorReproofRequestPath",
    ),
    priorReproofRequestSha256: sha256(input.previousRequestContent),
    terminalRunId: input.terminalRunId,
    terminalRunStatus: input.terminalRunStatus,
    terminalSourceHeadSha,
  };
  delete (payload as { requestSha256?: string }).requestSha256;
  return { ...payload, requestSha256: payloadHash(payload) };
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

const validateSupplementalCommandResults = (
  value: unknown,
  taskId: string,
): void => {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.some((entry) => {
      const item = record(entry, `${taskId}: supplemental command result`);
      exactObjectKeys(
        item,
        ["command", "result"],
        `${taskId}: supplemental command result`,
      );
      return (
        typeof item.command !== "string" ||
        item.command.length === 0 ||
        typeof item.result !== "string" ||
        item.result.length === 0
      );
    })
  ) {
    throw new Error(`${taskId}: supplemental command results are invalid`);
  }
};

const validateProofSourceSlices = (value: unknown, taskId: string): void => {
  if (value === undefined) return;
  const commits = new Set<string>();
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => {
      const item = record(entry, `${taskId}: source slice`);
      exactObjectKeys(
        item,
        ["commit", "changedHandAuthoredSourceLines"],
        `${taskId}: source slice`,
      );
      if (typeof item.commit === "string") commits.add(item.commit);
      return (
        typeof item.commit !== "string" ||
        !/^[0-9a-f]{40}$/.test(item.commit) ||
        !Number.isInteger(item.changedHandAuthoredSourceLines) ||
        Number(item.changedHandAuthoredSourceLines) < 0
      );
    }) ||
    commits.size !== value.length
  ) {
    throw new Error(`${taskId}: source slices are invalid`);
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

export const buildContractReproofFindingsRefreshRequest = (
  input: Omit<ContractReproofRequest, "requestSha256" | "schemaVersion"> & {
    readonly findings: readonly ContractReproofFinding[];
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
  const findingsRequest = buildContractReproofFindingsRequest(input);
  const legacyRefresh = buildContractReproofRefreshRequest(input);
  const payload = {
    schemaVersion: CONTRACT_REPROOF_FINDINGS_REFRESH_SCHEMA,
    taskId: legacyRefresh.taskId,
    reason: legacyRefresh.reason,
    controlHeadSha: legacyRefresh.controlHeadSha,
    planSha256: legacyRefresh.planSha256,
    taskBlockHash: legacyRefresh.taskBlockHash,
    priorIntegrationId: legacyRefresh.priorIntegrationId,
    priorIntegrationHeadSha: legacyRefresh.priorIntegrationHeadSha,
    priorIntegrationResultSha256: legacyRefresh.priorIntegrationResultSha256,
    priorLaneResultSha256: legacyRefresh.priorLaneResultSha256,
    priorArchiveSha256: legacyRefresh.priorArchiveSha256,
    priorEvidencePath: legacyRefresh.priorEvidencePath,
    priorReproofRequestPath: input.priorReproofRequestPath,
    priorReproofRequestSha256: input.priorReproofRequestSha256,
    priorReproofLaneResultPath: input.priorReproofLaneResultPath,
    priorReproofLaneResultSha256: input.priorReproofLaneResultSha256,
    priorReproofProofPath: input.priorReproofProofPath,
    priorReproofProofSha256: input.priorReproofProofSha256,
    priorReproofFinalGatePath: input.priorReproofFinalGatePath,
    priorReproofFinalGateSha256: input.priorReproofFinalGateSha256,
    priorReproofSourceHeadSha: input.priorReproofSourceHeadSha,
    findings: findingsRequest.findings ?? [],
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
      "priorFindingDispositions",
      "resolvedPriorFindingIds",
      "reviewFindings",
      "reviewHeadSha",
      "reviewVerdict",
      "schemaVersion",
      "sourceSlices",
      "supplementalCommandResults",
      "taskBlockHash",
      "taskId",
      "testsAdded",
    ],
    `${input.taskId}: prior reproof proof`,
  );
  validateSupplementalCommandResults(
    proof.supplementalCommandResults,
    input.taskId,
  );
  validateProofSourceSlices(proof.sourceSlices, input.taskId);
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
  if (previous.findings) {
    if (
      !Array.isArray(proof.priorFindingDispositions) ||
      !Array.isArray(proof.resolvedPriorFindingIds)
    ) {
      throw new Error(`${input.taskId}: prior finding closure is missing`);
    }
    const expectedFindingIds = previous.findings.map(({ id }) => id).sort();
    const resolvedFindingIds = proof.resolvedPriorFindingIds.map(String).sort();
    if (
      JSON.stringify(resolvedFindingIds) !== JSON.stringify(expectedFindingIds)
    ) {
      throw new Error(`${input.taskId}: prior finding closure drift`);
    }
    const dispositions = proof.priorFindingDispositions.map((value, index) =>
      record(value, `${input.taskId}: prior finding disposition ${index + 1}`),
    );
    const dispositionFindingIds = dispositions
      .map((candidate) => String(candidate.findingId ?? ""))
      .sort();
    if (
      JSON.stringify(dispositionFindingIds) !==
      JSON.stringify(expectedFindingIds)
    ) {
      throw new Error(`${input.taskId}: prior finding closure drift`);
    }
    for (const findingId of expectedFindingIds) {
      const disposition = dispositions.find(
        (candidate) => candidate.findingId === findingId,
      );
      if (!disposition || disposition.status !== "resolved") {
        throw new Error(`${input.taskId}: prior finding closure drift`);
      }
    }
  }
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
  const refreshInput = {
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
  };
  return previous.findings
    ? buildContractReproofFindingsRefreshRequest({
        ...refreshInput,
        findings: previous.findings,
      })
    : buildContractReproofRefreshRequest(refreshInput);
};
