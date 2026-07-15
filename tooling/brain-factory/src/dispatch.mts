import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hydrateWorktreeDependencies } from "./dependencies.js";
import {
  acquireDispatcherLock,
  promoteTaskReservation,
  recoverTaskReservation,
  reserveTaskPreparing,
  runRecordOwnsTask,
} from "./dispatch-ownership.js";
import {
  completedTaskIdsForControlHead,
  type LaneCompletionResult,
} from "./factory-state.js";
import { buildManifest } from "./manifest.js";
import { gitBranchExists, gitIsAncestor, runRtk } from "./process.js";
import { selectReadyTasks } from "./scheduler.js";

interface RunRecord {
  readonly branch: string;
  readonly runId?: string;
  readonly status?: "launched" | "preparing";
  readonly taskId: string;
  readonly workdir: string;
}

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const maximum = Number(valueAfter("--max") ?? "6");
const launch = process.argv.includes("--launch");
const recoverDispatchLock = process.argv.includes("--recover-dispatch-lock");
const recoverTaskId = valueAfter("--recover-task");
const recoveryReason = valueAfter("--recovery-reason");
const requested = new Set(
  (valueAfter("--tasks") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
if (!Number.isInteger(maximum) || maximum < 1)
  throw new Error("--max must be a positive integer");
if ((recoverDispatchLock || recoverTaskId) && !recoveryReason?.trim()) {
  throw new Error("explicit recovery requires --recovery-reason");
}

const root = process.cwd();
const state = resolve(valueAfter("--state") ?? ".fabro/state/maestro-brain");
const worktreeRoot = resolve(root, "..", ".maestro-brain-fabro-workdirs");
const workflow = resolve(".fabro/workflows/brain-build-task/workflow.fabro");
const evidence = resolve(state, "evidence");
const runDirectory = resolve(state, "runs");
mkdirSync(runDirectory, { recursive: true });
mkdirSync(resolve(evidence, "lane-results"), { recursive: true });
mkdirSync(worktreeRoot, { recursive: true });
const now = new Date().toISOString();
const auditPath = resolve(state, "recovery-audit.jsonl");
const releaseDispatcherLock = acquireDispatcherLock({
  auditPath,
  lockPath: resolve(state, "dispatch.lock"),
  now,
  owner: {
    controlRoot: root,
    pid: process.pid,
    startedAt: now,
  },
  ...(recoverDispatchLock && recoveryReason ? { recoveryReason } : {}),
});
process.once("exit", releaseDispatcherLock);

const readResult = (taskId: string): LaneCompletionResult | undefined => {
  const path = resolve(evidence, "lane-results", taskId, "lane-result.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as LaneCompletionResult;
};
const resultStatus = (taskId: string): string | undefined =>
  readResult(taskId)?.status;
const recordPath = (taskId: string): string =>
  resolve(runDirectory, `${taskId}.json`);
const readRecord = (taskId: string): RunRecord | undefined => {
  const path = recordPath(taskId);
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as RunRecord)
    : undefined;
};
const recordOwnsTask = (record: RunRecord | undefined): boolean =>
  runRecordOwnsTask({
    recordExists: record !== undefined,
    inspect: () => {
      if (!record?.runId) return "preparing";
      const raw = runRtk(
        ["fabro", "inspect", record.runId, "--json", "--quiet"],
        {
          quiet: true,
        },
      );
      const parsed = JSON.parse(raw) as
        | { status?: { kind?: string } | string }
        | readonly { status?: { kind?: string } | string }[];
      const item = Array.isArray(parsed) ? parsed[0] : parsed;
      const status =
        typeof item?.status === "string" ? item.status : item?.status?.kind;
      return status;
    },
  });

const manifest = buildManifest(root);
const controlHead = runRtk(["git", "rev-parse", "HEAD"], { quiet: true });
if (recoverTaskId) {
  const task = manifest.tasks.find(
    (candidate) => candidate.taskId === recoverTaskId,
  );
  if (!task) throw new Error(`unknown recovery task ${recoverTaskId}`);
  const branch = `fabro/brain-${task.taskId.toLowerCase()}`;
  const workdir = resolve(worktreeRoot, task.taskId.toLowerCase());
  recoverTaskReservation({
    auditPath,
    branchExists: gitBranchExists(branch, root),
    now,
    ...(recoveryReason ? { reason: recoveryReason } : {}),
    recordPath: recordPath(task.taskId),
    taskId: task.taskId,
    worktreeExists: existsSync(workdir),
  });
}
const completedTaskIds = completedTaskIdsForControlHead({
  controlHead,
  isAncestor: (ancestor, descendant) =>
    gitIsAncestor(ancestor, descendant, root),
  resultFor: readResult,
  taskIds: manifest.tasks.map((task) => task.taskId),
});
const activeTasks = manifest.tasks.filter(
  (task) =>
    !completedTaskIds.has(task.taskId) &&
    (recordOwnsTask(readRecord(task.taskId)) ||
      resultStatus(task.taskId) === "lane_green"),
);
const { ready: candidates, selected } = selectReadyTasks({
  activeTaskIds: new Set(activeTasks.map((task) => task.taskId)),
  completedTaskIds,
  maximum,
  requestedTaskIds: requested,
  tasks: manifest.tasks,
});

console.log(
  JSON.stringify(
    {
      active: activeTasks.map((task) => task.taskId),
      launch,
      ready: candidates.map((task) => task.taskId),
      selected: selected.map((task) => task.taskId),
    },
    null,
    2,
  ),
);
if (!launch) process.exit(0);
if (!existsSync(workflow)) throw new Error(`missing workflow ${workflow}`);

const baseSha = controlHead;
for (const task of selected) {
  const branch = `fabro/brain-${task.taskId.toLowerCase()}`;
  const workdir = resolve(worktreeRoot, task.taskId.toLowerCase());
  const reservationPath = recordPath(task.taskId);
  reserveTaskPreparing(reservationPath, {
    baseSha,
    branch,
    reservedAt: now,
    status: "preparing",
    taskId: task.taskId,
    workdir,
  });
  if (existsSync(workdir)) {
    throw new Error(
      `${task.taskId}: unresolved worktree exists at ${workdir}; no force removal is allowed`,
    );
  }
  if (gitBranchExists(branch, root)) {
    throw new Error(
      `${task.taskId}: unresolved branch ${branch} exists; explicit audited recovery is required`,
    );
  }
  runRtk(["git", "worktree", "add", "-B", branch, workdir, baseSha]);
  hydrateWorktreeDependencies(root, workdir);
  const output = runRtk(
    [
      "fabro",
      "run",
      workflow,
      "--detach",
      "--json",
      "--no-upgrade-check",
      "--environment",
      "local",
      "--label",
      `task=${task.taskId}`,
      "-I",
      `workdir=${workdir}`,
      "-I",
      `evidence_dir=${evidence}`,
      "-I",
      `task_id=${task.taskId}`,
      "-I",
      `base_sha=${baseSha}`,
      "-I",
      `start_sha=${baseSha}`,
    ],
    { quiet: true },
  );
  const parsed = JSON.parse(output) as { run_id?: string; runId?: string };
  const runId = parsed.run_id ?? parsed.runId;
  if (!runId)
    throw new Error(`${task.taskId}: Fabro did not return a run ID: ${output}`);
  const record = {
    branch,
    runId,
    status: "launched",
    taskId: task.taskId,
    workdir,
  } satisfies RunRecord;
  promoteTaskReservation(reservationPath, record);
  console.log(`${task.taskId}: launched ${runId} in ${workdir}`);
}
