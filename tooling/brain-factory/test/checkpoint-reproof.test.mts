import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { admitCheckpointReproof } from "../src/checkpoint-reproof.js";
import { validateCheckpointReproofOwner } from "../src/checkpoint-reproof-launch.js";
import type { CheckpointReproofTransition } from "../src/manifest.js";

const roots: string[] = [];
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "checkpoint-reproof-"));
  roots.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "factory@example.invalid");
  git(root, "config", "user.name", "Factory Test");
  writeFileSync(join(root, "owned.txt"), "base\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  const sourceBaseSha = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "owned.txt"), "source\n");
  git(root, "commit", "-am", "source");
  const sourceHeadSha = git(root, "rev-parse", "HEAD");
  const sourceTreeSha = git(root, "rev-parse", "HEAD^{tree}");
  git(root, "checkout", "-b", "control", sourceBaseSha);
  writeFileSync(join(root, "plan.txt"), "current\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "current authority");
  const controlHeadSha = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, ".git", "info", "exclude"), ".evidence\n.state\n");
  const evidence = join(root, ".evidence");
  const state = join(root, ".state");
  const laneDir = join(evidence, "lane-results", "S04-T04");
  mkdirSync(join(laneDir, "review-lenses", sourceHeadSha), { recursive: true });
  mkdirSync(join(state, "runs"), { recursive: true });
  const oldPlan = "a".repeat(64);
  const oldTask = "b".repeat(64);
  const lane = `${JSON.stringify(
    {
      schemaVersion: "maestro-brain-lane-result/v1",
      taskId: "S04-T04",
      headSha: sourceHeadSha,
      treeSha: sourceTreeSha,
      status: "lane_green",
    },
    null,
    2,
  )}\n`;
  const gate = `${JSON.stringify(
    {
      schemaVersion: "maestro-brain-lane-gate/v1",
      taskId: "S04-T04",
      stage: "final",
      status: "passed",
      headSha: sourceHeadSha,
      currentHeadSha: sourceHeadSha,
      currentTreeSha: sourceTreeSha,
      planSha256: oldPlan,
      taskBlockHash: oldTask,
    },
    null,
    2,
  )}\n`;
  writeFileSync(join(laneDir, "lane-result.json"), lane);
  writeFileSync(join(laneDir, "lane-gate-report.json"), gate);
  const lensHashes = {} as Record<"contract" | "safety" | "quality", string>;
  for (const lens of ["contract", "safety", "quality"] as const) {
    const content = `${JSON.stringify({ lens, verdict: "pass", taskId: "S04-T04", headSha: sourceHeadSha })}\n`;
    writeFileSync(
      join(laneDir, "review-lenses", sourceHeadSha, `${lens}.json`),
      content,
    );
    lensHashes[lens] = sha256(content);
  }
  const prepared = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: root,
    encoding: "utf8",
    input: "prepared",
  }).trim();
  const promotedProofSha256 = "c".repeat(64);
  const receiptContent = JSON.stringify({
    status: "cleaned",
    taskId: "S04-T04",
    headSha: sourceHeadSha,
    treeSha: sourceTreeSha,
    planSha256: oldPlan,
    taskBlockHash: oldTask,
    preparedObject: prepared,
    result: {
      outcome: "promoted",
      reviewVerdict: "pass",
      proofSha256: promotedProofSha256,
      artifactSha256: lensHashes,
    },
  });
  const receiptObject = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: root,
    encoding: "utf8",
    input: receiptContent,
  }).trim();
  const reviewReceiptRef =
    "refs/maestro-brain/review-worktrees/test/S04-T04/checkpoint";
  git(root, "update-ref", reviewReceiptRef, receiptObject);
  const expansionContent = "approved expansion\n";
  const expansionObject = execFileSync(
    "git",
    ["hash-object", "-w", "--stdin"],
    {
      cwd: root,
      encoding: "utf8",
      input: expansionContent,
    },
  ).trim();
  const expansionRef =
    "refs/evidence/maestro-brain/s04-t04-slice-expansion-authority";
  git(root, "update-ref", expansionRef, expansionObject);
  const selectionPayloadSha256 = "d".repeat(64);
  const selection = `${JSON.stringify(
    {
      schemaVersion: "maestro-brain-integration-wave-selection/v3",
      integrationId: "wave-000050",
      selectionPayloadSha256,
      selectedTasks: [
        {
          taskId: "S04-T04",
          headSha: sourceHeadSha,
          gateHeadSha: sourceHeadSha,
          proofHeadSha: sourceHeadSha,
          laneResultSha256: sha256(lane),
          gateSha256: sha256(gate),
          proofSha256: promotedProofSha256,
          planSha256: oldPlan,
          taskBlockHash: oldTask,
        },
      ],
    },
    null,
    2,
  )}\n`;
  const selectionPath = join(
    state,
    "runs",
    "integration-wave-000050-selection.json",
  );
  writeFileSync(selectionPath, selection);
  const transition: CheckpointReproofTransition = {
    schemaVersion: "maestro-brain-checkpoint-reproof-transition/v1",
    fromPlanSha256: oldPlan,
    fromTaskBlockHash: oldTask,
    sourceBaseSha,
    sourceHeadSha,
    sourceTreeSha,
    sourceCommits: [sourceHeadSha],
    sourceSliceLines: [0],
    laneResultSha256: sha256(lane),
    finalGateSha256: sha256(gate),
    reviewReceiptRef,
    reviewReceiptObjectSha: receiptObject,
    reviewPreparedObjectSha: prepared,
    promotedProofSha256,
    reviewLensSha256: lensHashes,
    integrationId: "wave-000050",
    selectionPath,
    selectionFileSha256: sha256(selection),
    selectionPayloadSha256,
    sliceExpansionRef: expansionRef,
    sliceExpansionObjectSha: expansionObject,
    sliceExpansionSha256: sha256(expansionContent),
    requiredIntegratedTaskIds: ["S04-T02"],
  };
  return { controlHeadSha, evidence, root, state, transition };
};

afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

describe("checkpoint reproof admission", () => {
  it("admits only the exact immutable checkpoint without reconstructing proof", () => {
    const value = fixture();
    const admission = admitCheckpointReproof({
      ...value,
      integratedTaskIds: ["S04-T02"],
      existingRecoveryOwner: false,
      task: {
        taskId: "S04-T04",
        fileLocks: ["owned.txt"],
        planSha256: "e".repeat(64),
        taskBlockHash: "f".repeat(64),
        sourceSliceBudget: 300,
        sourceSliceLimit: 5,
      },
    });
    expect(admission.sourceCommits).toEqual(value.transition.sourceCommits);
    expect(admission.mode).toBe("checkpoint-reproof");
  });

  it("fails closed on drift, unintegrated prerequisites, and recovery owners", () => {
    const value = fixture();
    const base = {
      ...value,
      integratedTaskIds: ["S04-T02"],
      existingRecoveryOwner: false,
      task: {
        taskId: "S04-T04",
        fileLocks: ["owned.txt"],
        planSha256: "e".repeat(64),
        taskBlockHash: "f".repeat(64),
        sourceSliceBudget: 300,
        sourceSliceLimit: 5,
      },
    };
    expect(() =>
      admitCheckpointReproof({ ...base, existingRecoveryOwner: true }),
    ).toThrow(/recovery owner already exists/);
    expect(() =>
      admitCheckpointReproof({ ...base, integratedTaskIds: [] }),
    ).toThrow(/prerequisite is not integrated/);
    const lane = join(
      value.evidence,
      "lane-results",
      "S04-T04",
      "lane-result.json",
    );
    writeFileSync(lane, `${readFileSync(lane, "utf8")} `);
    expect(() => admitCheckpointReproof(base)).toThrow(
      /lane result hash mismatch/,
    );
  });

  it("preserves only a clean exact checkpoint-reproof owner", () => {
    const value = fixture();
    expect(
      validateCheckpointReproofOwner({
        record: {
          mode: "checkpoint-reproof",
          taskId: "S04-T04",
          sourceHeadSha: value.transition.sourceHeadSha,
          sourceTreeSha: value.transition.sourceTreeSha,
          sourceCommits: value.transition.sourceCommits,
        },
        taskId: "S04-T04",
        transition: value.transition,
      }).mode,
    ).toBe("checkpoint-reproof");
    expect(() =>
      validateCheckpointReproofOwner({
        record: { mode: "authority-repair", taskId: "S04-T04" },
        taskId: "S04-T04",
        transition: value.transition,
      }),
    ).toThrow(/owner mode mismatch/);
  });
});
