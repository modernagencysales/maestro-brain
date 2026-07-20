import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { admitCheckpointReproof } from "./checkpoint-reproof.js";
import { buildTaskLaunchEnv } from "./build-task-launch-env.js";
import { materializeBuildTaskRunConfig } from "./build-task-run-config.js";
import { hydrateWorktreeDependencies } from "./dependencies.js";
import {
  acquireDispatcherLock,
  promoteTaskReservation,
  recordPreparingTaskLaunch,
  replaceTerminalTaskRecord,
} from "./dispatch-ownership.js";
import { buildManifest } from "./manifest.js";
import type { CheckpointReproofTransition } from "./manifest.js";
import { gitBranchExists, gitCommonDir, runRtk } from "./process.js";
import { resolveIntegratedPrerequisiteTaskIds } from "./authority-repair-prerequisites.js";

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

const terminalRunStatus = (runId: string): string => {
  const parsed = JSON.parse(
    runRtk(["fabro", "inspect", runId, "--json", "--quiet"], { quiet: true }),
  ) as
    | { status?: string | { kind?: string } }
    | readonly { status?: string | { kind?: string } }[];
  const value = Array.isArray(parsed) ? parsed[0] : parsed;
  const status =
    typeof value.status === "string" ? value.status : value.status?.kind;
  if (
    !status ||
    !new Set(["canceled", "cancelled", "failed", "succeeded"]).has(status)
  )
    throw new Error(`checkpoint source run ${runId} is not terminal`);
  return status;
};

