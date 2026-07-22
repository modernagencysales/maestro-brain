import {
  laneHistoryOwnershipIssues,
  laneHistoryShapeIssues,
} from "./lane-ownership.js";
import { validateFinalLaneResult } from "./lane-result.js";
import { proofChangedFilesMatch, validateProofContract } from "./proof.js";
import { validSourceSlices } from "./source-budget.js";

type JsonRecord = Record<string, unknown>;

export interface LaneGreenAuthorityReproofTask {
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
  readonly currentTask: LaneGreenAuthorityReproofTask;
  readonly finalGate: JsonRecord;
  readonly history: readonly LaneGreenAuthorityReproofHistory[];
  readonly integratedTaskIds: readonly string[];
  readonly lane: JsonRecord;
  readonly oldPlanSha256: string;
  readonly oldTaskBlockHash: string;
  readonly ownerDisposition?: "absent" | "terminal" | "live" | "unknown";
  readonly proof: JsonRecord;
  readonly sourceChangedFiles: readonly string[];
  readonly sourceTreeSha: string;
}

export interface LaneGreenAuthorityReproofAdmission {
  readonly mode: "lane-green-authority-reproof";
  readonly oldPlanSha256: string;
  readonly oldTaskBlockHash: string;
  readonly sourceBaseSha: string;
  readonly sourceCommits: readonly string[];
  readonly sourceHeadSha: string;
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
  exactSha(input.controlHeadSha, 40, `${task.taskId}: controller HEAD`);
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
  validateFinalLaneResult(input.lane, {
    currentHeadSha: sourceHeadSha,
    currentTreeSha: sourceTreeSha,
    finalGateReport: input.finalGate,
    proof: input.proof,
    taskId: task.taskId,
  });

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
  validateProofContract(input.proof, {
    taskBlockHash: oldTaskBlockHash,
    taskId: task.taskId,
  });
  if (
    oldPlanSha256 === task.planSha256 ||
    oldTaskBlockHash === task.taskBlockHash
  ) {
    throw new Error(
      `${task.taskId}: authority reproof requires fully changed plan authority`,
    );
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
    input.proof.baseSha,
    40,
    `${task.taskId}: proof base`,
  );
  const shapeIssues = laneHistoryShapeIssues(input.history);
  if (shapeIssues.length > 0) {
    throw new Error(`${task.taskId}: ${shapeIssues.join("; ")}`);
  }
  const sourceCommits = input.history.map(({ commit }) =>
    exactSha(commit, 40, `${task.taskId}: source commit`),
  );
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
    sourceBaseSha,
    sourceCommits,
    sourceHeadSha,
    sourceTreeSha,
  };
};
