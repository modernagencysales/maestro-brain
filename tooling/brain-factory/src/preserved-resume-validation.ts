import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { gitIsAncestor, runRtk } from "./process.js";

export interface PreservedResumeLaunchExpectation {
  readonly baseSha: string;
  readonly branch: string;
  readonly controlCommonDir: string;
  readonly evidence: string;
  readonly expectedCommit: string;
  readonly mode: "preserved-conflict-aware" | "preserved-worktree";
  readonly proofHead: string;
  readonly resumeCommits: readonly string[];
  readonly sourceHeadSha: string;
  readonly startSha: string;
  readonly taskId: string;
  readonly taskBaseSha: string;
  readonly workdir: string;
}

interface WorktreeRegistration {
  readonly HEAD?: string;
  readonly branch?: string;
  readonly worktree?: string;
}

const parseWorktrees = (value: string): readonly WorktreeRegistration[] =>
  value
    .split("\n\n")
    .filter(Boolean)
    .map((block) =>
      Object.fromEntries(
        block.split("\n").map((line) => {
          const separator = line.indexOf(" ");
          return separator < 0
            ? [line, ""]
            : [line.slice(0, separator), line.slice(separator + 1)];
        }),
      ),
    );

const validateSha = (value: string, label: string): void => {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`${label} is invalid`);
};

export const validatePreservedResumeLaunch = (
  expected: PreservedResumeLaunchExpectation,
): {
  readonly branch: string;
  readonly cherryPickHead?: string;
  readonly headSha: string;
  readonly mode: PreservedResumeLaunchExpectation["mode"];
  readonly workdir: string;
} => {
  validateSha(expected.baseSha, "preserved base SHA");
  validateSha(expected.startSha, "preserved start SHA");
  validateSha(expected.sourceHeadSha, "preserved source HEAD");
  validateSha(expected.taskBaseSha, "preserved task base");
  for (const commit of expected.resumeCommits)
    validateSha(commit, "preserved resume commit");
  if (!existsSync(expected.workdir))
    throw new Error("preserved worktree path mismatch");
  const workdir = realpathSync(expected.workdir);
  const git = (args: readonly string[]): string =>
    runRtk(["proxy", "git", ...args], { cwd: workdir, quiet: true });
  if (realpathSync(git(["rev-parse", "--show-toplevel"])) !== workdir) {
    throw new Error("preserved worktree path mismatch");
  }
  const branch = git(["branch", "--show-current"]);
  if (branch !== expected.branch) {
    throw new Error("preserved worktree branch mismatch");
  }
  const commonDir = realpathSync(
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  if (
    !existsSync(expected.controlCommonDir) ||
    commonDir !== realpathSync(expected.controlCommonDir)
  ) {
    throw new Error("preserved common directory mismatch");
  }
  const registration = parseWorktrees(
    git(["worktree", "list", "--porcelain"]),
  ).find(
    (candidate) =>
      candidate.worktree !== undefined &&
      existsSync(candidate.worktree) &&
      realpathSync(candidate.worktree) === workdir,
  );
  const headSha = git(["rev-parse", "HEAD"]);
  if (
    registration?.branch !== `refs/heads/${expected.branch}` ||
    registration.HEAD !== headSha
  ) {
    throw new Error("preserved registered worktree identity mismatch");
  }
  if (headSha !== expected.startSha) {
    throw new Error("preserved worktree HEAD mismatch");
  }
  if (!gitIsAncestor(expected.baseSha, headSha, workdir)) {
    throw new Error("preserved base is not an ancestor of worktree HEAD");
  }
  git(["cat-file", "-e", `${expected.sourceHeadSha}^{commit}`]);
  git(["cat-file", "-e", `${expected.taskBaseSha}^{commit}`]);
  if (!gitIsAncestor(expected.taskBaseSha, expected.sourceHeadSha, workdir)) {
    throw new Error("preserved task base is not an ancestor of source HEAD");
  }
  const sourceCommitRange = git([
    "rev-list",
    "--reverse",
    `${expected.taskBaseSha}..${expected.sourceHeadSha}`,
  ])
    .split("\n")
    .filter(Boolean);
  if (
    JSON.stringify(sourceCommitRange) !== JSON.stringify(expected.resumeCommits)
  ) {
    throw new Error("preserved source commit range mismatch");
  }

  const proofPath = resolve(
    expected.evidence,
    "lane-results",
    expected.taskId,
    "ci-proof-packet.json",
  );
  if (existsSync(proofPath)) {
    const proof = JSON.parse(readFileSync(proofPath, "utf8")) as {
      baseSha?: unknown;
      headSha?: unknown;
      taskId?: unknown;
    };
    if (
      expected.proofHead === "none" ||
      proof.taskId !== expected.taskId ||
      proof.baseSha !== expected.baseSha
    ) {
      throw new Error("preserved proof identity mismatch");
    }
    if (proof.headSha !== expected.proofHead) {
      throw new Error("preserved proof head mismatch");
    }
    const proofHead = String(proof.headSha ?? "");
    validateSha(proofHead, "preserved proof head");
    if (!gitIsAncestor(proofHead, headSha, workdir)) {
      throw new Error("preserved proof head is not an ancestor");
    }
  } else if (
    expected.mode === "preserved-worktree" ||
    expected.proofHead !== "none"
  ) {
    throw new Error("clean preserved resume requires an exact proof");
  }

  const status = git(["status", "--porcelain=v1"]);
  if (expected.mode === "preserved-worktree") {
    if (status !== "")
      throw new Error(`clean preserved worktree is dirty: ${status}`);
    return { branch, headSha, mode: expected.mode, workdir };
  }
  const statusLines = status.split("\n").filter(Boolean);
  if (statusLines.length === 0) {
    throw new Error("preserved conflict worktree is clean");
  }
  if (statusLines.some((line) => line.startsWith("??"))) {
    throw new Error(
      `preserved conflict contains untracked files: ${statusLines.join(",")}`,
    );
  }
  validateSha(expected.expectedCommit, "preserved expected commit");
  if (!expected.resumeCommits.includes(expected.expectedCommit)) {
    throw new Error("preserved expected commit is outside pinned sequence");
  }
  const markerPath = git([
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "CHERRY_PICK_HEAD",
  ]);
  if (!existsSync(markerPath)) {
    throw new Error("preserved conflict has no cherry-pick marker");
  }
  const cherryPickHead = readFileSync(markerPath, "utf8").trim();
  if (cherryPickHead !== expected.expectedCommit) {
    throw new Error("preserved cherry-pick commit mismatch");
  }

  const markerIndex = expected.resumeCommits.indexOf(cherryPickHead);
  const todoPath = git([
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "sequencer/todo",
  ]);
  const remaining = existsSync(todoPath)
    ? readFileSync(todoPath, "utf8")
        .split("\n")
        .filter((line) => line.startsWith("pick "))
        .map((line) => line.split(/\s+/)[1] ?? "")
        .map((commit) => git(["rev-parse", `${commit}^{commit}`]))
    : [];
  const suffixIncludingMarker = expected.resumeCommits.slice(markerIndex);
  const suffixAfterMarker = expected.resumeCommits.slice(markerIndex + 1);
  if (
    JSON.stringify(remaining) !== JSON.stringify(suffixIncludingMarker) &&
    JSON.stringify(remaining) !== JSON.stringify(suffixAfterMarker)
  ) {
    throw new Error("preserved cherry-pick sequence mismatch");
  }
  return {
    branch,
    cherryPickHead,
    headSha,
    mode: expected.mode,
    workdir,
  };
};
