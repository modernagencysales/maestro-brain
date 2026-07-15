import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type JsonRecord = Record<string, unknown>;

export const record = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
};

export const string = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

export const readJson = (path: string): JsonRecord =>
  record(JSON.parse(readFileSync(path, "utf8")), path);

export const git = (workdir: string, args: readonly string[]): string => {
  const result = spawnSync("rtk", ["proxy", "git", ...args], {
    cwd: workdir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `rtk proxy git ${args.join(" ")} failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
};

export const gitIsAncestor = (
  workdir: string,
  ancestor: string,
  descendant: string,
): boolean => {
  const result = spawnSync(
    "rtk",
    ["proxy", "git", "merge-base", "--is-ancestor", ancestor, descendant],
    { cwd: workdir, encoding: "utf8" },
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(
    `rtk proxy git merge-base --is-ancestor failed: ${result.stderr.trim()}`,
  );
};
