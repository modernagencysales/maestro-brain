import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureReviewWorktree,
  verifyReviewWorktree,
} from "../src/review-worktree-guard.js";

const roots: string[] = [];

const git = (directory: string, ...args: string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: directory,
    encoding: "utf8",
  }).trim();

const fixture = () => {
  const root = mkdtempSync(resolve(tmpdir(), "brain-review-guard-"));
  roots.push(root);
  const workdir = join(root, "worktree");
  const evidence = join(root, "evidence", "lane-results", "S01-T01");
  mkdirSync(workdir);
  mkdirSync(evidence, { recursive: true });
  git(workdir, "init");
  git(workdir, "config", "user.email", "review-guard@example.test");
  git(workdir, "config", "user.name", "Review Guard Test");
  writeFileSync(join(workdir, "tracked.txt"), "original\n");
  git(workdir, "add", "tracked.txt");
  git(workdir, "commit", "-m", "test: seed review guard");
  const proofPath = join(evidence, "ci-proof-packet.json");
  writeFileSync(proofPath, '{"reviewVerdict":"pending"}\n');
  return { workdir, proofPath };
};

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("review worktree guard", () => {
  it("allows the external proof packet to change", () => {
    const input = { ...fixture(), taskId: "S01-T01" };
    captureReviewWorktree(input);
    writeFileSync(input.proofPath, '{"reviewVerdict":"pass"}\n');
    expect(() => verifyReviewWorktree(input)).not.toThrow();
  });

  it("rejects a tracked review edit", () => {
    const input = { ...fixture(), taskId: "S01-T01" };
    captureReviewWorktree(input);
    writeFileSync(join(input.workdir, "tracked.txt"), "review mutation\n");
    expect(() => verifyReviewWorktree(input)).toThrow(
      "review worktree is not clean",
    );
  });

  it("rejects an untracked review write", () => {
    const input = { ...fixture(), taskId: "S01-T01" };
    captureReviewWorktree(input);
    writeFileSync(join(input.workdir, "review.tmp"), "mutation\n");
    expect(() => verifyReviewWorktree(input)).toThrow(
      "review worktree is not clean",
    );
  });

  it("rejects a proof packet placed inside the reviewed worktree", () => {
    const input = { ...fixture(), taskId: "S01-T01" };
    input.proofPath = join(input.workdir, "ci-proof-packet.json");
    writeFileSync(input.proofPath, '{"reviewVerdict":"pending"}\n');
    expect(() => captureReviewWorktree(input)).toThrow(
      "review proof must remain outside the reviewed worktree",
    );
  });

  it("rejects a review commit even when the worktree is clean", () => {
    const input = { ...fixture(), taskId: "S01-T01" };
    captureReviewWorktree(input);
    writeFileSync(join(input.workdir, "tracked.txt"), "committed mutation\n");
    git(input.workdir, "add", "tracked.txt");
    git(input.workdir, "commit", "-m", "test: simulate reviewer mutation");
    expect(() => verifyReviewWorktree(input)).toThrow("review changed HEAD");
  });
});
