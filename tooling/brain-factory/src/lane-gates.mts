import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { commandsForProfiles, type GateCommand } from "./gates.js";
import { buildManifest } from "./manifest.js";
import { isCompatibleProofHead } from "./proof.js";
import {
  changedHandAuthoredSourceLines,
  validSourceSlices,
} from "./source-budget.js";

interface ProofPacket {
  readonly baseSha: string;
  readonly changedFiles: readonly string[];
  readonly focusedCommands: readonly string[];
  readonly headSha: string;
  readonly reviewVerdict: "pass" | "pending" | "rework";
  readonly taskId: string;
}

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const taskId = valueAfter("--task");
const evidence = valueAfter("--evidence");
const stage = valueAfter("--stage") ?? "pre-review";
if (!taskId || !evidence) {
  console.error(
    "usage: lane-gates --task <id> --evidence <absolute-dir> [--stage pre-review|final]",
  );
  process.exit(2);
}

const run = (command: GateCommand): void => {
  console.log(`+ rtk ${command.program} ${command.args.join(" ")}`);
  const result = spawnSync("rtk", [command.program, ...command.args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error(
      `${command.program} failed with status ${result.status ?? "unknown"}`,
    );
};

const manifest = buildManifest();
const task = manifest.tasks.find((candidate) => candidate.taskId === taskId);
if (!task) throw new Error(`unknown task ${taskId}`);
const laneDirectory = resolve(evidence, "lane-results", taskId);
const proofPath = resolve(laneDirectory, "ci-proof-packet.json");
if (!existsSync(proofPath)) throw new Error(`${taskId}: missing ${proofPath}`);
const proof = JSON.parse(readFileSync(proofPath, "utf8")) as ProofPacket;
if (proof.taskId !== taskId) throw new Error(`${taskId}: proof task mismatch`);
if (stage === "final" && proof.reviewVerdict !== "pass")
  throw new Error(`${taskId}: final proof lacks independent PASS review`);
if (!Array.isArray(proof.changedFiles) || proof.changedFiles.length === 0)
  throw new Error(`${taskId}: proof has no changed files`);
if (!Array.isArray(proof.focusedCommands) || proof.focusedCommands.length === 0)
  throw new Error(`${taskId}: proof has no focused commands`);
const forbidden =
  /(?:^|\s)(?:pnpm verify|just verify|pnpm pr:preflight|check:debt|check:gates)(?:\s|$)/;
if (proof.focusedCommands.some((command) => forbidden.test(command)))
  throw new Error(`${taskId}: broad command recorded as a lane-focused gate`);

const head = spawnSync("rtk", ["git", "rev-parse", "HEAD"], {
  cwd: process.cwd(),
  encoding: "utf8",
}).stdout.trim();
const ancestor = spawnSync(
  "rtk",
  ["git", "merge-base", "--is-ancestor", proof.headSha, head],
  { cwd: process.cwd(), stdio: "ignore" },
);
const treeDiff = spawnSync(
  "rtk",
  ["git", "diff", "--quiet", proof.headSha, head],
  { cwd: process.cwd(), stdio: "ignore" },
);
if (
  !isCompatibleProofHead({
    ancestorExit: ancestor.status,
    currentHead: head,
    proofHead: proof.headSha,
    treeDiffExit: treeDiff.status,
  })
)
  throw new Error(
    `${taskId}: proof head ${proof.headSha} is not a same-tree checkpoint ancestor of ${head}`,
  );
const commitList = spawnSync(
  "rtk",
  ["git", "rev-list", "--reverse", `${proof.baseSha}..${proof.headSha}`],
  { cwd: process.cwd(), encoding: "utf8" },
);
if (commitList.status !== 0)
  throw new Error(`${taskId}: could not enumerate task slices`);
const taskCommits = commitList.stdout.trim().split("\n").filter(Boolean);
const sourceSlices = taskCommits.map((commit) => {
  const numstat = spawnSync(
    "rtk",
    ["git", "show", "--numstat", "--format=", commit],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (numstat.status !== 0)
    throw new Error(`${taskId}: could not inspect slice ${commit}`);
  return {
    changedSourceLines: changedHandAuthoredSourceLines(numstat.stdout),
    commit,
  };
});
const oversizedSlice = sourceSlices.find(
  (slice) => slice.changedSourceLines > task.sourceSliceBudget,
);
if (
  !validSourceSlices(
    sourceSlices.map((slice) => slice.changedSourceLines),
    task.sourceSliceBudget,
    4,
  )
)
  throw new Error(
    oversizedSlice
      ? `${taskId}: slice ${oversizedSlice.commit} changes ${oversizedSlice.changedSourceLines} hand-authored source lines; split it below ${task.sourceSliceBudget}`
      : `${taskId}: expected one to four task slice commits, got ${taskCommits.length}`,
  );
const changedSourceLines = sourceSlices.reduce(
  (total, slice) => total + slice.changedSourceLines,
  0,
);
run({
  program: "git",
  args: ["diff", "--check", `${proof.baseSha}..${proof.headSha}`],
});
const existingChangedFiles = proof.changedFiles.filter((file) =>
  existsSync(resolve(file)),
);
if (existingChangedFiles.length > 0)
  run({
    program: "pnpm",
    args: ["exec", "prettier", "--check", ...existingChangedFiles],
  });
for (const command of commandsForProfiles(task.gateProfiles)) run(command);
const status = spawnSync("rtk", ["git", "status", "--porcelain"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
if (status.status !== 0 || status.stdout.trim() !== "")
  throw new Error(`${taskId}: lane worktree is not clean after gates`);

const reportPath = resolve(laneDirectory, "lane-gate-report.json");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      schemaVersion: "maestro-brain-lane-gate/v1",
      gateProfiles: task.gateProfiles,
      headSha: proof.headSha,
      changedSourceLines,
      estimateDrift: changedSourceLines > task.estimatedSourceLines,
      estimatedSourceLines: task.estimatedSourceLines,
      sourceSliceBudget: task.sourceSliceBudget,
      sourceSlices,
      stage,
      status: "passed",
      taskId,
    },
    null,
    2,
  )}\n`,
);
console.log(`${taskId}: lane gates passed (${stage})`);
