import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { git, gitIsAncestor } from "./integration-check-support.js";
import { buildManifest } from "./manifest.js";

export const CONTROL_RECEIPT_SCHEMA =
  "maestro-brain-control-lane-receipt/v1" as const;

export interface ControlLaneReceipt {
  readonly schemaVersion: typeof CONTROL_RECEIPT_SCHEMA;
  readonly taskId: string;
  readonly headSha: string;
  readonly commitChain: readonly string[];
  readonly changedFiles: readonly string[];
  readonly sourceSliceLimit: number;
  readonly gateEvidence: readonly { path: string; sha256: string }[];
  readonly worktreeStatus: "clean";
}

const sha256 = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");
const fullSha = (value: string, label: string): string => {
  if (!/^[0-9a-f]{40}$/.test(value))
    throw new Error(`${label} must be a full 40-hex SHA`);
  return value;
};

export interface EmitControlLaneReceiptInput {
  readonly workdir: string;
  readonly evidenceRoot: string;
  readonly gateEvidence: readonly string[];
}

export const emitControlLaneReceipt = (
  input: EmitControlLaneReceiptInput,
): { receipt: ControlLaneReceipt; path: string; sha256: string } => {
  const task = buildManifest().tasks.find(
    (candidate) => candidate.taskId === "S15-T01",
  );
  if (!task || task.kind !== "control")
    throw new Error("S15-T01 control contract is missing");
  const chain = (task.controlCommitChain ?? []).map((value, index) =>
    fullSha(value, `control commit ${index + 1}`),
  );
  if (
    chain.length !== task.sourceSliceLimit ||
    new Set(chain).size !== chain.length
  )
    throw new Error(
      "control commit chain must contain exactly four unique commits",
    );
  const chainHead = chain[chain.length - 1];
  const chainStart = chain[0];
  if (!chainHead || !chainStart)
    throw new Error("control commit chain is empty");
  if (task.controlHeadSha !== chainHead)
    throw new Error("control head must equal chain tail");
  for (let i = 1; i < chain.length; i += 1) {
    const previous = chain[i - 1];
    const current = chain[i];
    if (
      !previous ||
      !current ||
      !gitIsAncestor(input.workdir, previous, current)
    )
      throw new Error("control commit chain is not ordered ancestry");
  }
  const headSha = git(input.workdir, ["rev-parse", "HEAD"]);
  if (headSha !== chainHead)
    throw new Error(
      `worktree HEAD ${headSha} does not equal control head ${chainHead}`,
    );
  if (git(input.workdir, ["status", "--porcelain"]) !== "")
    throw new Error("control worktree is not clean");
  const changedFiles = git(input.workdir, [
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    chainStart,
    chainHead,
  ])
    .split("\n")
    .filter(Boolean)
    .sort();
  const locks = [...task.fileLocks].sort();
  if (JSON.stringify(changedFiles) !== JSON.stringify(locks))
    throw new Error(
      "control commit chain changed files do not match manifest locks",
    );
  if (input.gateEvidence.length === 0)
    throw new Error("at least one focused gate evidence file is required");
  const gateEvidence = input.gateEvidence.map((path) => {
    if (!existsSync(path))
      throw new Error(`missing focused gate evidence: ${path}`);
    const content = readFileSync(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.toString("utf8"));
    } catch {
      throw new Error(`focused gate evidence is not JSON: ${path}`);
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { status?: unknown }).status !== "passed"
    )
      throw new Error(`focused gate evidence is not passed: ${path}`);
    return { path: resolve(path), sha256: sha256(content) };
  });
  const receipt: ControlLaneReceipt = {
    schemaVersion: CONTROL_RECEIPT_SCHEMA,
    taskId: task.taskId,
    headSha,
    commitChain: chain,
    changedFiles,
    sourceSliceLimit: task.sourceSliceLimit ?? 4,
    gateEvidence,
    worktreeStatus: "clean",
  };
  const content = `${JSON.stringify(receipt, null, 2)}\n`;
  const path = resolve(
    input.evidenceRoot,
    "control-lanes",
    task.taskId,
    `${headSha}.json`,
  );
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content)
      throw new Error(`immutable control receipt already exists: ${path}`);
    return { receipt, path, sha256: sha256(content) };
  }
  mkdirSync(resolve(input.evidenceRoot, "control-lanes", task.taskId), {
    recursive: true,
  });
  writeFileSync(path, content, { flag: "wx" });
  return { receipt, path, sha256: sha256(content) };
};
