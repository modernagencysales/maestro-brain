import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  admitAuthorityRefresh,
  assertAuthorityRefreshTerminalStatus,
  preserveAuthorityRefreshEvidence,
} from "./authority-refresh.js";
import { buildTaskLaunchEnv } from "./build-task-launch-env.js";
import { materializeBuildTaskRunConfig } from "./build-task-run-config.js";
import { hydrateWorktreeDependencies } from "./dependencies.js";
import {
  acquireDispatcherLock,
  archiveTerminalTaskRecord,
  promoteTaskReservation,
  reserveTaskPreparing,
} from "./dispatch-ownership.js";
import { buildManifest } from "./manifest.js";
import { gitBranchExists, gitCommonDir, runRtk } from "./process.js";
import { serializeResumeCommits } from "./resume-support.js";

interface SourceRecord {
  readonly branch?: unknown;
  readonly runId?: unknown;
  readonly taskId?: unknown;
  readonly workdir?: unknown;
}

const inspectedStatus = (runId: string): string => {
  const parsed = JSON.parse(
    runRtk(["fabro", "inspect", runId, "--json", "--quiet"], { quiet: true }),
  ) as
    | { status?: { kind?: string } | string }
    | readonly { status?: { kind?: string } | string }[];
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  const status =
    typeof item?.status === "string" ? item.status : item?.status?.kind;
  if (!status)
    throw new Error(`Fabro run ${runId} has no status; ownership is unknown`);
  return status;
};

