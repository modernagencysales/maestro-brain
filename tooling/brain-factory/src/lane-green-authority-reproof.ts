import {
  laneHistoryOwnershipIssues,
  laneHistoryShapeIssues,
} from "./lane-ownership.js";
import { proofChangedFilesMatch, validateProofContract } from "./proof.js";
import { validSourceSlices } from "./source-budget.js";
import type { LaneGreenAuthorityReproofTransition } from "./manifest.js";

type JsonRecord = Record<string, unknown>;

export interface LaneGreenAuthorityReproofTask {
  readonly authorityAuthorized: boolean;
  readonly codeStartAfter: readonly string[];
  readonly fileLocks: readonly string[];
  readonly planSha256: string;
  readonly sourceSliceBudget: number;
  readonly sourceSliceLimit: number;
  readonly taskBlockHash: string;
  readonly taskId: string;
}

export interface LaneGreenAuthorityReproofHistory {
  readonly commit: string;
  readonly files: readonly string[];
  readonly parentCount: number;
  readonly sourceLines: number;
}

export interface LaneGreenAuthorityReproofInput {
  readonly controlHeadSha: string;
  readonly currentTaskWithoutAuthorityHash: string;
  readonly currentTask: LaneGreenAuthorityReproofTask;
  readonly finalGate: JsonRecord;
  readonly history: readonly LaneGreenAuthorityReproofHistory[];
  readonly integratedTaskIds: readonly string[];
  readonly lane: JsonRecord;
  readonly oldPlanSha256: string;
  readonly oldTaskBlockHash: string;
  readonly ownerDisposition?: "absent" | "terminal" | "live" | "unknown";
  readonly proof: JsonRecord;
  readonly proofChangedFiles: readonly string[];
  readonly transition: LaneGreenAuthorityReproofTransition;
  readonly sourceChangedFiles: readonly string[];
  readonly sourcePatchSha256: string;
  readonly sourceTreeSha: string;
}

export interface LaneGreenAuthorityReproofAdmission {
  readonly mode: "lane-green-authority-reproof";
  readonly oldPlanSha256: string;
  readonly oldTaskBlockHash: string;
  readonly proofBaseSha: string;
  readonly proofFindingIds: readonly string[];
  readonly proofGateStage: "pre-review";
  readonly proofHeadSha: string;
  readonly sourceBaseSha: string;
  readonly sourceCommits: readonly string[];
  readonly sourceChangedFiles: readonly string[];
  readonly sourceHeadSha: string;
  readonly sourcePatchSha256: string;
  readonly sourceTreeSha: string;
}

