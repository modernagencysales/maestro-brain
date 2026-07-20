import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { CheckpointReproofTransition } from "./manifest.js";
import {
  assertCheckpointRefBlob,
  checkpointHash as hash,
  checkpointJson as json,
  checkpointLines as lines,
  checkpointSame as same,
  type CheckpointGit as Git,
} from "./checkpoint-reproof-support.js";
import { changedHandAuthoredSourceLines } from "./source-budget.js";
import { runRtk } from "./process.js";

export interface CheckpointReproofTask {
  readonly taskId: string;
  readonly fileLocks: readonly string[];
  readonly planSha256: string;
  readonly taskBlockHash: string;
  readonly sourceSliceBudget: number;
  readonly sourceSliceLimit: number;
}

export interface CheckpointReproofAdmission {
  readonly mode: "checkpoint-reproof";
  readonly sourceBaseSha: string;
  readonly sourceCommits: readonly string[];
  readonly sourceHeadSha: string;
  readonly sourceTreeSha: string;
}

export const admitCheckpointReproof = (input: {
  readonly controlHeadSha: string;
  readonly evidence: string;
  readonly existingRecoveryOwner: boolean;
  readonly integratedTaskIds: readonly string[];
  readonly root: string;
  readonly state: string;
  readonly task: CheckpointReproofTask;
  readonly transition: CheckpointReproofTransition;
  readonly runGit?: Git;
  readonly recoveredProofPath?: string;
  readonly readGitBlob?: (objectSha: string) => string;
}): CheckpointReproofAdmission => {
  const { task, transition } = input;
  if (input.existingRecoveryOwner)
    throw new Error(`${task.taskId}: checkpoint recovery owner already exists`);
  const git: Git =
    input.runGit ??
    ((args) =>
      runRtk(["proxy", "git", ...args], { cwd: input.root, quiet: true }));
  const readBlob =
    input.readGitBlob ??
    ((objectSha: string) =>
      execFileSync("git", ["cat-file", "blob", objectSha], {
        cwd: input.root,
        encoding: "utf8",
      }));
  if (git(["rev-parse", "HEAD"]) !== input.controlHeadSha)
    throw new Error(`${task.taskId}: checkpoint controller HEAD mismatch`);
  const status = lines(git(["status", "--porcelain=v1"]));
  if (status.some((line) => line !== "?? .mcp.json"))
    throw new Error(`${task.taskId}: checkpoint controller is dirty`);
  if (
    task.planSha256 === transition.fromPlanSha256 ||
    task.taskBlockHash === transition.fromTaskBlockHash
  )
    throw new Error(
      `${task.taskId}: checkpoint authority did not change completely`,
    );
  const integrated = new Set(input.integratedTaskIds);
  if (transition.requiredIntegratedTaskIds.some((id) => !integrated.has(id)))
    throw new Error(
      `${task.taskId}: checkpoint prerequisite is not integrated`,
    );
  if (
    transition.sourceCommits.length > task.sourceSliceLimit ||
    transition.sourceSliceLines.some((count) => count > task.sourceSliceBudget)
  )
    throw new Error(
      `${task.taskId}: checkpoint source slice contract exceeded`,
    );

  const laneDir = resolve(input.evidence, "lane-results", task.taskId);
  const laneContent = readFileSync(
    resolve(laneDir, "lane-result.json"),
    "utf8",
  );
  if (hash(laneContent) !== transition.laneResultSha256)
    throw new Error(`${task.taskId}: lane result hash mismatch`);
  const lane = json(laneContent, `${task.taskId}: lane result`);
  if (
    lane.schemaVersion !== "maestro-brain-lane-result/v1" ||
    lane.taskId !== task.taskId ||
    lane.status !== "lane_green" ||
    lane.headSha !== transition.sourceHeadSha ||
    lane.treeSha !== transition.sourceTreeSha
  )
    throw new Error(`${task.taskId}: lane result checkpoint mismatch`);
  const gateContent = readFileSync(
    resolve(laneDir, "lane-gate-report.json"),
    "utf8",
  );
  if (hash(gateContent) !== transition.finalGateSha256)
    throw new Error(`${task.taskId}: final gate hash mismatch`);
  const gate = json(gateContent, `${task.taskId}: final gate`);
  if (
    gate.schemaVersion !== "maestro-brain-lane-gate/v1" ||
    gate.taskId !== task.taskId ||
    gate.stage !== "final" ||
    gate.status !== "passed" ||
    gate.headSha !== transition.sourceHeadSha ||
    gate.currentHeadSha !== transition.sourceHeadSha ||
    gate.currentTreeSha !== transition.sourceTreeSha ||
    gate.planSha256 !== transition.fromPlanSha256 ||
    gate.taskBlockHash !== transition.fromTaskBlockHash
  )
    throw new Error(`${task.taskId}: final gate checkpoint mismatch`);

  for (const lens of ["contract", "safety", "quality"] as const) {
    const lensPath = resolve(
      laneDir,
      "review-lenses",
      transition.sourceHeadSha,
      `${lens}.json`,
    );
    const content = readFileSync(lensPath, "utf8");
    if (hash(content) !== transition.reviewLensSha256[lens])
      throw new Error(`${task.taskId}: ${lens} review hash mismatch`);
    const value = json(content, `${task.taskId}: ${lens} review`);
    if (value.lens !== lens || value.verdict !== "pass")
      throw new Error(`${task.taskId}: ${lens} review is not PASS`);
  }
  const receiptContent = assertCheckpointRefBlob(
    git,
    readBlob,
    transition.reviewReceiptRef,
    transition.reviewReceiptObjectSha,
  );
  const receipt = json(receiptContent, `${task.taskId}: review receipt`);
  const result = json(
    JSON.stringify(receipt.result),
    `${task.taskId}: review result`,
  );
  if (
    receipt.status !== "cleaned" ||
    receipt.taskId !== task.taskId ||
    receipt.headSha !== transition.sourceHeadSha ||
    receipt.treeSha !== transition.sourceTreeSha ||
    receipt.planSha256 !== transition.fromPlanSha256 ||
    receipt.taskBlockHash !== transition.fromTaskBlockHash ||
    receipt.preparedObject !== transition.reviewPreparedObjectSha ||
    result.outcome !== "promoted" ||
    result.reviewVerdict !== "pass" ||
    result.proofSha256 !== transition.promotedProofSha256 ||
    !same(result.artifactSha256, transition.reviewLensSha256)
  )
    throw new Error(`${task.taskId}: review receipt checkpoint mismatch`);
  git(["cat-file", "-e", `${transition.reviewPreparedObjectSha}^{blob}`]);
  assertCheckpointRefBlob(
    git,
    readBlob,
    transition.sliceExpansionRef,
    transition.sliceExpansionObjectSha,
    transition.sliceExpansionSha256,
  );

  const selectionPath = resolve(input.root, transition.selectionPath);
  if (resolve(dirname(selectionPath)) !== resolve(input.state, "runs"))
    throw new Error(`${task.taskId}: selection path escapes factory state`);
  const selectionContent = readFileSync(selectionPath, "utf8");
  if (hash(selectionContent) !== transition.selectionFileSha256)
    throw new Error(`${task.taskId}: selection file hash mismatch`);
  const selection = json(selectionContent, `${task.taskId}: wave selection`);
  const selected = Array.isArray(selection.selectedTasks)
    ? selection.selectedTasks
    : [];
  const selectedTask =
    selected.length === 1
      ? json(JSON.stringify(selected[0]), "selected task")
      : {};
  if (
    selection.integrationId !== transition.integrationId ||
    selection.selectionPayloadSha256 !== transition.selectionPayloadSha256 ||
    selectedTask.taskId !== task.taskId ||
    selectedTask.headSha !== transition.sourceHeadSha ||
    selectedTask.gateHeadSha !== transition.sourceHeadSha ||
    selectedTask.proofHeadSha !== transition.sourceHeadSha ||
    selectedTask.laneResultSha256 !== transition.laneResultSha256 ||
    selectedTask.gateSha256 !== transition.finalGateSha256 ||
    selectedTask.proofSha256 !== transition.promotedProofSha256 ||
    selectedTask.planSha256 !== transition.fromPlanSha256 ||
    selectedTask.taskBlockHash !== transition.fromTaskBlockHash
  )
    throw new Error(`${task.taskId}: wave selection checkpoint mismatch`);
  const integrationPath = resolve(
    input.evidence,
    "integration",
    transition.integrationId,
    "integration-result.json",
  );
  if (existsSync(integrationPath)) {
    const wave = json(
      readFileSync(integrationPath, "utf8"),
      `${task.taskId}: integration result`,
    );
    if (
      wave.integrationId !== transition.integrationId ||
      wave.status === "promoted" ||
      wave.selectionFileSha256 !== transition.selectionFileSha256 ||
      wave.selectionPayloadSha256 !== transition.selectionPayloadSha256
    )
      throw new Error(
        `${task.taskId}: integration wave is promoted or mismatched`,
      );
  }

  if (
    git(["rev-parse", `${transition.sourceHeadSha}^{tree}`]) !==
    transition.sourceTreeSha
  )
    throw new Error(`${task.taskId}: source tree drifted`);
  const ancestry = lines(
    git([
      "rev-list",
      "--reverse",
      `${transition.sourceBaseSha}..${transition.sourceHeadSha}`,
    ]),
  );
  const histories = ancestry.map((commit) => ({
    commit,
    files: lines(
      git(["diff-tree", "--no-commit-id", "--name-only", "-r", commit]),
    ),
  }));
  const selectedHistories = histories.filter((history) =>
    history.files.some((file) => task.fileLocks.includes(file)),
  );
  const commits = selectedHistories.map(({ commit }) => commit);
  if (!same(commits, transition.sourceCommits))
    throw new Error(`${task.taskId}: source commit chain mismatch`);
  for (let index = 0; index < selectedHistories.length; index += 1) {
    const commit = commits[index] ?? "";
    const files = selectedHistories[index]?.files ?? [];
    if (files.some((file) => !task.fileLocks.includes(file)))
      throw new Error(`${task.taskId}: source history contains unowned paths`);
    const count = changedHandAuthoredSourceLines(
      git(["show", "--no-renames", "--numstat", "--format=", commit]),
    );
    if (
      count !== transition.sourceSliceLines[index] ||
      count > task.sourceSliceBudget
    )
      throw new Error(`${task.taskId}: source slice lines drifted`);
  }
  if (
    input.recoveredProofPath &&
    existsSync(input.recoveredProofPath) &&
    hash(readFileSync(input.recoveredProofPath)) !==
      transition.promotedProofSha256
  )
    throw new Error(`${task.taskId}: recovered old proof hash mismatch`);
  return {
    mode: "checkpoint-reproof",
    sourceBaseSha: transition.sourceBaseSha,
    sourceCommits: commits,
    sourceHeadSha: transition.sourceHeadSha,
    sourceTreeSha: transition.sourceTreeSha,
  };
};