export const launchAuthorityRefresh = (input: {
  readonly evidence: string;
  readonly recordPath: string;
  readonly root: string;
  readonly state: string;
  readonly taskId: string;
}): void => {
  if (!existsSync(input.recordPath)) {
    throw new Error(
      `${input.taskId}: authority refresh requires an active terminal task record`,
    );
  }
  const recordContent = readFileSync(input.recordPath, "utf8");
  const record = JSON.parse(recordContent) as SourceRecord;
  if (
    record.taskId !== input.taskId ||
    typeof record.runId !== "string" ||
    !record.runId ||
    typeof record.branch !== "string" ||
    !record.branch ||
    typeof record.workdir !== "string" ||
    !record.workdir
  ) {
    throw new Error(
      `${input.taskId}: authority refresh source record is incomplete`,
    );
  }
  const status = inspectedStatus(record.runId);
  assertAuthorityRefreshTerminalStatus(status, input.taskId);
  const manifest = buildManifest(input.root);
  const task = manifest.tasks.find(
    (candidate) => candidate.taskId === input.taskId,
  );
  if (!task) throw new Error(`unknown task ${input.taskId}`);
  const controlHeadSha = runRtk(["git", "rev-parse", "HEAD"], {
    quiet: true,
  });
  const admissionInput = {
    branchExists: (candidate: string) => gitBranchExists(candidate, input.root),
    controlHeadSha,
    evidence: input.evidence,
    root: input.root,
    runGit: (cwd: string, args: readonly string[]) =>
      runRtk(["proxy", "git", ...args], { cwd, quiet: true }),
    sourceBranch: record.branch,
    sourceWorkdir: record.workdir,
    task: {
      fileLocks: task.fileLocks,
      planSha256: manifest.planSha256,
      sourceSliceBudget: task.sourceSliceBudget,
      sourceSliceLimit: task.sourceSliceLimit ?? 4,
      taskBlockHash: task.taskBlockHash,
      taskId: input.taskId,
    },
  };
  let admission = admitAuthorityRefresh(admissionInput);
  const now = new Date().toISOString();
  const auditPath = resolve(input.state, "recovery-audit.jsonl");
  const releaseDispatcherLock = acquireDispatcherLock({
    auditPath,
    lockPath: resolve(input.state, "dispatch.lock"),
    now,
    owner: {
      controlRoot: input.root,
      mode: "authority-refresh",
      pid: process.pid,
      runId: record.runId,
      startedAt: now,
      taskId: input.taskId,
    },
  });
  process.once("exit", releaseDispatcherLock);
  if (
    readFileSync(input.recordPath, "utf8") !== recordContent ||
    runRtk(["git", "rev-parse", "HEAD"], { quiet: true }) !== controlHeadSha
  ) {
    throw new Error(
      `${input.taskId}: authority refresh ownership changed during admission`,
    );
  }
  admission = admitAuthorityRefresh(admissionInput);
  archiveTerminalTaskRecord({
    auditPath,
    now,
    recordPath: input.recordPath,
    runId: record.runId,
    status,
    taskId: input.taskId,
  });
  preserveAuthorityRefreshEvidence(admission);
  const { branch, workdir } = admission.coordinates;
  reserveTaskPreparing(input.recordPath, {
    authorityArchivePath: admission.archiveDirectory,
    branch,
    factoryBaseSha: controlHeadSha,
    mode: "authority-refresh",
    resumeStrategy: "in-lane-cherry-pick",
    sourceHeadSha: admission.sourceHeadSha,
    status: "preparing",
    taskBaseSha: admission.taskBaseSha,
    taskId: input.taskId,
    workdir,
  });
  runRtk(["git", "worktree", "add", "-b", branch, workdir, controlHeadSha]);
  hydrateWorktreeDependencies(input.root, workdir);
  const controlCommonDir = gitCommonDir(input.root);
  const serializedCommits = serializeResumeCommits(
    input.taskId,
    admission.sourceCommits,
  );
  const launchEnv = buildTaskLaunchEnv({
    baseSha: controlHeadSha,
    controlRoot: input.root,
    controlCommonDir,
    evidence: input.evidence,
    hostTestMaxLoad1m: "20",
    reproofRequest: "none",
    resumeBranch: branch,
    resumeCommits: serializedCommits,
    resumeExpectedCommit: "none",
    resumeMode: "conflict-aware",
    resumeProofHead: "none",
    resumeSourceHead: admission.sourceHeadSha,
    resumeTaskBase: admission.taskBaseSha,
    startSha: controlHeadSha,
    taskId: input.taskId,
    workdir,
  });
  const runConfig = materializeBuildTaskRunConfig({
    env: launchEnv,
    graph: resolve(".fabro/workflows/brain-build-task/workflow.fabro"),
    path: resolve(
      input.state,
      "launch-configs",
      `resume-${input.taskId}-authority-${admission.coordinates.authorityId}.toml`,
    ),
  });
  const output = runRtk(
    [
      "fabro",
      "run",
      runConfig,
      "--detach",
      "--json",
      "--no-upgrade-check",
      "--environment",
      "local",
      "--label",
      `task=${input.taskId}`,
      "--label",
      "mode=authority-refresh",
      "-I",
      `workdir=${workdir}`,
      "-I",
      `evidence_dir=${input.evidence}`,
      "-I",
      `task_id=${input.taskId}`,
      "-I",
      `base_sha=${controlHeadSha}`,
      "-I",
      `control_root=${input.root}`,
      "-I",
      `control_common_dir=${controlCommonDir}`,
      "-I",
      `start_sha=${controlHeadSha}`,
      "-I",
      `resume_branch=${branch}`,
      "-I",
      "resume_expected_commit=none",
      "-I",
      "resume_proof_head=none",
      "-I",
      "resume_mode=conflict-aware",
      "-I",
      `resume_source_head=${admission.sourceHeadSha}`,
      "-I",
      `resume_task_base=${admission.taskBaseSha}`,
      "-I",
      `resume_commits=${serializedCommits}`,
    ],
    { env: launchEnv, quiet: true },
  );
  const parsed = JSON.parse(output) as { run_id?: string; runId?: string };
  const runId = parsed.run_id ?? parsed.runId;
  if (!runId)
    throw new Error(
      `${input.taskId}: Fabro did not return a run ID: ${output}`,
    );
  promoteTaskReservation(input.recordPath, {
    authorityArchivePath: admission.archiveDirectory,
    branch,
    factoryBaseSha: controlHeadSha,
    mode: "authority-refresh",
    resumeStrategy: "in-lane-cherry-pick",
    runId,
    sourceHeadSha: admission.sourceHeadSha,
    status: "launched",
    taskBaseSha: admission.taskBaseSha,
    taskId: input.taskId,
    workdir,
  });
  console.log(`${input.taskId}: authority refresh launched as ${runId}`);
};
