import type { ContractReproofRequest } from "./contract-reproof.js";
import {
  exactSha,
  parseRecord,
  sameRecord,
  sha256,
  validateFailedBroadGate,
  isTypeCoverageFindingId,
  validateLaneBindings,
  validateSupersession,
  validateTypeCoverageRegression,
} from "./failed-integration-rework-validation.js";
import { readIntegrationWaveSelection } from "./integration-wave.js";

export const FAILED_INTEGRATION_REWORK_ARCHIVE_SCHEMA =
  "maestro-brain-failed-integration-rework-archive/v1" as const;

export interface FailedIntegrationReworkArchive {
  readonly broadGateContent?: string;
  readonly candidateHeadSha: string;
  readonly finalGateContent: string;
  readonly integrationId: string;
  readonly integrationResultContent: string;
  readonly laneContent: string;
  readonly proofContent: string;
  readonly runRecordContent: string;
  readonly schemaVersion: typeof FAILED_INTEGRATION_REWORK_ARCHIVE_SCHEMA;
  readonly selectionContent: string;
  readonly selectionPath: string;
  readonly sourceBranch: string;
  readonly supersessionContent: string;
  readonly taskId: string;
  readonly typeCoverageRegressionContent?: string;
}

export const isFailedIntegrationReworkArchive = (
  value: unknown,
): value is FailedIntegrationReworkArchive =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (value as Record<string, unknown>).schemaVersion ===
    FAILED_INTEGRATION_REWORK_ARCHIVE_SCHEMA;

export const validateFailedIntegrationReworkArchive = (input: {
  readonly archiveContent: string;
  readonly currentControlHead: string;
  readonly integrationResultContent: string;
  readonly isAncestor: (ancestor: string, descendant: string) => boolean;
  readonly request: ContractReproofRequest;
}): FailedIntegrationReworkArchive => {
  const { request } = input;
  if (sha256(input.archiveContent) !== request.priorArchiveSha256) {
    throw new Error(`${request.taskId}: prior archive hash drift`);
  }
  const archive = parseRecord(
    input.archiveContent,
    "failed integration archive",
  );
  if (
    !isFailedIntegrationReworkArchive(archive) ||
    archive.taskId !== request.taskId ||
    archive.integrationId !== request.priorIntegrationId
  ) {
    throw new Error(`${request.taskId}: prior archive identity drift`);
  }
  if (
    archive.integrationResultContent !== input.integrationResultContent ||
    sha256(input.integrationResultContent) !==
      request.priorIntegrationResultSha256
  ) {
    throw new Error(`${request.taskId}: prior integration result drift`);
  }
  const selectionRead = readIntegrationWaveSelection(archive.selectionContent);
  const { selection } = selectionRead;
  const selected = selection.selectedTasks[0];
  if (
    selection.selectedTasks.length !== 1 ||
    selected?.taskId !== request.taskId ||
    selection.integrationId !== request.priorIntegrationId ||
    selection.baseSha !== request.priorIntegrationHeadSha ||
    selected.taskBlockHash !== request.taskBlockHash
  ) {
    throw new Error(`${request.taskId}: failed archive selection drift`);
  }
  const lane = parseRecord(archive.laneContent, "archived lane result");
  const proof = parseRecord(archive.proofContent, "archived lane proof");
  const gate = parseRecord(archive.finalGateContent, "archived lane gate");
  validateLaneBindings({
    gate,
    gateContent: archive.finalGateContent,
    lane,
    laneContent: archive.laneContent,
    proof,
    proofContent: archive.proofContent,
    selected,
    taskId: request.taskId,
  });
  if (sha256(archive.laneContent) !== request.priorLaneResultSha256) {
    throw new Error(`${request.taskId}: archived lane drift`);
  }
  const result = parseRecord(
    archive.integrationResultContent,
    "archived integration result",
  );
  if (
    result.schemaVersion !== "maestro-brain-integration-result/v3" ||
    result.status !==
      (archive.broadGateContent === undefined
        ? "ready_for_review"
        : "rework") ||
    result.reviewVerdict !== "rework" ||
    result.integrationId !== request.priorIntegrationId ||
    result.headSha !== archive.candidateHeadSha ||
    result.selectionFileSha256 !== selectionRead.selectionFileSha256 ||
    result.selectionPayloadSha256 !== selectionRead.selectionPayloadSha256
  ) {
    throw new Error(`${request.taskId}: archived integration result drift`);
  }
  const findings = result.remainingFindings;
  const archivedFindingIds = Array.isArray(findings)
    ? findings.map((finding) => {
        const parsed = parseRecord(JSON.stringify(finding), "archived finding");
        return typeof parsed.id === "string" ? parsed.id : "";
      })
    : [];
  if (
    !Array.isArray(findings) ||
    findings.length === 0 ||
    findings.some((finding) => {
      const parsed = parseRecord(JSON.stringify(finding), "archived finding");
      return parsed.taskId !== request.taskId;
    }) ||
    archivedFindingIds.some((id) => !id.trim())
  ) {
    throw new Error(`${request.taskId}: archived finding owner mismatch`);
  }
  if (archive.broadGateContent === undefined) {
    if (result.broadGate !== null && result.broadGate !== undefined)
      throw new Error(
        "archived review rework unexpectedly contains a broad gate",
      );
  } else {
    const broadGate = parseRecord(
      archive.broadGateContent,
      "archived broad gate",
    );
    validateFailedBroadGate({
      broadGate,
      candidateHeadSha: exactSha(
        archive.candidateHeadSha,
        "candidateHeadSha",
        40,
      ),
    });
    sameRecord(result.broadGate, broadGate, "archived integration broad gate");
  }
  if (archivedFindingIds.some(isTypeCoverageFindingId)) {
    if (archive.broadGateContent === undefined)
      throw new Error("type coverage rework requires a failed broad gate");
    if (!archive.typeCoverageRegressionContent)
      throw new Error("type coverage regression evidence is missing");
    validateTypeCoverageRegression({
      baseSha: selection.baseSha,
      candidateHeadSha: archive.candidateHeadSha,
      content: archive.typeCoverageRegressionContent,
      taskId: request.taskId,
    });
  }
  const supersession = parseRecord(
    archive.supersessionContent,
    "archived supersession",
  );
  validateSupersession({
    ...(archive.broadGateContent === undefined
      ? {}
      : { broadGateContent: archive.broadGateContent }),
    currentControlHead: input.currentControlHead,
    isAncestor: input.isAncestor,
    integrationId: selection.integrationId,
    integrationResultContent: archive.integrationResultContent,
    runRecordContent: archive.runRecordContent,
    selectionContent: archive.selectionContent,
    selectionPath: archive.selectionPath,
    supersession,
    taskId: request.taskId,
  });
  return archive;
};