const exactSha = (value: unknown, length: 40 | 64, label: string): string => {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[0-9a-f]{${length}}$`).test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
};

export const admitLaneGreenAuthorityReproof = (
  input: LaneGreenAuthorityReproofInput,
): LaneGreenAuthorityReproofAdmission => {
  const { currentTask: task } = input;
  if (task.taskId !== "S05-T01" || !task.authorityAuthorized) {
    throw new Error(
      `${task.taskId}: authority reproof is authorized only for S05-T01`,
    );
  }
  exactSha(input.controlHeadSha, 40, `${task.taskId}: controller HEAD`);
  exactSha(input.sourcePatchSha256, 64, `${task.taskId}: source patch SHA`);
  const ownerDisposition = input.ownerDisposition ?? "absent";
  if (ownerDisposition === "live" || ownerDisposition === "unknown") {
    throw new Error(
      `${task.taskId}: current task owner is ${ownerDisposition}`,
    );
  }

  const sourceHeadSha = exactSha(
    input.lane.headSha,
    40,
    `${task.taskId}: lane HEAD`,
  );
  const sourceTreeSha = exactSha(
    input.sourceTreeSha,
    40,
    `${task.taskId}: source tree`,
  );
  if (
    input.lane.schemaVersion !== "maestro-brain-lane-result/v1" ||
    input.lane.taskId !== task.taskId ||
    input.lane.status !== "lane_green" ||
    input.lane.treeSha !== sourceTreeSha
  ) {
    throw new Error(`${task.taskId}: lane result checkpoint mismatch`);
  }
  const proofHeadSha = exactSha(
    input.proof.headSha,
    40,
    `${task.taskId}: proof HEAD`,
  );
  const transition = input.transition;
  if (
    transition.proofBaseSha !== input.proof.baseSha ||
    transition.proofHeadSha !== proofHeadSha ||
    transition.proofPlanSha256 !== input.proof.planSha256 ||
    transition.proofTaskBlockHash !== input.proof.taskBlockHash ||
    transition.proofGateStage !== input.finalGate.stage ||
    transition.sourceHeadSha !== sourceHeadSha ||
    transition.sourceTreeSha !== sourceTreeSha
  )
    throw new Error(`${task.taskId}: exact dual-history transition drifted`);
  const findings = Array.isArray(input.proof.reviewFindings)
    ? input.proof.reviewFindings
    : [];
  if (
    input.proof.reviewVerdict !== "rework" ||
    findings.length === 0 ||
    findings.some(
      (finding) =>
        typeof finding !== "object" ||
        finding === null ||
        !("id" in finding) ||
        typeof finding.id !== "string" ||
        !finding.id.startsWith("OWNERSHIP-S05-T01-"),
    )
  ) {
    throw new Error(`${task.taskId}: stale proof is not ownership-only rework`);
  }
  const findingIds = findings.map((finding) =>
    typeof finding === "object" && finding !== null && "id" in finding
      ? finding.id
      : undefined,
  );
  if (JSON.stringify(findingIds) !== JSON.stringify(transition.proofFindingIds))
    throw new Error(`${task.taskId}: pinned proof findings drifted`);
  if (
    input.finalGate.schemaVersion !== "maestro-brain-lane-gate/v1" ||
    input.finalGate.taskId !== task.taskId ||
    input.finalGate.status !== "passed" ||
    !new Set(["pre-review", "final"]).has(String(input.finalGate.stage)) ||
    input.finalGate.headSha !== proofHeadSha ||
    input.finalGate.currentHeadSha !== proofHeadSha ||
    input.finalGate.planSha256 !== input.proof.planSha256 ||
    input.finalGate.taskBlockHash !== input.proof.taskBlockHash
  ) {
    throw new Error(`${task.taskId}: stale proof gate mismatch`);
  }

  const oldPlanSha256 = exactSha(
    input.oldPlanSha256,
    64,
    `${task.taskId}: historical plan SHA`,
  );
  const oldTaskBlockHash = exactSha(
    input.oldTaskBlockHash,
    64,
    `${task.taskId}: historical task block hash`,
  );
  if (input.proof.planSha256 !== oldPlanSha256) {
    throw new Error(`${task.taskId}: historical plan SHA mismatch`);
  }
  if (input.proof.taskBlockHash !== oldTaskBlockHash) {
    throw new Error(`${task.taskId}: historical task block hash mismatch`);
  }
  if (input.currentTaskWithoutAuthorityHash !== oldTaskBlockHash) {
    throw new Error(`${task.taskId}: current task semantics drifted`);
  }
  validateProofContract(input.proof, {
    taskBlockHash: oldTaskBlockHash,
    taskId: task.taskId,
  });
  if (
    oldPlanSha256 === task.planSha256 &&
    oldTaskBlockHash === task.taskBlockHash
  ) {
    throw new Error(`${task.taskId}: lane already matches current authority`);
  }
  if (
    !Array.isArray(input.proof.changedFiles) ||
    !input.proof.changedFiles.every((file) => typeof file === "string") ||
    !proofChangedFilesMatch(
      input.proof.changedFiles as string[],
      input.proofChangedFiles,
    )
  ) {
    throw new Error(`${task.taskId}: stale proof changed files mismatch`);
  }

  const integrated = new Set(input.integratedTaskIds);
  const missingDependencies = task.codeStartAfter.filter(
    (taskId) => !integrated.has(taskId),
  );
  if (missingDependencies.length > 0) {
    throw new Error(
      `${task.taskId}: current prerequisite is not integrated: ${missingDependencies.join(", ")}`,
    );
  }

  const sourceBaseSha = exactSha(
    transition.sourceBaseSha,
    40,
    `${task.taskId}: source base`,
  );
  const shapeIssues = laneHistoryShapeIssues(input.history);
  if (shapeIssues.length > 0) {
    throw new Error(`${task.taskId}: ${shapeIssues.join("; ")}`);
  }
  const sourceCommits = input.history.map(({ commit }) =>
    exactSha(commit, 40, `${task.taskId}: source commit`),
  );
  if (
    JSON.stringify(sourceCommits) !== JSON.stringify(transition.sourceCommits)
  )
    throw new Error(`${task.taskId}: pinned source commits drifted`);
  if (sourceCommits.at(-1) !== sourceHeadSha) {
    throw new Error(`${task.taskId}: source history does not end at lane HEAD`);
  }
  const ownershipIssues = laneHistoryOwnershipIssues(
    input.history,
    task.fileLocks,
  );
  if (ownershipIssues.length > 0) {
    throw new Error(
      `${task.taskId}: ${ownershipIssues
        .join("; ")
        .replaceAll(
          "not declared in manifest fileLocks",
          "not declared in current manifest fileLocks",
        )}`,
    );
  }
  if (
    !validSourceSlices(
      input.history.map(({ sourceLines }) => sourceLines),
      task.sourceSliceBudget,
      task.sourceSliceLimit,
    )
  ) {
    throw new Error(
      `${task.taskId}: source slice limit or budget does not admit preserved commits`,
    );
  }
  if (
    !Array.isArray(input.proof.changedFiles) ||
    !input.proof.changedFiles.every((file) => typeof file === "string") ||
    !proofChangedFilesMatch(
      input.proof.changedFiles as string[],
      input.sourceChangedFiles,
    )
  ) {
    throw new Error(
      `${task.taskId}: proof changed files mismatch source history`,
    );
  }

  return {
    mode: "lane-green-authority-reproof",
    oldPlanSha256,
    oldTaskBlockHash,
    proofBaseSha: transition.proofBaseSha,
    proofFindingIds: transition.proofFindingIds,
    proofGateStage: transition.proofGateStage,
    proofHeadSha: transition.proofHeadSha,
    sourceBaseSha,
    sourceCommits,
    sourceChangedFiles: input.sourceChangedFiles,
    sourceHeadSha,
    sourcePatchSha256: input.sourcePatchSha256,
    sourceTreeSha,
  };
};
