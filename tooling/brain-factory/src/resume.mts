import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildManifest } from "./manifest.js";
import { runRtk } from "./process.js";

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
runRtk(["git", "fetch", "origin", sourceRef]);
if (existsSync(workdir))
  runRtk(["git", "worktree", "remove", "--force", workdir]);
const factoryBase = runRtk(["git", "rev-parse", "HEAD"], { quiet: true });
runRtk(["git", "worktree", "add", "-B", branch, workdir, factoryBase]);
const taskCommits = runRtk(
  ["git", "rev-list", "--reverse", `${taskBase}..${sourceRef}`],
  { quiet: true },
)
  .split("\n")
  .filter(Boolean);
if (taskCommits.length === 0)
  throw new Error(`${taskId}: ${sourceRef} has no commits after ${taskBase}`);
for (const commit of taskCommits)
  runRtk(["git", "cherry-pick", commit], { cwd: workdir });
const startSha = runRtk(["git", "rev-parse", "HEAD"], {
  cwd: workdir,
  quiet: true,
});
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
writeFileSync(
  resolve(runDirectory, `${taskId}.json`),
  `${JSON.stringify({ branch, runId, taskId, workdir }, null, 2)}\n`,
);
console.log(`${taskId}: resumed ${sourceRef} as ${runId}`);
