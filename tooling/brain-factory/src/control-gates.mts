import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { git } from "./integration-check-support.js";
import { buildManifest } from "./manifest.js";

const valueAfter = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const workdir = resolve(valueAfter("--workdir") ?? process.cwd());
const controlRoot = resolve(valueAfter("--control-root") ?? process.cwd());
const evidenceRoot = valueAfter("--evidence");
if (!evidenceRoot) throw new Error("--evidence is required");
const headSha = git(workdir, ["rev-parse", "HEAD"]);
const control = buildManifest(controlRoot).tasks.find(
  (task) => task.taskId === "S15-T01",
);
if (
  !control ||
  control.kind !== "control" ||
  control.controlHeadSha !== headSha
)
  throw new Error("worktree HEAD is not the authorized S15-T01 control head");
if (git(workdir, ["status", "--porcelain"]) !== "")
  throw new Error("control worktree is not clean");
const commands: readonly (readonly [string, readonly string[]])[] = [
  [
    "pnpm",
    ["exec", "tsc", "-p", "tooling/brain-factory/tsconfig.json", "--noEmit"],
  ],
  [
    "pnpm",
    [
      "exec",
      "eslint",
      "tooling/brain-factory/src/integrate-wave.mts",
      "tooling/brain-factory/src/integration-lane-check.ts",
      "tooling/brain-factory/src/integration-wave.ts",
      "tooling/brain-factory/test/integration-result-check.test.mts",
      "tooling/brain-factory/test/integration-wave.test.mts",
    ],
  ],
  [
    "pnpm",
    [
      "exec",
      "prettier",
      "--check",
      "--ignore-unknown",
      "tooling/brain-factory/src/integrate-wave.mts",
      "tooling/brain-factory/src/integration-lane-check.ts",
      "tooling/brain-factory/src/integration-wave.ts",
      "tooling/brain-factory/test/integration-result-check.test.mts",
      "tooling/brain-factory/test/integration-wave.test.mts",
    ],
  ],
  ["pnpm", ["brain:factory:check"]],
  [
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "tooling/brain-factory/test/integration-result-check.test.mts",
      "tooling/brain-factory/test/integration-wave.test.mts",
    ],
  ],
];
const output = commands.map(([program, args]) => {
  const result = spawnSync("rtk", [program, ...args], {
    cwd: args[0] === "brain:factory:check" ? controlRoot : workdir,
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`${program} ${args.join(" ")} failed`);
  return {
    command: `${program} ${args.join(" ")}`,
    status: "passed" as const,
    headSha,
  };
});
const content = `${JSON.stringify({ schemaVersion: "maestro-brain-control-gate/v1", taskId: "S15-T01", status: "passed", headSha, gates: output }, null, 2)}\n`;
const path = resolve(
  evidenceRoot,
  "control-gates",
  "S15-T01",
  `${headSha}.json`,
);
mkdirSync(resolve(evidenceRoot, "control-gates", "S15-T01"), {
  recursive: true,
});
if (existsSync(path) && readFileSync(path, "utf8") !== content)
  throw new Error(`immutable gate evidence drift: ${path}`);
if (!existsSync(path)) writeFileSync(path, content, { flag: "wx" });
console.log(`${path} ${createHash("sha256").update(content).digest("hex")}`);
