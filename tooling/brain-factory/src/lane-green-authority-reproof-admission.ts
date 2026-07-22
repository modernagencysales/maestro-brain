import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveIntegratedPrerequisiteTaskIds } from "./authority-repair-prerequisites.js";
import {
  admitLaneGreenAuthorityReproof,
  type LaneGreenAuthorityReproofAdmission,
} from "./lane-green-authority-reproof.js";
import {
  buildManifest,
  PLAN_RELATIVE,
  taskBlockHashFromPlan,
  taskBlockHashWithoutLaneGreenAuthority,
} from "./manifest.js";
import { runRtk } from "./process.js";
import { changedHandAuthoredSourceLines } from "./source-budget.js";

type ManifestTask = ReturnType<typeof buildManifest>["tasks"][number];
type JsonRecord = Record<string, unknown>;

const lines = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const record = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return value as JsonRecord;
};

export const loadLaneGreenAuthorityReproofAdmission = (input: {
  readonly controlHeadSha: string;
  readonly evidence: string;
  readonly root: string;
  readonly task: ManifestTask;
}): LaneGreenAuthorityReproofAdmission => {
  const taskId = input.task.taskId;
  const transition = input.task.laneGreenAuthorityReproofTransition;
  if (!transition)
    throw new Error(`${taskId}: exact authority transition missing`);
  const laneDirectory = resolve(input.evidence, "lane-results", taskId);
  const lane = record(
    JSON.parse(
      readFileSync(resolve(laneDirectory, "lane-result.json"), "utf8"),
    ),
    `${taskId}: lane result`,
  );
  const proof = record(
    JSON.parse(
      readFileSync(resolve(laneDirectory, "ci-proof-packet.json"), "utf8"),
    ),
    `${taskId}: CI proof`,
  );
  const finalGate = record(
    JSON.parse(
      readFileSync(resolve(laneDirectory, "lane-gate-report.json"), "utf8"),
    ),
    `${taskId}: final gate`,
  );
  if (typeof lane.headSha !== "string") {
    throw new Error(`${taskId}: lane HEAD is missing`);
  }
  if (typeof proof.baseSha !== "string") {
    throw new Error(`${taskId}: proof base is missing`);
  }
  if (
    typeof proof.headSha !== "string" ||
    !/^[0-9a-f]{40}$/.test(proof.headSha)
  ) {
    throw new Error(`${taskId}: proof HEAD is invalid`);
  }
  const sourceHeadSha = transition.sourceHeadSha;
  const sourceBaseSha = transition.sourceBaseSha;
  if (!/^[0-9a-f]{40}$/.test(sourceHeadSha)) {
    throw new Error(`${taskId}: lane HEAD is invalid`);
  }
  if (!/^[0-9a-f]{40}$/.test(sourceBaseSha)) {
    throw new Error(`${taskId}: proof base is invalid`);
  }
  const sourceTreeSha = runRtk(
    ["proxy", "git", "rev-parse", `${sourceHeadSha}^{tree}`],
    { cwd: input.root, quiet: true },
  );
  runRtk(
    [
      "proxy",
      "git",
      "merge-base",
      "--is-ancestor",
      sourceBaseSha,
      sourceHeadSha,
    ],
    { cwd: input.root, quiet: true },
  );
  const sourceCommits = lines(
    runRtk(
      [
        "proxy",
        "git",
        "rev-list",
        "--reverse",
        `${sourceBaseSha}..${sourceHeadSha}`,
      ],
      { cwd: input.root, quiet: true },
    ),
  );
  const history = sourceCommits.map((commit) => {
    const revision = runRtk(
      ["proxy", "git", "rev-list", "--parents", "-n", "1", commit],
      { cwd: input.root, quiet: true },
    );
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
      parentCount: Math.max(0, revision.split(/\s+/).length - 1),
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
  const sourceChangedFiles = lines(
    runRtk(
      [
        "proxy",
        "git",
        "diff",
        "--name-only",
        "--no-renames",
        `${sourceBaseSha}..${sourceHeadSha}`,
      ],
      { cwd: input.root, quiet: true },
    ),
  );
  const proofChangedFiles = lines(
    runRtk(
      [
        "proxy",
        "git",
        "diff",
        "--name-only",
        "--no-renames",
        `${transition.proofBaseSha}..${transition.proofHeadSha}`,
      ],
      { cwd: input.root, quiet: true },
    ),
  );
  const sourcePatchSha256 = createHash("sha256")
    .update(
      execFileSync(
        "rtk",
        [
          "proxy",
          "git",
          "diff",
          "--binary",
          `${sourceBaseSha}..${sourceHeadSha}`,
        ],
        { cwd: input.root },
      ),
    )
    .digest("hex");
  const historicalPlan = execFileSync(
    "rtk",
    ["proxy", "git", "show", `${transition.proofBaseSha}:${PLAN_RELATIVE}`],
    { cwd: input.root, encoding: "utf8" },
  );
  const oldPlanSha256 = createHash("sha256")
    .update(historicalPlan)
    .digest("hex");
  const oldTaskBlockHash = taskBlockHashFromPlan(historicalPlan, taskId);
  const currentPlan = readFileSync(resolve(input.root, PLAN_RELATIVE), "utf8");
  const manifest = buildManifest(input.root);
  const integratedTaskIds = resolveIntegratedPrerequisiteTaskIds({
    controlHeadSha: input.controlHeadSha,
    evidence: input.evidence,
    isAncestor: (headSha, controlHeadSha) => {
      try {
        runRtk(
          [
            "proxy",
            "git",
            "merge-base",
            "--is-ancestor",
            headSha,
            controlHeadSha,
          ],
          { cwd: input.root, quiet: true },
        );
        return true;
      } catch {
        return false;
      }
    },
    requiredTasks: input.task.codeStartAfter.map((dependencyId) => {
      const dependency = manifest.tasks.find(
        (candidate) => candidate.taskId === dependencyId,
      );
      if (!dependency) {
        throw new Error(
          `${taskId}: unknown current prerequisite ${dependencyId}`,
        );
      }
      return { taskId: dependencyId, tranche: dependency.tranche };
    }),
  });
  return admitLaneGreenAuthorityReproof({
    controlHeadSha: input.controlHeadSha,
    currentTaskWithoutAuthorityHash: taskBlockHashWithoutLaneGreenAuthority(
      currentPlan,
      taskId,
    ),
    currentTask: {
      authorityAuthorized: true,
      codeStartAfter: input.task.codeStartAfter,
      fileLocks: input.task.fileLocks,
      planSha256: manifest.planSha256,
      sourceSliceBudget: input.task.sourceSliceBudget,
      sourceSliceLimit: input.task.sourceSliceLimit ?? 4,
      taskBlockHash: input.task.taskBlockHash,
      taskId,
    },
    finalGate,
    history,
    integratedTaskIds,
    lane,
    oldPlanSha256,
    oldTaskBlockHash,
    proof,
    proofChangedFiles,
    transition,
    sourceChangedFiles,
    sourcePatchSha256,
    sourceTreeSha,
  });
};
