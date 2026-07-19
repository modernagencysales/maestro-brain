import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  validateContractReproofRequest,
  type ContractReproofRequest,
} from "./contract-reproof.js";
import { validateLaneAcceptance } from "./lane-acceptance.js";

export interface ContractReproofAdmissionInput {
  readonly changedFilesBetween: (
    ancestor: string,
    descendant: string,
  ) => readonly string[];
  readonly currentControlHead: string;
  readonly evidenceDirectory: string;
  readonly fileLocks: readonly string[];
  readonly isAncestor: (ancestor: string, descendant: string) => boolean;
  readonly lanePriorIntegrationHeadSha: unknown;
  readonly lanePriorIntegrationId: unknown;
  readonly laneRequestSha256: unknown;
  readonly planSha256: string;
  readonly proofBaseSha: string;
  readonly requestPath: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
}

export interface ContractReproofAdmission {
  readonly reproofRequestSha256: string;
  readonly request: ContractReproofRequest;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const parseRecord = (content: string, label: string): Record<string, unknown> =>
  record(JSON.parse(content), label);

const containedRealFile = (
  evidenceRoot: string,
  candidate: string,
  label: string,
): string => {
  const path = realpathSync(candidate);
  const relativePath = relative(evidenceRoot, path);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} is outside evidence`);
  }
  return path;
};

const exactTaskLockIntersections = (
  changedFiles: readonly string[],
  fileLocks: readonly string[],
): string[] => {
  const exactLocks = new Set(fileLocks.filter((lock) => !lock.startsWith("@")));
  return [
    ...new Set(changedFiles.filter((file) => exactLocks.has(file))),
  ].sort();
};

const controlOnlyDelta = (changedFiles: readonly string[]): boolean =>
  changedFiles.every(
    (file) =>
      file === "package.json" ||
      file.startsWith("docs/superpowers/execution/maestro-brain/") ||
      file.startsWith(".superpowers/sdd/") ||
      file.startsWith(".fabro/workflows/") ||
      file.startsWith("tooling/brain-factory/"),
  );

const canonicalJsonSha256 = (value: unknown): string =>
  sha256(`${JSON.stringify(value, null, 2)}\n`);

export const admitContractReproof = (
  input: ContractReproofAdmissionInput,
): ContractReproofAdmission => {
  const evidenceRoot = realpathSync(input.evidenceDirectory);
  const requestPath = containedRealFile(
    evidenceRoot,
    input.requestPath,
    `${input.taskId}: reproof request`,
  );
  const requestContent = readFileSync(requestPath, "utf8");
  const request = validateContractReproofRequest(
    JSON.parse(requestContent) as unknown,
    {
      controlHeadSha: input.proofBaseSha,
      planSha256: input.planSha256,
      taskBlockHash: input.taskBlockHash,
      taskId: input.taskId,
    },
  );

  if (input.laneRequestSha256 !== request.requestSha256) {
    throw new Error(`${input.taskId}: reproof payload binding drift`);
  }
  if (
    input.lanePriorIntegrationId !== request.priorIntegrationId ||
    input.lanePriorIntegrationHeadSha !== request.priorIntegrationHeadSha
  ) {
    throw new Error(`${input.taskId}: lane reproof lineage drift`);
  }
  if (
    !input.isAncestor(request.priorIntegrationHeadSha, request.controlHeadSha)
  ) {
    throw new Error(
      `${input.taskId}: prior integration is not an ancestor of request control`,
    );
  }
  if (
    !input.isAncestor(request.controlHeadSha, input.currentControlHead) ||
    !input.isAncestor(request.priorIntegrationHeadSha, input.currentControlHead)
  ) {
    throw new Error(`${input.taskId}: reproof authority is not an ancestor`);
  }

  const controlDelta = input.changedFilesBetween(
    request.controlHeadSha,
    input.currentControlHead,
  );
  if (!controlOnlyDelta(controlDelta)) {
    throw new Error(`${input.taskId}: reproof delta is not control-plane only`);
  }
  const collisions = exactTaskLockIntersections(controlDelta, input.fileLocks);
  if (collisions.length > 0) {
    throw new Error(
      `${input.taskId}: reproof delta intersects exact task-lock files: ${collisions.join(", ")}`,
    );
  }

  const integrationResultPath = containedRealFile(
    evidenceRoot,
    resolve(
      evidenceRoot,
      "integration",
      request.priorIntegrationId,
      "integration-result.json",
    ),
    `${input.taskId}: prior integration result`,
  );
  const integrationResultContent = readFileSync(integrationResultPath, "utf8");
  if (
    sha256(integrationResultContent) !== request.priorIntegrationResultSha256
  ) {
    throw new Error(`${input.taskId}: prior integration result drift`);
  }
  const integrationResult = parseRecord(
    integrationResultContent,
    `${input.taskId}: prior integration result`,
  );
  if (
    integrationResult.integrationId !== request.priorIntegrationId ||
    integrationResult.headSha !== request.priorIntegrationHeadSha ||
    integrationResult.status !== "passed"
  ) {
    throw new Error(`${input.taskId}: prior integration result identity drift`);
  }

  const derivedArchivePath = resolve(
    input.evidenceDirectory,
    "archive",
    request.priorIntegrationId,
    `${request.priorArchiveSha256}.json`,
  );
  if (resolve(request.priorEvidencePath) !== derivedArchivePath) {
    throw new Error(`${input.taskId}: prior archive path drift`);
  }
  const archivePath = containedRealFile(
    evidenceRoot,
    request.priorEvidencePath,
    `${input.taskId}: prior archive`,
  );
  const expectedArchivePath = containedRealFile(
    evidenceRoot,
    derivedArchivePath,
    `${input.taskId}: derived prior archive`,
  );
  if (archivePath !== expectedArchivePath) {
    throw new Error(`${input.taskId}: prior archive path drift`);
  }
  const archiveContent = readFileSync(archivePath, "utf8");
  if (sha256(archiveContent) !== request.priorArchiveSha256) {
    throw new Error(`${input.taskId}: prior archive hash drift`);
  }
  const archive = parseRecord(archiveContent, `${input.taskId}: prior archive`);
  const archivedIntegrationResult = record(
    archive.integrationResult,
    `${input.taskId}: archived integration result`,
  );
  if (
    archive.schemaVersion !== "maestro-brain-evidence-archive/v1" ||
    archive.integrationId !== request.priorIntegrationId ||
    archivedIntegrationResult.integrationId !== request.priorIntegrationId ||
    archivedIntegrationResult.status !== "passed"
  ) {
    throw new Error(`${input.taskId}: prior archive identity drift`);
  }
  if (archivedIntegrationResult.headSha !== request.priorIntegrationHeadSha) {
    throw new Error(`${input.taskId}: prior archive head drift`);
  }
  if (!Array.isArray(archive.laneEvidence)) {
    throw new Error(`${input.taskId}: prior archive lane evidence is missing`);
  }
  const archivedLane = archive.laneEvidence
    .map((entry, index) =>
      record(entry, `${input.taskId}: archived laneEvidence[${index}]`),
    )
    .find((entry) => entry.taskId === input.taskId);
  const archivedLaneResult = archivedLane
    ? record(archivedLane.result, `${input.taskId}: archived lane result`)
    : undefined;
  if (
    !archivedLaneResult ||
    canonicalJsonSha256(archivedLaneResult) !== request.priorLaneResultSha256
  ) {
    throw new Error(`${input.taskId}: archived lane drift`);
  }
  if (
    archivedLaneResult.taskId !== request.taskId ||
    archivedLaneResult.integrationId !== request.priorIntegrationId ||
    archivedLaneResult.integrationHeadSha !== request.priorIntegrationHeadSha ||
    typeof archivedLaneResult.headSha !== "string" ||
    !/^[0-9a-f]{40}$/.test(archivedLaneResult.headSha)
  ) {
    throw new Error(`${input.taskId}: archived lane identity drift`);
  }
  validateLaneAcceptance(archivedLaneResult, input.taskId);

  return { reproofRequestSha256: request.requestSha256, request };
};
