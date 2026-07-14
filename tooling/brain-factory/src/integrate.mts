import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runRtk } from "./process.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const tranche = valueAfter("--tranche");
if (!tranche) {
  console.error("usage: brain:factory:integrate -- --tranche <id>");
  process.exit(2);
}
const root = process.cwd();
const state = resolve(valueAfter("--state") ?? ".fabro/state/maestro-brain");
const evidence = resolve(state, "evidence");
const runs = resolve(state, "runs");
const workflow = resolve(
  ".fabro/workflows/brain-integrate-tranche/workflow.fabro",
);
const workdir = resolve(".fabro/workdirs", `integration-${tranche}`);
const branch = `fabro/brain-${tranche.toLowerCase()}`;
const baseSha = runRtk(["git", "rev-parse", "HEAD"], { quiet: true });
if (!existsSync(workflow)) throw new Error(`missing workflow ${workflow}`);
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
    "--label",
    `tranche=${tranche}`,
    "-I",
    `workdir=${workdir}`,
    "-I",
    `evidence_dir=${evidence}`,
    "-I",
    `tranche=${tranche}`,
    "-I",
    `base_sha=${baseSha}`,
  ],
  { quiet: true },
);
const parsed = JSON.parse(output) as { run_id?: string; runId?: string };
const runId = parsed.run_id ?? parsed.runId;
if (!runId) throw new Error(`Fabro did not return a run ID: ${output}`);
mkdirSync(runs, { recursive: true });
writeFileSync(
  resolve(runs, `integration-${tranche}.json`),
  `${JSON.stringify({ baseSha, branch, runId, tranche, workdir }, null, 2)}\n`,
);
console.log(`${tranche}: launched integration ${runId}`);
