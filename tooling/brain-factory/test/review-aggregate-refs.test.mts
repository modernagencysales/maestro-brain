import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  aggregateParallelReviewBranches,
  collectParallelReviewLenses,
} from "../src/review-aggregate.mjs";
import {
  cleanupReviewWorktrees,
  prepareReviewWorktrees,
} from "../src/review-worktrees.js";
import { captureReviewWorktree } from "../src/review-worktree-guard.js";
import {
  DEFAULT_REVIEW_RUBRIC_IDS,
  type ReviewLensName,
} from "../src/review-lens.js";

const git = (repo: string, ...args: string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();

const fixture = () => {
  const repo = mkdtempSync(resolve(tmpdir(), "review-refs-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "review@example.test");
  git(repo, "config", "user.name", "Review Test");
  writeFileSync(resolve(repo, "README.md"), "base\n");
  writeFileSync(resolve(repo, ".gitignore"), ".tokensave/\n");
  git(repo, "add", "README.md", ".gitignore");
  git(repo, "-c", "core.hooksPath=/dev/null", "commit", "-qm", "base");
  const base = git(repo, "rev-parse", "HEAD");
  const tree = git(repo, "rev-parse", "HEAD^{tree}");
  const workdir = resolve(repo, "product-worktree");
  git(repo, "worktree", "add", "-q", "--detach", workdir, base);
  const taskId = "S03-T03";
  const attempt = "attempt-1";
  const evidence = resolve(repo, "evidence");
  const lane = resolve(evidence, "lane-results", taskId);
  mkdirSync(lane, { recursive: true });
  writeFileSync(
    resolve(lane, "ci-proof-packet.json"),
    `${JSON.stringify({
      taskId,
      planSha256: "plan",
      taskBlockHash: "contract",
      baseSha: "task-base",
      headSha: base,
    })}\n`,
  );

  const artifact = (lens: ReviewLensName, reviewerRunId: string) => ({
    lens,
    taskId,
    planSha256: "plan",
    taskBlockHash: "contract",
    baseSha: "task-base",
    headSha: base,
    treeSha: tree,
    reviewerRunId,
    rubricDispositions: DEFAULT_REVIEW_RUBRIC_IDS[lens].map((rubricId) => ({
      rubricId,
      disposition: "pass",
      evidence: [`${lens}.md#${rubricId}`],
    })),
    findings: [],
    verdict: "pass",
  });

  const checkpoint = (
    lens: ReviewLensName,
    extra?: { readonly path: string; readonly contents: string },
  ): string => {
    git(repo, "reset", "--hard", base);
    rmSync(resolve(repo, ".brain-review-output"), {
      recursive: true,
      force: true,
    });
    const branch = `maestro/review/${taskId}/${base}/${attempt}/${lens}`;
    mkdirSync(resolve(repo, ".brain-review-output"), { recursive: true });
    writeFileSync(
      resolve(repo, ".brain-review-output", `${lens}.json`),
      `${JSON.stringify(artifact(lens, branch), null, 2)}\n`,
    );
    if (extra) {
      mkdirSync(resolve(repo, extra.path, ".."), { recursive: true });
      writeFileSync(resolve(repo, extra.path), extra.contents);
    }
    git(repo, "add", ".brain-review-output");
    git(repo, "-c", "core.hooksPath=/dev/null", "commit", "-qm", lens);
    const commit = git(repo, "rev-parse", "HEAD");
    git(repo, "branch", "-f", branch, commit);
    return commit;
  };

  return {
    attempt,
    artifact,
    base,
    checkpoint,
    evidence,
    repo,
    taskId,
    workdir,
  };
};

describe("Fabro parallel review branch admission", () => {
  it("loads one immutable artifact per lens from the current fork visit", () => {
    const input = fixture();
    try {
      for (const lens of ["contract", "safety", "quality"] as const)
        input.checkpoint(lens);

      const result = collectParallelReviewLenses({
        attempt: input.attempt,
        reviewRepo: input.repo,
        workdir: input.workdir,
        evidence: input.evidence,
        taskId: input.taskId,
      });

      expect(result.artifacts.map(({ lens }) => lens)).toEqual([
        "contract",
        "safety",
        "quality",
      ]);
      expect(new Set(Object.values(result.commits)).size).toBe(3);
      expect(result.reviewerRunIds.contract).toBe(
        `maestro/review/${input.taskId}/${input.base}/${input.attempt}/contract`,
      );
    } finally {
      rmSync(input.repo, { recursive: true, force: true });
    }
  });

  it("rejects a checkpoint that contains a cross-lens write", () => {
    const input = fixture();
    try {
      input.checkpoint("contract", {
        path: ".brain-review-output/safety.json",
        contents: "{}\n",
      });
      input.checkpoint("safety");
      input.checkpoint("quality");

      expect(() =>
        collectParallelReviewLenses({
          attempt: input.attempt,
          reviewRepo: input.repo,
          workdir: input.workdir,
          evidence: input.evidence,
          taskId: input.taskId,
        }),
      ).toThrow("checkpoint delta");
    } finally {
      rmSync(input.repo, { recursive: true, force: true });
    }
  });

  it("rejects missing current-visit refs and forged reviewer coordinates", () => {
    const missing = fixture();
    try {
      missing.checkpoint("contract");
      missing.checkpoint("safety");
      expect(() =>
        collectParallelReviewLenses({
          attempt: missing.attempt,
          reviewRepo: missing.repo,
          workdir: missing.workdir,
          evidence: missing.evidence,
          taskId: missing.taskId,
        }),
      ).toThrow("quality");
    } finally {
      rmSync(missing.repo, { recursive: true, force: true });
    }

    const forged = fixture();
    try {
      forged.checkpoint("contract");
      forged.checkpoint("safety");
      forged.checkpoint("quality");
      const branch = `maestro/review/${forged.taskId}/${forged.base}/${forged.attempt}/contract`;
      git(forged.repo, "checkout", "-q", branch);
      writeFileSync(
        resolve(forged.repo, ".brain-review-output/contract.json"),
        `${JSON.stringify(forged.artifact("contract", "forged"))}\n`,
      );
      git(forged.repo, "add", ".brain-review-output/contract.json");
      git(
        forged.repo,
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--amend",
        "-qm",
        "forged",
      );
      expect(() =>
        collectParallelReviewLenses({
          attempt: forged.attempt,
          reviewRepo: forged.repo,
          workdir: forged.workdir,
          evidence: forged.evidence,
          taskId: forged.taskId,
        }),
      ).toThrow("reviewerRunId mismatch");
    } finally {
      rmSync(forged.repo, { recursive: true, force: true });
    }
  });

  it("retires an incomplete fork so the same workflow attempt can retry", async () => {
    const input = fixture();
    const attempt = "retry-attempt";
    const coordinates = {
      attemptId: attempt,
      evidence: input.evidence,
      headSha: input.base,
      taskId: input.taskId,
      workdir: input.workdir,
    };
    try {
      captureReviewWorktree({
        evidence: input.evidence,
        proofPath: resolve(
          input.evidence,
          "lane-results",
          input.taskId,
          "ci-proof-packet.json",
        ),
        taskId: input.taskId,
        workdir: input.workdir,
      });
      const prepared = prepareReviewWorktrees(coordinates);
      const safetyBranch = prepared.branches.safety;
      const safetyPath = prepared.paths.safety;
      mkdirSync(resolve(safetyPath, ".brain-review-output"), {
        recursive: true,
      });
      writeFileSync(
        resolve(safetyPath, ".brain-review-output/safety.json"),
        `${JSON.stringify(input.artifact("safety", safetyBranch), null, 2)}\n`,
      );
      git(safetyPath, "add", ".brain-review-output/safety.json");
      git(
        safetyPath,
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-qm",
        "review: checkpoint safety",
      );

      await expect(
        aggregateParallelReviewBranches({
          attempt,
          reviewRepo: input.workdir,
          workdir: input.workdir,
          evidence: input.evidence,
          taskId: input.taskId,
        }),
      ).rejects.toThrow("contract: review checkpoint is missing");

      const retiredRef = git(
        input.workdir,
        "for-each-ref",
        "--format=%(refname)",
        "refs/maestro-brain/review-worktrees/",
      )
        .split("\n")
        .find((ref) => ref.endsWith(`/attempts/${attempt}-v1`));
      expect(retiredRef).toBeDefined();
      if (!retiredRef) throw new Error("retired review receipt is missing");
      expect(
        JSON.parse(git(input.workdir, "cat-file", "blob", retiredRef)),
      ).toMatchObject({
        result: { outcome: "aborted", reason: "invalid-checkpoint" },
        status: "cleaned",
      });
      expect(
        git(
          input.workdir,
          "for-each-ref",
          "--format=%(refname)",
          "refs/maestro-brain/review-guards/",
        ),
      ).toBe("");

      const retry = prepareReviewWorktrees(coordinates);
      expect(retry.attemptId).toBe(`${attempt}-v2`);
      cleanupReviewWorktrees(coordinates);
    } finally {
      rmSync(input.repo, { recursive: true, force: true });
    }
  });
});
