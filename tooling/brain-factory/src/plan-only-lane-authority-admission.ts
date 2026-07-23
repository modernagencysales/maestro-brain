import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveIntegratedPrerequisiteTaskIds } from "./authority-repair-prerequisites.js";
import { gitCommitPatchSha256 } from "./lane-green-authority-reproof-candidate.js";
import {
  admitPlanOnlyLaneAuthority,
  type PlanOnlyLaneAuthorityAdmission,
  type PlanOnlyLaneAuthorityHistory,
} from "./plan-only-lane-authority.js";
import { runRtk } from "./process.js";
import { changedHandAuthoredSourceLines } from "./source-budget.js";
import type { BrainTaskManifest } from "./manifest.js";

type ManifestTask = BrainTaskManifest["tasks"][number];
type JsonRecord = Record<string, unknown>;

const lines = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const parseRecord = (bytes: Buffer, label: string): JsonRecord => {
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return value as JsonRecord;
};

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const historyForTransition = (input: {
  readonly root: string;
  readonly sourceCommits: readonly string[];
}): PlanOnlyLaneAuthorityHistory[] =>
  input.sourceCommits.map((commit) => {
    const parents = runRtk(
      ["proxy", "git", "rev-list", "--parents", "-n", "1", commit],
      { cwd: input.root, quiet: true },
    ).split(/\s+/);
    return {
      commit,
      files: lines(
        runRtk(
          [
            "proxy",
            "git",
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-only",
            "-r",
            "--no-renames",
            commit,
          ],
          { cwd: input.root, quiet: true },
        ),
      ),
      parentCount: Math.max(0, parents.length - 1),
      sourceLines: changedHandAuthoredSourceLines(
        runRtk(
          [
            "proxy",
            "git",
            "show",
            "--no-renames",
            "--numstat",
            "--format=",
            commit,
          ],
          { cwd: input.root, quiet: true },
        ),
      ),
    };
  });

export const resolvePlanOnlyIntegratedPrerequisites = (input: {
  readonly controlHeadSha: string;
  readonly evidence: string;
  readonly manifest: BrainTaskManifest;
  readonly root: string;
  readonly task: ManifestTask;
}): readonly string[] =>
  resolveIntegratedPrerequisiteTaskIds({
    controlHeadSha: input.controlHeadSha,
    evidence: input.evidence,
    isAncestor: (ancestor, descendant) => {
      try {
        runRtk(
          ["proxy", "git", "merge-base", "--is-ancestor", ancestor, descendant],
          { cwd: input.root, quiet: true },
        );
        return true;
      } catch {
        return false;
      }
    },
    requiredTasks: input.task.codeStartAfter.map((taskId) => {
      const dependency = input.manifest.tasks.find(
        (candidate) => candidate.taskId === taskId,
      );
      if (!dependency)
        throw new Error(`${input.task.taskId}: unknown prerequisite ${taskId}`);
      return { taskId, tranche: dependency.tranche };
    }),
  });

export const loadPlanOnlyLaneAuthorityAdmission = (input: {
  readonly controlHeadSha: string;
  readonly evidence: string;
  readonly integratedTaskIds?: readonly string[];
  readonly manifest: BrainTaskManifest;
  readonly ownerDisposition: "absent" | "terminal" | "live" | "unknown";
  readonly root: string;
  readonly task: ManifestTask;
}): PlanOnlyLaneAuthorityAdmission => {
  const transition = input.task.planOnlyLaneAuthorityTransition;
  if (!transition)
    throw new Error(`${input.task.taskId}: plan-only authority is missing`);
  const directory = resolve(input.evidence, "lane-results", input.task.taskId);
  const laneBytes = readFileSync(resolve(directory, "lane-result.json"));
  const proofBytes = readFileSync(resolve(directory, "ci-proof-packet.json"));
  const gateBytes = readFileSync(resolve(directory, "lane-gate-report.json"));
  const history = historyForTransition({
    root: input.root,
    sourceCommits: transition.sourceCommits,
  });
  return admitPlanOnlyLaneAuthority({
    controlHeadSha: input.controlHeadSha,
    currentTask: {
      codeStartAfter: input.task.codeStartAfter,
      fileLocks: input.task.fileLocks,
      planSha256: input.manifest.planSha256,
      sourceSliceBudget: input.task.sourceSliceBudget,
      sourceSliceLimit: input.task.sourceSliceLimit ?? 4,
      taskBlockHash: input.task.taskBlockHash,
      taskId: input.task.taskId,
    },
    evidenceSha256s: {
      ciProofPacket: sha256(proofBytes),
      laneGateReport: sha256(gateBytes),
      laneResult: sha256(laneBytes),
    },
    finalGate: parseRecord(gateBytes, `${input.task.taskId}: final gate`),
    history,
    integratedTaskIds:
      input.integratedTaskIds ??
      resolvePlanOnlyIntegratedPrerequisites({
        ...input,
        task: input.task,
      }),
    lane: parseRecord(laneBytes, `${input.task.taskId}: lane result`),
    ownerDisposition: input.ownerDisposition,
    proof: parseRecord(proofBytes, `${input.task.taskId}: CI proof`),
    sourceCommitPatchSha256s: transition.sourceCommits.map((commit) =>
      gitCommitPatchSha256(input.root, commit),
    ),
    sourceTreeSha: runRtk(
      ["proxy", "git", "rev-parse", `${transition.sourceHeadSha}^{tree}`],
      { cwd: input.root, quiet: true },
    ),
    transition,
  });
};
