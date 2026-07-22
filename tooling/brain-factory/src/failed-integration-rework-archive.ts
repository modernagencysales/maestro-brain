import type { ContractReproofRequest } from "./contract-reproof.js";
import { validateIntegrationFindingAdoption } from "./integration-finding-adoption.js";
import {
  exactSha,
  parseRecord,
  record,
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
  readonly findingAdoptionContent?: string;
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
  const selected = selection.selectedTasks.find(
    (candidate) => candidate.taskId === request.taskId,
  );
  if (
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
  if (archive.findingAdoptionContent) {
    const adoptionSha256 = sha256(archive.findingAdoptionContent);
    let adoption;
    try {
      adoption = validateIntegrationFindingAdoption({
        adoptionContent: archive.findingAdoptionContent,
        resultContent: archive.integrationResultContent,
        selectionContent: archive.selectionContent,
        worktreeHeadSha: archive.candidateHeadSha,
      });
    } catch (error) {
      throw new Error(
        `${request.taskId}: finding adoption archive is invalid: ${String(error)}`,
      );
    }
    const requestFinding = request.findings?.[0];
    const semanticKeys = [
      "affectedPaths",
      "candidateHeadSha",
      "changeExpectation",
      "details",
      "evidenceOnlyRationale",
      "expectedBehavior",
      "id",
      "requiredRegressionProof",
      "severity",
      "summary",
      "taskId",
    ] as const;
    if (
      request.findings?.length !== 1 ||
      !requestFinding ||
      semanticKeys.some(
        (key) =>
          JSON.stringify(requestFinding[key]) !==
          JSON.stringify(adoption.finding[key]),
      ) ||
      !requestFinding.priorEvidenceSha256.includes(adoptionSha256)
    ) {
      throw new Error(`${request.taskId}: finding adoption archive is unbound`);
    }
  }
  const result = parseRecord(
    archive.integrationResultContent,
    "archived integration result",
  );
  const findings = Array.isArray(result.remainingFindings)
    ? result.remainingFindings
    : [];
  const semanticRework =
    result.status ===
      (archive.broadGateContent === undefined
        ? "ready_for_review"
        : "rework") &&
    result.reviewVerdict === "rework" &&
    findings.length > 0;
  const broadGateOnlyFailure =
    archive.broadGateContent !== undefined &&
    result.status === "ready_for_review" &&
    result.reviewVerdict === "pass" &&
    findings.length === 0;
  if (
    result.schemaVersion !== "maestro-brain-integration-result/v3" ||
    (!semanticRework && !broadGateOnlyFailure) ||
    result.integrationId !== request.priorIntegrationId ||
    result.headSha !== archive.candidateHeadSha ||
    result.selectionFileSha256 !== selectionRead.selectionFileSha256 ||
    result.selectionPayloadSha256 !== selectionRead.selectionPayloadSha256
  ) {
    throw new Error(`${request.taskId}: archived integration result drift`);
  }
  const archivedFindingIds = Array.isArray(findings)
    ? findings.map((finding) => {
        const parsed = parseRecord(JSON.stringify(finding), "archived finding");
        return typeof parsed.id === "string" ? parsed.id : "";
      })
    : [];
  if (
    !Array.isArray(findings) ||
    (semanticRework && findings.length === 0) ||
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
    if (broadGateOnlyFailure) {
      const embeddedBroadGate = record(
        result.broadGate,
        "archived integration broad gate",
      );
      const embeddedAttempts = Array.isArray(embeddedBroadGate.attempts)
        ? embeddedBroadGate.attempts
        : [];
      const currentAttempts = Array.isArray(broadGate.attempts)
        ? broadGate.attempts
        : [];
      if (embeddedAttempts.length > currentAttempts.length) {
        throw new Error("archived integration broad gate drift");
      }
      sameRecord(
        embeddedBroadGate,
        {
          ...broadGate,
          attempts: currentAttempts.slice(0, embeddedAttempts.length),
        },
        "archived integration broad gate",
      );
    } else {
      sameRecord(
        result.broadGate,
        broadGate,
        "archived integration broad gate",
      );
    }
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
