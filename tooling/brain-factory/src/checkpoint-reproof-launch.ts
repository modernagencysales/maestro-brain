import { createHash } from "node:crypto";
import { resolve } from "node:path";

import type { CheckpointReproofTransition } from "./manifest.js";

export interface CheckpointReproofCoordinates {
  readonly authorityId: string;
  readonly branch: string;
  readonly workdir: string;
}

export const checkpointReproofCoordinates = (input: {
  readonly controlHeadSha: string;
  readonly planSha256: string;
  readonly root: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
}): CheckpointReproofCoordinates => {
  for (const [label, value, length] of [
    ["control HEAD", input.controlHeadSha, 40],
    ["plan SHA", input.planSha256, 64],
    ["task hash", input.taskBlockHash, 64],
  ] as const) {
    if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value))
      throw new Error(`checkpoint reproof ${label} is invalid`);
  }
  const authorityId = createHash("sha256")
    .update(
      `${input.controlHeadSha}:${input.planSha256}:${input.taskBlockHash}:checkpoint-reproof`,
    )
    .digest("hex")
    .slice(0, 12);
  const slug = input.taskId.toLowerCase();
  return {
    authorityId,
    branch: `fabro/reproof-${slug}-checkpoint-${authorityId}`,
    workdir: resolve(
      input.root,
      "..",
      ".maestro-brain-fabro-workdirs",
      `reproof-${slug}-checkpoint-${authorityId}`,
    ),
  };
};

export const runCheckpointReproofLaunch = (input: {
  readonly createCurrentWorktree: () => void;
  readonly cherryPickExactCheckpoint: () => void;
  readonly launchNormalBuildTask: () => string;
  readonly recordOwner: (runId: string) => void;
  readonly promoteOwner: (runId: string) => void;
  readonly rollback: () => void;
}): string => {
  let mutated = false;
  try {
    input.createCurrentWorktree();
    mutated = true;
    input.cherryPickExactCheckpoint();
    const runId = input.launchNormalBuildTask();
    if (!runId) throw new Error("checkpoint reproof launch returned no run ID");
    input.recordOwner(runId);
    input.promoteOwner(runId);
    return runId;
  } catch (error) {
    if (mutated) input.rollback();
    throw error;
  }
};

export interface CheckpointReproofOwnerRecord {
  readonly mode?: unknown;
  readonly taskId?: unknown;
  readonly sourceHeadSha?: unknown;
  readonly sourceTreeSha?: unknown;
  readonly sourceCommits?: unknown;
  readonly branch?: unknown;
  readonly workdir?: unknown;
  readonly status?: unknown;
}

export const validateCheckpointReproofOwner = (input: {
  readonly record: CheckpointReproofOwnerRecord;
  readonly taskId: string;
  readonly transition: CheckpointReproofTransition;
  readonly expectedBranch?: string;
  readonly expectedWorkdir?: string;
  readonly worktreeStatus?: string;
  readonly worktreeHeadSha?: string;
  readonly worktreeTreeSha?: string;
}): CheckpointReproofOwnerRecord & { readonly mode: "checkpoint-reproof" } => {
  const { record, transition } = input;
  if (record.mode !== "checkpoint-reproof")
    throw new Error(`${input.taskId}: checkpoint owner mode mismatch`);
  if (
    record.taskId !== input.taskId ||
    record.sourceHeadSha !== transition.sourceHeadSha ||
    record.sourceTreeSha !== transition.sourceTreeSha ||
    JSON.stringify(record.sourceCommits) !==
      JSON.stringify(transition.sourceCommits)
  )
    throw new Error(`${input.taskId}: checkpoint owner source mismatch`);
  if (
    input.expectedBranch !== undefined &&
    record.branch !== input.expectedBranch
  )
    throw new Error(`${input.taskId}: checkpoint owner branch mismatch`);
  if (
    input.expectedWorkdir !== undefined &&
    record.workdir !== input.expectedWorkdir
  )
    throw new Error(`${input.taskId}: checkpoint owner worktree mismatch`);
  if (input.worktreeStatus !== undefined && input.worktreeStatus !== "")
    throw new Error(`${input.taskId}: checkpoint owner worktree is dirty`);
  if (
    input.worktreeHeadSha !== undefined &&
    record.status === "preparing" &&
    input.worktreeHeadSha !== transition.sourceHeadSha
  )
    throw new Error(`${input.taskId}: checkpoint owner HEAD mismatch`);
  if (
    input.worktreeTreeSha !== undefined &&
    record.status === "preparing" &&
    input.worktreeTreeSha !== transition.sourceTreeSha
  )
    throw new Error(`${input.taskId}: checkpoint owner tree mismatch`);
  return record as CheckpointReproofOwnerRecord & {
    readonly mode: "checkpoint-reproof";
  };
};
