import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  reviewBranchChangedFiles,
  stageReviewLens,
  validateReviewBranchDelta,
} from "../src/review-lens-guard.js";
import { DEFAULT_REVIEW_RUBRIC_IDS } from "../src/review-lens.js";

describe("parallel review lens guard", () => {
  it("accepts only the branch's named staging artifact", () => {
    expect(() =>
      validateReviewBranchDelta("contract", [
        ".brain-review-output/contract.json",
      ]),
    ).not.toThrow();
  });

  it("rejects a cross-lens staging write", () => {
    expect(() =>
      validateReviewBranchDelta("contract", [
        ".brain-review-output/contract.json",
        ".brain-review-output/safety.json",
      ]),
    ).toThrow("cross-lens");
  });

  it("enumerates a normal untracked lens file instead of collapsing its directory", () => {
    const root = mkdtempSync(resolve(tmpdir(), "review-untracked-all-"));
    try {
      execFileSync("rtk", ["proxy", "git", "init", "-q"], { cwd: root });
      execFileSync(
        "rtk",
        ["proxy", "git", "config", "user.email", "a@b.test"],
        { cwd: root },
      );
      execFileSync("rtk", ["proxy", "git", "config", "user.name", "Test"], {
        cwd: root,
      });
      writeFileSync(resolve(root, "seed"), "seed\n");
      execFileSync("rtk", ["proxy", "git", "add", "seed"], { cwd: root });
      execFileSync("rtk", ["proxy", "git", "commit", "-qm", "seed"], {
        cwd: root,
      });
      mkdirSync(resolve(root, ".brain-review-output"));
      writeFileSync(
        resolve(root, ".brain-review-output/contract.json"),
        "{}\n",
      );
      expect(reviewBranchChangedFiles(root)).toEqual([
        ".brain-review-output/contract.json",
      ]);
      expect(() =>
        validateReviewBranchDelta("contract", reviewBranchChangedFiles(root)),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("commits exactly one validated artifact on its managed review branch", () => {
    const container = mkdtempSync(resolve(tmpdir(), "review-guard-commit-"));
    const repo = resolve(container, "repo");
    const review = resolve(container, "review-contract");
    const evidence = resolve(container, "evidence");
    const taskId = "S03-T03";
    const attempt = "attempt-1";
    mkdirSync(repo);
    try {
      execFileSync("rtk", ["proxy", "git", "init", "-q"], { cwd: repo });
      execFileSync(
        "rtk",
        ["proxy", "git", "config", "core.hooksPath", "/dev/null"],
        { cwd: repo },
      );
      execFileSync(
        "rtk",
        ["proxy", "git", "config", "user.email", "a@b.test"],
        { cwd: repo },
      );
      execFileSync("rtk", ["proxy", "git", "config", "user.name", "Test"], {
        cwd: repo,
      });
      writeFileSync(resolve(repo, "seed"), "seed\n");
      execFileSync("rtk", ["proxy", "git", "add", "seed"], { cwd: repo });
      execFileSync("rtk", ["proxy", "git", "commit", "-qm", "seed"], {
        cwd: repo,
      });
      const headSha = execFileSync(
        "rtk",
        ["proxy", "git", "rev-parse", "HEAD"],
        {
          cwd: repo,
          encoding: "utf8",
        },
      ).trim();
      const treeSha = execFileSync(
        "rtk",
        ["proxy", "git", "rev-parse", "HEAD^{tree}"],
        { cwd: repo, encoding: "utf8" },
      ).trim();
      const branch = `maestro/review/${taskId}/${headSha}/${attempt}-v1/contract`;
      execFileSync(
        "rtk",
        [
          "proxy",
          "git",
          "worktree",
          "add",
          "-q",
          "-b",
          branch,
          review,
          headSha,
        ],
        { cwd: repo },
      );
      const lane = resolve(evidence, "lane-results", taskId);
      mkdirSync(lane, { recursive: true });
      writeFileSync(
        resolve(lane, "ci-proof-packet.json"),
        `${JSON.stringify({
          taskId,
          planSha256: "plan",
          taskBlockHash: "contract",
          baseSha: "base",
          headSha,
        })}\n`,
      );
      mkdirSync(resolve(review, ".brain-review-output"));
      writeFileSync(
        resolve(review, ".brain-review-output/contract.json"),
        `${JSON.stringify({
          lens: "contract",
          taskId,
          planSha256: "plan",
          taskBlockHash: "contract",
          baseSha: "base",
          headSha,
          treeSha,
          reviewerRunId: branch,
          rubricDispositions: DEFAULT_REVIEW_RUBRIC_IDS.contract.map(
            (rubricId) => ({
              rubricId,
              disposition: "pass",
              evidence: [`contract:${rubricId}`],
            }),
          ),
          findings: [],
          verdict: "pass",
        })}\n`,
      );

      stageReviewLens({
        attempt,
        controlWorktree: review,
        evidence,
        lens: "contract",
        taskId,
        workdir: repo,
      });

      expect(reviewBranchChangedFiles(review)).toEqual([]);
      expect(
        execFileSync(
          "rtk",
          [
            "proxy",
            "git",
            "diff-tree",
            "--no-commit-id",
            "--name-only",
            "-r",
            "HEAD",
          ],
          { cwd: review, encoding: "utf8" },
        ).trim(),
      ).toBe(".brain-review-output/contract.json");
      expect(
        execFileSync("rtk", ["proxy", "git", "rev-parse", "HEAD^"], {
          cwd: review,
          encoding: "utf8",
        }).trim(),
      ).toBe(headSha);
    } finally {
      rmSync(container, { recursive: true, force: true });
    }
  });
});
