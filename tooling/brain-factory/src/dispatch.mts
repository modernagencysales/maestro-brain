import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { buildManifest } from "./manifest.js";
import { runRtk } from "./process.js";
import { selectReadyTasks } from "./scheduler.js";

interface RunRecord {
  readonly branch: string;
  readonly runId: string;
  readonly taskId: string;
  readonly workdir: string;
}

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const maximum = Number(valueAfter("--max") ?? "6");
const launch = process.argv.includes("--launch");
const requested = new Set(
  (valueAfter("--tasks") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
if (!Number.isInteger(maximum) || maximum < 1)
  throw new Error("--max must be a positive integer");

const root = process.cwd();
const state = resolve(valueAfter("--state") ?? ".fabro/state/maestro-brain");
const worktreeRoot = resolve(root, "..", ".maestro-brain-fabro-workdirs");
const workflow = resolve(".fabro/workflows/brain-build-task/workflow.fabro");
const evidence = resolve(state, "evidence");
const runDirectory = resolve(state, "runs");
mkdirSync(runDirectory, { recursive: true });
mkdirSync(resolve(evidence, "lane-results"), { recursive: true });
mkdirSync(worktreeRoot, { recursive: true });

const resultStatus = (taskId: string): string | undefined => {
  const path = resolve(evidence, "lane-results", taskId, "lane-result.json");
  if (!existsSync(path)) return undefined;
  return (JSON.parse(readFileSync(path, "utf8")) as { status?: string }).status;
};
const recordPath = (taskId: string): string =>
  resolve(runDirectory, `${taskId}.json`);
const readRecord = (taskId: string): RunRecord | undefined => {
  const path = recordPath(taskId);
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as RunRecord)
    : undefined;
};
const isActive = (record: RunRecord | undefined): boolean => {
  if (!record) return false;
  try {
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
    return !new Set([
      "cancelled",
      "canceled",
      "error",
      "errored",
      "failed",
      "succeeded",
      "timed_out",
      "timeout",
    ]).has(status ?? "unknown");
  } catch {
    return false;
  }
};

const manifest = buildManifest(root);
const activeTasks = manifest.tasks.filter((task) =>
  isActive(readRecord(task.taskId)),
);
const completedTaskIds = new Set(
  manifest.tasks
    .filter((task) =>
      ["integrated", "accepted"].includes(resultStatus(task.taskId) ?? ""),
    )
    .map((task) => task.taskId),
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

const baseSha = runRtk(["git", "rev-parse", "HEAD"], { quiet: true });
for (const task of selected) {
  const branch = `fabro/brain-${task.taskId.toLowerCase()}`;
  const workdir = resolve(worktreeRoot, task.taskId.toLowerCase());
  if (existsSync(workdir))
    runRtk(["git", "worktree", "remove", "--force", workdir]);
  runRtk(["git", "worktree", "add", "-B", branch, workdir, baseSha]);
  const rootModules = resolve(root, "node_modules");
  const worktreeModules = resolve(workdir, "node_modules");
  if (existsSync(rootModules) && !existsSync(worktreeModules))
    symlinkSync(rootModules, worktreeModules, "junction");
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
    taskId: task.taskId,
    workdir,
  } satisfies RunRecord;
  writeFileSync(
    recordPath(task.taskId),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.log(`${task.taskId}: launched ${runId} in ${workdir}`);
}
