import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { hydrateWorktreeDependencies } from "./dependencies.js";
import { gitCommitPatchSha256 } from "./lane-green-authority-reproof-candidate.js";
import { gitBranchExists, runRtk } from "./process.js";

interface CandidateIdentity {
  readonly branch: string;
  readonly commitCount: number;
  readonly commonDir: string;
  readonly patchDigests: readonly string[];
  readonly status: string;
}

export const assertPlanOnlyCandidateIdentity = (input: {
  readonly expected: CandidateIdentity;
  readonly observed: CandidateIdentity;
}): void => {
  if (
    input.observed.status !== "" ||
    input.observed.branch !== input.expected.branch ||
    input.observed.commonDir !== input.expected.commonDir ||
    input.observed.commitCount !== input.expected.commitCount ||
    JSON.stringify(input.observed.patchDigests) !==
      JSON.stringify(input.expected.patchDigests)
  )
    throw new Error("plan-only authority candidate identity mismatch");
};

export const planOnlyLaunchCoordinates = (input: {
  readonly controlHeadSha: string;
  readonly planSha256: string;
  readonly root: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
}) => {
  const id = createHash("sha256")
    .update(
      `${input.controlHeadSha}:${input.planSha256}:${input.taskBlockHash}:plan-only`,
    )
    .digest("hex")
    .slice(0, 12);
  const slug = input.taskId.toLowerCase();
  return {
    branch: `fabro/plan-only-${slug}-${id}`,
    workdir: resolve(
      input.root,
      "..",
      ".maestro-brain-fabro-workdirs",
      `plan-only-${slug}-${id}`,
    ),
  };
};

export const preparePlanOnlyCandidate = (input: {
  readonly branch: string;
  readonly controlHeadSha: string;
  readonly expectedPatchDigests: readonly string[];
  readonly root: string;
  readonly sourceCommits: readonly string[];
  readonly workdir: string;
}): string => {
  const controlCommonDir = runRtk(
    ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: input.root, quiet: true },
  );
  if (!existsSync(input.workdir)) {
    if (gitBranchExists(input.branch, input.root))
      throw new Error("plan-only authority branch exists without its worktree");
    runRtk(
      [
        "git",
        "worktree",
        "add",
        "-b",
        input.branch,
        input.workdir,
        input.controlHeadSha,
      ],
      { cwd: input.root },
    );
    hydrateWorktreeDependencies(input.root, input.workdir);
  } else {
    const branch = runRtk(["git", "branch", "--show-current"], {
      cwd: input.workdir,
      quiet: true,
    });
    const commonDir = runRtk(
      ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: input.workdir, quiet: true },
    );
    if (branch !== input.branch || commonDir !== controlCommonDir)
      throw new Error("plan-only authority candidate coordinates drifted");
    try {
      runRtk(["proxy", "git", "cherry-pick", "--abort"], {
        cwd: input.workdir,
        quiet: true,
      });
    } catch {
      // No active replay is the normal clean-reservation recovery case.
    }
    runRtk(["proxy", "git", "reset", "--hard", input.controlHeadSha], {
      cwd: input.workdir,
      quiet: true,
    });
  }
  runRtk(["proxy", "git", "cherry-pick", ...input.sourceCommits], {
    cwd: input.workdir,
  });
  const candidateHead = runRtk(["git", "rev-parse", "HEAD"], {
    cwd: input.workdir,
    quiet: true,
  });
  const commits = runRtk(
    [
      "proxy",
      "git",
      "rev-list",
      "--reverse",
      `${input.controlHeadSha}..${candidateHead}`,
    ],
    { cwd: input.workdir, quiet: true },
  )
    .split("\n")
    .filter(Boolean);
  const digests = commits.map((commit) =>
    gitCommitPatchSha256(input.workdir, commit),
  );
  assertPlanOnlyCandidateIdentity({
    expected: {
      branch: input.branch,
      commitCount: input.sourceCommits.length,
      commonDir: controlCommonDir,
      patchDigests: input.expectedPatchDigests,
      status: "",
    },
    observed: {
      branch: runRtk(["git", "branch", "--show-current"], {
        cwd: input.workdir,
        quiet: true,
      }),
      commitCount: commits.length,
      commonDir: runRtk(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd: input.workdir, quiet: true },
      ),
      patchDigests: digests,
      status: runRtk(["proxy", "git", "status", "--porcelain=v1"], {
        cwd: input.workdir,
        quiet: true,
      }),
    },
  });
  return candidateHead;
};
