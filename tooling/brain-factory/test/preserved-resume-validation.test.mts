import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validatePreservedResumeLaunch } from "../src/preserved-resume-validation.js";

const roots: string[] = [];
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "brain-preserved-resume-"));
  roots.push(root);
  const repo = join(root, "repo");
  const workdir = join(root, "worktree");
  const evidence = join(root, "evidence");
  mkdirSync(repo);
  mkdirSync(evidence, { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "factory@example.invalid");
  git(repo, "config", "user.name", "Factory Test");
  writeFileSync(join(repo, ".gitignore"), ".tokensave\n");
  writeFileSync(join(repo, "owned.txt"), "base\n");
  git(repo, "add", ".gitignore", "owned.txt");
  git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-b", "source");
  writeFileSync(join(repo, "owned.txt"), "source\n");
  git(repo, "commit", "-am", "source one");
  const sourceCommit = git(repo, "rev-parse", "HEAD");
  git(repo, "commit", "--allow-empty", "-m", "source checkpoint");
  const sourceHeadSha = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "main");
  writeFileSync(join(repo, "owned.txt"), "control\n");
  git(repo, "commit", "-am", "control");
  const control = git(repo, "rev-parse", "HEAD");
  const branch = "fabro/review-s08-t03";
  git(repo, "worktree", "add", "-b", branch, workdir, control);
  const commonDir = git(
    repo,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  );
  return {
    base,
    branch,
    commonDir,
    control,
    evidence,
    repo,
    sourceCommit,
    sourceHeadSha,
    workdir,
  };
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("preserved resume launch validation", () => {
  it("revalidates an exact clean registered worktree and proof", () => {
    const value = fixture();
    const proofDirectory = join(value.evidence, "lane-results", "S08-T03");
    mkdirSync(proofDirectory, { recursive: true });
    writeFileSync(
      join(proofDirectory, "ci-proof-packet.json"),
      JSON.stringify({
        baseSha: value.control,
        headSha: value.control,
        taskId: "S08-T03",
      }),
    );
    const expected = {
      baseSha: value.control,
      branch: value.branch,
      controlCommonDir: value.commonDir,
      evidence: value.evidence,
      expectedCommit: "none",
      mode: "preserved-worktree" as const,
      proofHead: value.control,
      resumeCommits: [value.sourceCommit],
      sourceHeadSha: value.sourceHeadSha,
      startSha: value.control,
      taskBaseSha: value.base,
      taskId: "S08-T03",
      workdir: value.workdir,
    };
    expect(validatePreservedResumeLaunch(expected)).toMatchObject({
      branch: value.branch,
      headSha: value.control,
      mode: "preserved-worktree",
      workdir: realpathSync(value.workdir),
    });
    expect(() =>
      validatePreservedResumeLaunch({
        ...expected,
        branch: "fabro/review-something-else",
      }),
    ).toThrow("branch mismatch");
    expect(() =>
      validatePreservedResumeLaunch({
        ...expected,
        controlCommonDir: join(value.repo, ".git", "other"),
      }),
    ).toThrow("common directory mismatch");
    expect(() =>
      validatePreservedResumeLaunch({
        ...expected,
        workdir: join(value.workdir, "alias"),
      }),
    ).toThrow("worktree path mismatch");
    writeFileSync(
      join(proofDirectory, "ci-proof-packet.json"),
      JSON.stringify({
        baseSha: value.control,
        headSha: value.base,
        taskId: "S08-T03",
      }),
    );
    expect(() => validatePreservedResumeLaunch(expected)).toThrow(
      "proof head mismatch",
    );
    writeFileSync(
      join(proofDirectory, "ci-proof-packet.json"),
      JSON.stringify({
        baseSha: value.control,
        headSha: value.control,
        taskId: "S08-T03",
      }),
    );
    git(value.workdir, "branch", "-m", "fabro/review-mutated");
    expect(() => validatePreservedResumeLaunch(expected)).toThrow(
      "branch mismatch",
    );
    git(value.workdir, "branch", "-m", value.branch);
    git(
      value.repo,
      "worktree",
      "move",
      value.workdir,
      join(value.repo, "..", "moved-worktree"),
    );
    expect(() => validatePreservedResumeLaunch(expected)).toThrow(
      "worktree path mismatch",
    );
  });

  it("binds a dirty conflict to the exact pinned cherry-pick commit", () => {
    const value = fixture();
    expect(() =>
      git(value.workdir, "cherry-pick", value.sourceCommit),
    ).toThrow();
    const expected = {
      baseSha: value.control,
      branch: value.branch,
      controlCommonDir: value.commonDir,
      evidence: value.evidence,
      expectedCommit: value.sourceCommit,
      mode: "preserved-conflict-aware" as const,
      proofHead: "none",
      resumeCommits: [value.sourceCommit],
      sourceHeadSha: value.sourceHeadSha,
      startSha: value.control,
      taskBaseSha: value.base,
      taskId: "S08-T03",
      workdir: value.workdir,
    };
    expect(validatePreservedResumeLaunch(expected)).toMatchObject({
      cherryPickHead: value.sourceCommit,
      mode: "preserved-conflict-aware",
    });
    writeFileSync(join(value.workdir, "untracked.txt"), "unsafe\n");
    expect(() => validatePreservedResumeLaunch(expected)).toThrow(
      "untracked files",
    );
    rmSync(join(value.workdir, "untracked.txt"));
    expect(() =>
      validatePreservedResumeLaunch({
        ...expected,
        expectedCommit: value.base,
      }),
    ).toThrow("outside pinned sequence");
    expect(() =>
      validatePreservedResumeLaunch({
        ...expected,
        resumeCommits: [value.control],
      }),
    ).toThrow("source commit range mismatch");
  });
});
