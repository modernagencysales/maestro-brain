import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { hydrateWorktreeDependencies } from "./dependencies.js";
import type { LaneGreenAuthorityReproofAdmission } from "./lane-green-authority-reproof.js";
import { laneGreenAuthorityLines as lines } from "./lane-green-authority-reproof-owner.js";
import type { LaneGreenAuthorityReproofCoordinates } from "./lane-green-authority-reproof-spec.js";
import { runRtk } from "./process.js";

export const assertExactLaneGreenAuthorityCandidate = (input: {
  readonly expected: {
    readonly branch: string;
    readonly changedFiles: readonly string[];
    readonly commitCount: number;
    readonly commonDir: string;
    readonly patchSha256: string;
  };
  readonly observed: {
    readonly branch: string;
    readonly changedFiles: readonly string[];
    readonly commits: readonly string[];
    readonly commonDir: string;
    readonly patchSha256: string;
    readonly status: string;
  };
  readonly taskId: string;
}): void => {
  const sameFiles =
    JSON.stringify([...input.observed.changedFiles].sort()) ===
    JSON.stringify([...input.expected.changedFiles].sort());
  if (
    input.observed.status !== "" ||
    input.observed.branch !== input.expected.branch ||
    input.observed.commonDir !== input.expected.commonDir ||
    input.observed.commits.length !== input.expected.commitCount ||
    !sameFiles ||
    input.observed.patchSha256 !== input.expected.patchSha256
  ) {
    throw new Error(`${input.taskId}: replayed candidate identity mismatch`);
  }
};

export const prepareExactLaneGreenAuthorityCandidate = (input: {
  readonly admission: LaneGreenAuthorityReproofAdmission;
  readonly controlCommonDir: string;
  readonly controlHeadSha: string;
  readonly coordinates: LaneGreenAuthorityReproofCoordinates;
  readonly reuseWorktree: boolean;
  readonly root: string;
  readonly taskId: string;
}): string => {
  if (!input.reuseWorktree) {
    runRtk(
      [
        "git",
        "worktree",
        "add",
        "-b",
        input.coordinates.branch,
        input.coordinates.workdir,
        input.controlHeadSha,
      ],
      { cwd: input.root },
    );
    hydrateWorktreeDependencies(input.root, input.coordinates.workdir);
    runRtk(["proxy", "git", "cherry-pick", ...input.admission.sourceCommits], {
      cwd: input.coordinates.workdir,
    });
  }
  const candidateHead = runRtk(["git", "rev-parse", "HEAD"], {
    cwd: input.coordinates.workdir,
    quiet: true,
  });
  const range = `${input.controlHeadSha}..${candidateHead}`;
  assertExactLaneGreenAuthorityCandidate({
    expected: {
      branch: input.coordinates.branch,
      changedFiles: input.admission.sourceChangedFiles,
      commitCount: input.admission.sourceCommits.length,
      commonDir: input.controlCommonDir,
      patchSha256: input.admission.sourcePatchSha256,
    },
    observed: {
      branch: runRtk(["git", "branch", "--show-current"], {
        cwd: input.coordinates.workdir,
        quiet: true,
      }),
      changedFiles: lines(
        runRtk(["proxy", "git", "diff", "--name-only", range], {
          cwd: input.coordinates.workdir,
          quiet: true,
        }),
      ),
      commits: lines(
        runRtk(["proxy", "git", "rev-list", "--reverse", range], {
          cwd: input.coordinates.workdir,
          quiet: true,
        }),
      ),
      commonDir: runRtk(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd: input.coordinates.workdir, quiet: true },
      ),
      patchSha256: createHash("sha256")
        .update(
          execFileSync("rtk", ["proxy", "git", "diff", "--binary", range], {
            cwd: input.coordinates.workdir,
          }),
        )
        .digest("hex"),
      status: runRtk(["git", "status", "--porcelain=v1"], {
        cwd: input.coordinates.workdir,
        quiet: true,
      }),
    },
    taskId: input.taskId,
  });
  return candidateHead;
};
