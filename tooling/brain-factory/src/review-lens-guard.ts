import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  DEFAULT_REVIEW_RUBRIC_IDS,
  type ReviewLensName,
  validateReviewLens,
} from "./review-lens.js";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

export const reviewBranchChangedFiles = (worktree: string): readonly string[] =>
  git(worktree, "status", "--porcelain=v1", "--untracked-files=all")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));

export const validateReviewBranchDelta = (
  lens: ReviewLensName,
  changedFiles: readonly string[],
): void => {
  const expected = `.brain-review-output/${lens}.json`;
  if (changedFiles.length !== 1 || changedFiles[0] !== expected)
    throw new Error(`${lens}: cross-lens or out-of-scope reviewer write`);
};

export const stageReviewLens = (input: {
  readonly attempt: string;
  readonly controlWorktree: string;
  readonly evidence: string;
  readonly lens: ReviewLensName;
  readonly taskId: string;
  readonly workdir: string;
}): void => {
  if (!isAbsolute(input.evidence) || !isAbsolute(input.workdir))
    throw new Error("review coordinates must be absolute");
  if (!/^S\d{2}-T\d{2}$/.test(input.taskId))
    throw new Error("review task coordinate is invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.attempt))
    throw new Error("review attempt coordinate is invalid");
  const headSha = git(input.workdir, "rev-parse", "HEAD");
  const treeSha = git(input.workdir, "rev-parse", "HEAD^{tree}");
  const branch = git(input.controlWorktree, "branch", "--show-current");
  const expectedBranch = new RegExp(
    `^maestro/review/${input.taskId}/${headSha}/${input.attempt}-v[1-9][0-9]*/${input.lens}$`,
  );
  if (!expectedBranch.test(branch))
    throw new Error(
      `${input.lens}: reviewer branch identity mismatch: ${branch || "(detached)"}`,
    );
  validateReviewBranchDelta(
    input.lens,
    reviewBranchChangedFiles(input.controlWorktree),
  );
  const proof = JSON.parse(
    readFileSync(
      resolve(
        input.evidence,
        "lane-results",
        input.taskId,
        "ci-proof-packet.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const artifact = JSON.parse(
    readFileSync(
      resolve(
        input.controlWorktree,
        ".brain-review-output",
        `${input.lens}.json`,
      ),
      "utf8",
    ),
  ) as unknown;
  validateReviewLens(artifact, {
    taskId: input.taskId,
    planSha256: String(proof.planSha256),
    taskBlockHash: String(proof.taskBlockHash),
    baseSha: String(proof.baseSha),
    headSha,
    treeSha,
    rubricIds: DEFAULT_REVIEW_RUBRIC_IDS,
    reviewerRunIds: {
      contract:
        input.lens === "contract" ? branch : `unused-contract-${branch}`,
      safety: input.lens === "safety" ? branch : `unused-safety-${branch}`,
      quality: input.lens === "quality" ? branch : `unused-quality-${branch}`,
    },
  });
  const artifactPath = `.brain-review-output/${input.lens}.json`;
  git(input.controlWorktree, "add", "--", artifactPath);
  git(
    input.controlWorktree,
    "-c",
    "user.name=Maestro Review Guard",
    "-c",
    "user.email=review-guard@maestro.invalid",
    "commit",
    "--no-verify",
    "-m",
    `review: checkpoint ${input.taskId} ${input.lens}`,
  );
  if (reviewBranchChangedFiles(input.controlWorktree).length !== 0)
    throw new Error(
      `${input.lens}: review worktree remained dirty after checkpoint`,
    );
};