export const launchCheckpointReproof = (input: {
  readonly evidence: string;
  readonly recordPath: string;
  readonly root: string;
  readonly state: string;
  readonly taskId: string;
}): void => {
  const recordContent = readFileSync(input.recordPath, "utf8");
  const prior = JSON.parse(recordContent) as {
    mode?: unknown;
    runId?: unknown;
    taskId?: unknown;
  };
  if (
    prior.taskId !== input.taskId ||
    typeof prior.runId !== "string" ||
    !prior.runId
  )
    throw new Error(
      `${input.taskId}: checkpoint reproof requires a prior run owner`,
    );
  const status = terminalRunStatus(prior.runId);
  const manifest = buildManifest(input.root);
  const task = manifest.tasks.find(
    (candidate) => candidate.taskId === input.taskId,
  );
  const transition = task?.checkpointReproofTransition;
  if (!task || !transition)
    throw new Error(
      `${input.taskId}: no checkpoint-reproof transition is authorized`,
    );
  const controlHeadSha = runRtk(["git", "rev-parse", "HEAD"], {
    cwd: input.root,
    quiet: true,
  });
  const coordinates = checkpointReproofCoordinates({
    controlHeadSha,
    planSha256: manifest.planSha256,
    root: input.root,
    taskBlockHash: task.taskBlockHash,
    taskId: task.taskId,
  });
  if (
    gitBranchExists(coordinates.branch, input.root) ||
    existsSync(coordinates.workdir)
  )
    throw new Error(
      `${input.taskId}: checkpoint recovery owner already exists`,
    );
  const integratedTaskIds = resolveIntegratedPrerequisiteTaskIds({
    controlHeadSha,
    evidence: input.evidence,
    isAncestor: (headSha, currentHead) => {
      try {
        runRtk(
          ["proxy", "git", "merge-base", "--is-ancestor", headSha, currentHead],
          {
            cwd: input.root,
            quiet: true,
          },
        );
        return true;
      } catch {
        return false;
      }
    },
    requiredTasks: transition.requiredIntegratedTaskIds.map((taskId) => ({
      taskId,
      tranche:
        manifest.tasks.find((candidate) => candidate.taskId === taskId)
          ?.tranche ?? "",
    })),
  });
  const admission = admitCheckpointReproof({
    controlHeadSha,
    evidence: input.evidence,
    existingRecoveryOwner: prior.mode === "checkpoint-reproof",
    integratedTaskIds,
    root: input.root,
    state: input.state,
    task: {
      taskId: task.taskId,
      fileLocks: task.fileLocks,
      planSha256: manifest.planSha256,
      taskBlockHash: task.taskBlockHash,
      sourceSliceBudget: task.sourceSliceBudget,
      sourceSliceLimit: task.sourceSliceLimit ?? 4,
    },
    transition,
  });
  const now = new Date().toISOString();
  const auditPath = resolve(input.state, "recovery-audit.jsonl");
  const release = acquireDispatcherLock({
    auditPath,
    lockPath: resolve(input.state, "dispatch.lock"),
    now,
    owner: {
      mode: "checkpoint-reproof",
      pid: process.pid,
      runId: prior.runId,
      startedAt: now,
      taskId: input.taskId,
    },
  });
  process.once("exit", release);
  if (readFileSync(input.recordPath, "utf8") !== recordContent)
    throw new Error(
      `${input.taskId}: checkpoint owner changed during admission`,
    );
  const preparing = {
    baseSha: controlHeadSha,
    branch: coordinates.branch,
    factoryBaseSha: controlHeadSha,
    mode: "checkpoint-reproof",
    resumeStrategy: "prelaunch-cherry-pick",
    sourceCommits: admission.sourceCommits,
    sourceHeadSha: admission.sourceHeadSha,
    sourceTreeSha: admission.sourceTreeSha,
    status: "preparing",
    taskBaseSha: admission.sourceBaseSha,
    taskId: input.taskId,
    workdir: coordinates.workdir,
  };
  replaceTerminalTaskRecord({
    auditPath,
    expectedContent: recordContent,
    now,
    recordPath: input.recordPath,
    replacement: preparing,
    runId: prior.runId,
    status,
    taskId: input.taskId,
  });
  const controlCommonDir = gitCommonDir(input.root);
  const runId = runCheckpointReproofLaunch({
    createCurrentWorktree: () => {
      runRtk(
        [
          "git",
          "worktree",
          "add",
          "-b",
          coordinates.branch,
          coordinates.workdir,
          controlHeadSha,
        ],
        { cwd: input.root },
      );
      hydrateWorktreeDependencies(input.root, coordinates.workdir);
    },
    cherryPickExactCheckpoint: () =>
      runRtk(["proxy", "git", "cherry-pick", ...admission.sourceCommits], {
        cwd: coordinates.workdir,
      }),
    launchNormalBuildTask: () => {
      const startSha = runRtk(["git", "rev-parse", "HEAD"], {
        cwd: coordinates.workdir,
        quiet: true,
      });
      const env = buildTaskLaunchEnv({
        authorityRepairArchive: "none",
        baseSha: controlHeadSha,
        controlCommonDir,
        controlRoot: input.root,
        evidence: input.evidence,
        hostTestMaxLoad1m: "20",
        reproofRequest: "none",
        resumeBranch: coordinates.branch,
        resumeCommits: "none",
        resumeExpectedCommit: "none",
        resumeMode: "none",
        resumeProofHead: "none",
        resumeSourceHead: admission.sourceHeadSha,
        resumeTaskBase: admission.sourceBaseSha,
        startSha,
        taskId: input.taskId,
        workdir: coordinates.workdir,
      });
      const config = materializeBuildTaskRunConfig({
        env,
        graph: resolve(".fabro/workflows/brain-build-task/workflow.fabro"),
        path: resolve(
          input.state,
          "launch-configs",
          `checkpoint-${input.taskId}-${coordinates.authorityId}.toml`,
        ),
      });
      const output = runRtk(
        [
          "fabro",
          "run",
          config,
          "--detach",
          "--json",
          "--no-upgrade-check",
          "--environment",
          "local",
          "--label",
          `task=${input.taskId}`,
          "--label",
          "mode=checkpoint-reproof",
        ],
        {
          env,
          quiet: true,
        },
      );
      const value = JSON.parse(output) as { run_id?: string; runId?: string };
      return value.run_id ?? value.runId ?? "";
    },
    recordOwner: (launchedRunId) =>
      recordPreparingTaskLaunch({
        auditPath,
        expected: preparing,
        now,
        recordPath: input.recordPath,
        runId: launchedRunId,
        taskId: input.taskId,
      }),
    promoteOwner: (launchedRunId) =>
      promoteTaskReservation(input.recordPath, {
        ...preparing,
        runId: launchedRunId,
        status: "launched",
      }),
    rollback: () => {
      try {
        runRtk(["git", "worktree", "remove", "--force", coordinates.workdir], {
          cwd: input.root,
        });
      } catch {
        rmSync(coordinates.workdir, { recursive: true, force: true });
      }
      try {
        runRtk(["git", "branch", "-D", coordinates.branch], {
          cwd: input.root,
        });
      } catch {
        // The worktree removal may already have removed the branch.
      }
      promoteTaskReservation(
        input.recordPath,
        JSON.parse(recordContent) as Record<string, unknown>,
      );
    },
  });
  release();
  console.log(`${input.taskId}: checkpoint reproof launched as ${runId}`);
};
