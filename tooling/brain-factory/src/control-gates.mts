import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { git } from "./integration-check-support.js";

const valueAfter = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const workdir = resolve(valueAfter("--workdir") ?? process.cwd());
const evidenceRoot = valueAfter("--evidence");
if (!evidenceRoot) throw new Error("--evidence is required");
const headSha = git(workdir, ["rev-parse", "HEAD"]);
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
      "tooling/brain-factory/src",
      "tooling/brain-factory/test",
    ],
  ],
  [
    "pnpm",
    [
      "exec",
      "prettier",
      "--check",
      "--ignore-unknown",
      "tooling/brain-factory/src",
      "tooling/brain-factory/test",
    ],
  ],
  ["pnpm", ["brain:factory:check"]],
];
const output = commands.map(([program, args]) => {
  const result = spawnSync(program, args, { cwd: workdir, encoding: "utf8" });
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
