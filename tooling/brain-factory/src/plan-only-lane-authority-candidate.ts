import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { hydrateWorktreeDependencies } from "./dependencies.js";
import { gitCommitPatchSha256 } from "./lane-green-authority-reproof-candidate.js";
import { gitBranchExists, runRtk } from "./process.js";

export interface CandidateIdentity {
  readonly branch: string;
  readonly candidateCommits: readonly string[];
  readonly candidateHeadSha: string;
  readonly candidateTreeSha: string;
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
    input.observed.candidateHeadSha !== input.expected.candidateHeadSha ||
    input.observed.candidateTreeSha !== input.expected.candidateTreeSha ||
    input.observed.candidateCommits.at(-1) !==
      input.observed.candidateHeadSha ||
    input.observed.commonDir !== input.expected.commonDir ||
    JSON.stringify(input.observed.candidateCommits) !==
      JSON.stringify(input.expected.candidateCommits) ||
    JSON.stringify(input.observed.patchDigests) !==
      JSON.stringify(input.expected.patchDigests)
  )
    throw new Error("plan-only authority candidate identity mismatch");
};

const observeCandidate = (input: {
  readonly controlHeadSha: string;
  readonly workdir: string;
}): CandidateIdentity => {
  const candidateHeadSha = runRtk(["git", "rev-parse", "HEAD"], {
    cwd: input.workdir,
    quiet: true,
  });
  const candidateCommits = runRtk(
    [
      "proxy",
      "git",
      "rev-list",
      "--reverse",
      `${input.controlHeadSha}..${candidateHeadSha}`,
    ],
    { cwd: input.workdir, quiet: true },
  )
    .split("\n")
    .filter(Boolean);
  return {
    branch: runRtk(["git", "branch", "--show-current"], {
      cwd: input.workdir,
      quiet: true,
    }),
    candidateCommits,
    candidateHeadSha,
    candidateTreeSha: runRtk(["git", "rev-parse", "HEAD^{tree}"], {
      cwd: input.workdir,
      quiet: true,
    }),
    commonDir: runRtk(
      ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: input.workdir, quiet: true },
    ),
    patchDigests: candidateCommits.map((commit) =>
      gitCommitPatchSha256(input.workdir, commit),
    ),
    status: runRtk(["proxy", "git", "status", "--porcelain=v1"], {
      cwd: input.workdir,
      quiet: true,
    }),
  };
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
    workflowName: `BrainBuildTask${input.taskId.replace("-", "")}Plan${id}`,
  };
};

const replayDeterministically = (input: {
  readonly sourceCommits: readonly string[];
  readonly workdir: string;
}): void => {
  for (const commit of input.sourceCommits) {
    const value = (format: string): string =>
      runRtk(["proxy", "git", "show", "-s", `--format=${format}`, commit], {
        cwd: input.workdir,
        quiet: true,
      });
    runRtk(
      ["proxy", "git", "-c", "commit.gpgSign=false", "cherry-pick", commit],
      {
        cwd: input.workdir,
        env: {
          ...process.env,
          GIT_COMMITTER_DATE: value("%cI"),
          GIT_COMMITTER_EMAIL: value("%ce"),
          GIT_COMMITTER_NAME: value("%cn"),
        },
      },
    );
  }
};

export const preparePlanOnlyCandidate = (input: {
  readonly branch: string;
  readonly controlHeadSha: string;
  readonly expectedPatchDigests: readonly string[];
  readonly hydrate?: (root: string, workdir: string) => void;
  readonly preservedIdentity?: CandidateIdentity;
  readonly root: string;
  readonly sourceCommits: readonly string[];
  readonly workdir: string;
}): CandidateIdentity => {
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
    (input.hydrate ?? hydrateWorktreeDependencies)(input.root, input.workdir);
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
    if (input.preservedIdentity) {
      const observed = observeCandidate(input);
      assertPlanOnlyCandidateIdentity({
        expected: input.preservedIdentity,
        observed,
      });
      return observed;
    }
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
  replayDeterministically(input);
  const observed = observeCandidate(input);
  assertPlanOnlyCandidateIdentity({
    expected: {
      branch: input.branch,
      candidateCommits: observed.candidateCommits,
      candidateHeadSha: observed.candidateHeadSha,
      candidateTreeSha: observed.candidateTreeSha,
      commonDir: controlCommonDir,
      patchDigests: input.expectedPatchDigests,
      status: "",
    },
    observed,
  });
  if (observed.candidateCommits.length !== input.sourceCommits.length)
    throw new Error("plan-only authority candidate identity mismatch");
  return observed;
};
