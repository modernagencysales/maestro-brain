import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { commandsForProfiles, type GateCommand } from "./gates.js";
import { buildManifest } from "./manifest.js";
import { isCompatibleProofHead } from "./proof.js";
import { changedHandAuthoredSourceLines } from "./source-budget.js";

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
const numstat = spawnSync(
  "rtk",
  ["git", "diff", "--numstat", `${proof.baseSha}..${proof.headSha}`],
  { cwd: process.cwd(), encoding: "utf8" },
);
if (numstat.status !== 0)
  throw new Error(`${taskId}: could not calculate source-line budget`);
const changedSourceLines = changedHandAuthoredSourceLines(numstat.stdout);
if (changedSourceLines > task.sourceLineBudget)
  throw new Error(
    `${taskId}: ${changedSourceLines} changed hand-authored source lines exceed budget ${task.sourceLineBudget}; split or simplify the task`,
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
      sourceLineBudget: task.sourceLineBudget,
      stage,
      status: "passed",
      taskId,
    },
    null,
    2,
  )}\n`,
);
console.log(`${taskId}: lane gates passed (${stage})`);
