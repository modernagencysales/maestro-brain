import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hydrateWorktreeDependencies } from "./dependencies.js";
import {
  acquireDispatcherLock,
  archiveTerminalTaskRecord,
  promoteTaskReservation,
  reserveTaskPreparing,
} from "./dispatch-ownership.js";
import { buildManifest } from "./manifest.js";
import { gitBranchExists, runRtk } from "./process.js";

interface ResumeRecord {
  readonly branch: string;
  readonly mode?: "resume-review";
  readonly runId?: string;
  readonly sourceHeadSha?: string;
  readonly status?: "launched" | "preparing";
  readonly taskBaseSha?: string;
  readonly taskId: string;
  readonly workdir: string;
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

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const taskId = valueAfter("--task");
const sourceRef = valueAfter("--ref");
const taskBase = valueAfter("--base");
if (!taskId || !sourceRef || !taskBase) {
  console.error(
    "usage: brain:factory:resume -- --task <id> --ref <git-ref> --base <sha>",
  );
  process.exit(2);
}
const root = process.cwd();
const task = buildManifest(root).tasks.find(
  (candidate) => candidate.taskId === taskId,
);
if (!task) throw new Error(`unknown task ${taskId}`);
const state = resolve(valueAfter("--state") ?? ".fabro/state/maestro-brain");
const evidence = resolve(state, "evidence");
const runDirectory = resolve(state, "runs");
const workdir = resolve(
  root,
  "..",
  ".maestro-brain-fabro-workdirs",
  `resume-${taskId.toLowerCase()}`,
);
const branch = `fabro/review-${taskId.toLowerCase()}`;
const workflow = resolve(".fabro/workflows/brain-build-task/workflow.fabro");
mkdirSync(runDirectory, { recursive: true });
mkdirSync(resolve(evidence, "lane-results", taskId), { recursive: true });
runRtk(["git", "fetch", "origin"]);
const now = new Date().toISOString();
const auditPath = resolve(state, "recovery-audit.jsonl");
const releaseDispatcherLock = acquireDispatcherLock({
  auditPath,
  lockPath: resolve(state, "dispatch.lock"),
  now,
  owner: {
    controlRoot: root,
    mode: "resume-review",
    pid: process.pid,
    startedAt: now,
    taskId,
  },
});
process.once("exit", releaseDispatcherLock);
const factoryBase = runRtk(["git", "rev-parse", "HEAD"], { quiet: true });
const sourceHeadSha = runRtk(["git", "rev-parse", sourceRef], { quiet: true });
const recordPath = resolve(runDirectory, `${taskId}.json`);
if (existsSync(recordPath)) {
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as ResumeRecord;
  if (!record.runId) {
    throw new Error(
      `${taskId}: incomplete task reservation owns resume; audited recovery is required`,
    );
  }
  const status = inspectedStatus(record.runId);
  const terminal = new Set([
    "canceled",
    "cancelled",
    "failed",
    "succeeded",
  ]).has(status);
  const exactResume =
    record.mode === "resume-review" &&
    record.taskId === taskId &&
    record.sourceHeadSha === sourceHeadSha &&
    record.taskBaseSha === taskBase &&
    record.branch === branch &&
    record.workdir === workdir;
  if (!terminal) {
    if (exactResume && existsSync(workdir) && gitBranchExists(branch, root)) {
      console.log(
        `${taskId}: resume already owned by ${record.runId} (${status})`,
      );
      process.exit(0);
    }
    throw new Error(
      `${taskId}: live or unknown Fabro run ${record.runId} (${status}) owns this task`,
    );
  }
  archiveTerminalTaskRecord({
    auditPath,
    now,
    recordPath,
    runId: record.runId,
    status,
    taskId,
  });
}
if (existsSync(workdir)) {
  throw new Error(
    `${taskId}: resume worktree already exists at ${workdir}; no force removal is allowed`,
  );
}
if (gitBranchExists(branch, root)) {
  throw new Error(
    `${taskId}: resume branch ${branch} already exists; no reset is allowed`,
  );
}
reserveTaskPreparing(recordPath, {
  branch,
  mode: "resume-review",
  sourceHeadSha,
  status: "preparing",
  taskBaseSha: taskBase,
  taskId,
  workdir,
});
runRtk(["git", "worktree", "add", "-b", branch, workdir, factoryBase]);
const taskCommits = runRtk(
  ["git", "rev-list", "--reverse", `${taskBase}..${sourceRef}`],
  { quiet: true },
)
  .split("\n")
  .filter(Boolean)
  .filter(
    (commit) =>
      runRtk(
        ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", commit],
        { quiet: true },
      ) !== "",
  );
if (taskCommits.length === 0)
  throw new Error(`${taskId}: ${sourceRef} has no commits after ${taskBase}`);
for (const commit of taskCommits)
  runRtk(["git", "cherry-pick", commit], { cwd: workdir });
const startSha = runRtk(["git", "rev-parse", "HEAD"], {
  cwd: workdir,
  quiet: true,
});
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
    `task=${taskId}`,
    "--label",
    "mode=resume-review",
    "-I",
    `workdir=${workdir}`,
    "-I",
    `evidence_dir=${evidence}`,
    "-I",
    `task_id=${taskId}`,
    "-I",
    `base_sha=${factoryBase}`,
    "-I",
    `start_sha=${startSha}`,
  ],
  { quiet: true },
);
const parsed = JSON.parse(output) as { run_id?: string; runId?: string };
const runId = parsed.run_id ?? parsed.runId;
if (!runId)
  throw new Error(`${taskId}: Fabro did not return a run ID: ${output}`);
promoteTaskReservation(recordPath, {
  branch,
  mode: "resume-review",
  runId,
  sourceHeadSha,
  status: "launched",
  taskBaseSha: taskBase,
  taskId,
  workdir,
});
console.log(`${taskId}: resumed ${sourceRef} as ${runId}`);
