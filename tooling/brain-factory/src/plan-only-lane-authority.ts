import {
  laneHistoryOwnershipIssues,
  laneHistoryShapeIssues,
} from "./lane-ownership.js";
import { validateFinalLaneResult } from "./lane-result.js";
import type { PlanOnlyLaneAuthorityTransition } from "./manifest.js";
import { validSourceSlices } from "./source-budget.js";

type JsonRecord = Record<string, unknown>;

export interface PlanOnlyLaneAuthorityTask {
  readonly codeStartAfter: readonly string[];
  readonly fileLocks: readonly string[];
  readonly planSha256: string;
  readonly sourceSliceBudget: number;
  readonly sourceSliceLimit: number;
  readonly taskBlockHash: string;
  readonly taskId: string;
}

export interface PlanOnlyLaneAuthorityHistory {
  readonly commit: string;
  readonly files: readonly string[];
  readonly parentCount: number;
  readonly sourceLines: number;
}

export interface PlanOnlyLaneAuthorityInput {
  readonly controlHeadSha: string;
  readonly currentTask: PlanOnlyLaneAuthorityTask;
  readonly evidenceSha256s: {
    readonly ciProofPacket: string;
    readonly laneGateReport: string;
    readonly laneResult: string;
  };
  readonly finalGate: JsonRecord;
  readonly history: readonly PlanOnlyLaneAuthorityHistory[];
  readonly integratedTaskIds: readonly string[];
  readonly lane: JsonRecord;
  readonly ownerDisposition: "absent" | "terminal" | "live" | "unknown";
  readonly proof: JsonRecord;
  readonly sourceCommitPatchSha256s: readonly string[];
  readonly sourceTreeSha: string;
  readonly transition: PlanOnlyLaneAuthorityTransition;
}

export interface PlanOnlyLaneAuthorityAdmission {
  readonly mode: "plan-only-lane-authority";
  readonly taskId: string;
  readonly fromPlanSha256: string;
  readonly currentPlanSha256: string;
  readonly taskBlockHash: string;
  readonly sourceBaseSha: string;
  readonly sourceHeadSha: string;
  readonly sourceTreeSha: string;
  readonly sourceCommits: readonly string[];
  readonly sourceCommitPatchSha256s: readonly string[];
}

const exactSha = (value: unknown, length: 40 | 64, label: string): string => {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[0-9a-f]{${length}}$`).test(value)
  )
    throw new Error(`${label} is invalid`);
  return value;
};

const exactList = (
  left: readonly unknown[],
  right: readonly unknown[],
): boolean => JSON.stringify(left) === JSON.stringify(right);

const validateSourceLineage = (
  input: PlanOnlyLaneAuthorityInput,
  task: PlanOnlyLaneAuthorityTask,
  sourceHeadSha: string,
): void => {
  const shapeIssues = laneHistoryShapeIssues(input.history);
  const ownershipIssues = laneHistoryOwnershipIssues(
    input.history,
    task.fileLocks,
  );
  if (shapeIssues.length > 0 || ownershipIssues.length > 0)
    throw new Error(
      `${task.taskId}: ${[...shapeIssues, ...ownershipIssues].join("; ")}`,
    );
  if (
    !validSourceSlices(
      input.history.map(({ sourceLines }) => sourceLines),
      task.sourceSliceBudget,
      task.sourceSliceLimit,
    )
  )
    throw new Error(`${task.taskId}: source slice contract drifted`);
  const commits = input.history.map(({ commit }) => commit);
  if (
    !exactList(commits, input.transition.sourceCommits) ||
    commits.at(-1) !== sourceHeadSha ||
    !exactList(
      input.sourceCommitPatchSha256s,
      input.transition.sourceCommitPatchSha256s,
    )
  )
    throw new Error(`${task.taskId}: source lineage drifted`);
  const changedFiles = [
    ...new Set(input.history.flatMap(({ files }) => files)),
  ].sort();
  if (
    !Array.isArray(input.proof.changedFiles) ||
    !exactList([...input.proof.changedFiles].sort(), changedFiles)
  )
    throw new Error(`${task.taskId}: proof changed files drifted`);
};

export const admitPlanOnlyLaneAuthority = (
  input: PlanOnlyLaneAuthorityInput,
): PlanOnlyLaneAuthorityAdmission => {
  const task = input.currentTask;
  if (!new Set(["S06-T01", "S11-T02", "S13-T02"]).has(task.taskId))
    throw new Error(`${task.taskId}: plan-only authority is unauthorized`);
  exactSha(input.controlHeadSha, 40, `${task.taskId}: control HEAD`);
  const transition = input.transition;
  if (
    transition.schemaVersion !== "maestro-brain-plan-only-lane-authority/v1" ||
    transition.fromPlanSha256 === task.planSha256 ||
    transition.taskBlockHash !== task.taskBlockHash ||
    transition.fromPlanSha256 !== input.proof.planSha256 ||
    transition.taskBlockHash !== input.proof.taskBlockHash
  )
    throw new Error(`${task.taskId}: plan-only authority identity drifted`);
  if (input.ownerDisposition === "live" || input.ownerDisposition === "unknown")
    throw new Error(
      `${task.taskId}: current owner is ${input.ownerDisposition}`,
    );

  const sourceHeadSha = exactSha(
    transition.sourceHeadSha,
    40,
    `${task.taskId}: source HEAD`,
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
  if (
    transition.sourceTreeSha !== sourceTreeSha ||
    transition.sourceBaseSha !== input.proof.baseSha ||
    input.evidenceSha256s.laneResult !== transition.laneResultSha256 ||
    input.evidenceSha256s.ciProofPacket !== transition.ciProofPacketSha256 ||
    input.evidenceSha256s.laneGateReport !== transition.laneGateReportSha256
  )
    throw new Error(`${task.taskId}: immutable lane evidence drifted`);

  if (!exactList(transition.requiredIntegratedTaskIds, task.codeStartAfter))
    throw new Error(`${task.taskId}: exact prerequisites drifted`);
  const integrated = new Set(input.integratedTaskIds);
  const missing = task.codeStartAfter.filter(
    (taskId) => !integrated.has(taskId),
  );
  if (missing.length > 0)
    throw new Error(
      `${task.taskId}: prerequisites are not integrated: ${missing.join(", ")}`,
    );

  validateSourceLineage(input, task, sourceHeadSha);

  return {
    mode: "plan-only-lane-authority",
    taskId: task.taskId,
    fromPlanSha256: transition.fromPlanSha256,
    currentPlanSha256: task.planSha256,
    taskBlockHash: task.taskBlockHash,
    sourceBaseSha: transition.sourceBaseSha,
    sourceHeadSha,
    sourceTreeSha,
    sourceCommits: transition.sourceCommits,
    sourceCommitPatchSha256s: transition.sourceCommitPatchSha256s,
  };
};
