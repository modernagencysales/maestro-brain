import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { gitCommitPatchSha256 } from "./lane-green-authority-reproof-candidate.js";
import { assertLaneGreenAuthorityProofAncestry } from "./lane-green-authority-reproof-history.js";
import { laneGreenAuthorityLines as lines } from "./lane-green-authority-reproof-owner.js";
import type { LaneGreenAuthorityReproofCoordinates } from "./lane-green-authority-reproof-spec.js";
import {
  admitArchivedLaneGreenAuthorityRetry,
  loadAuditedLaneGreenAuthorityArchive,
} from "./lane-green-authority-terminal-retry.js";
import type { LaneGreenAuthorityReproofTransition } from "./manifest.js";
import { gitIsAncestor, runRtk } from "./process.js";

export const prepareArchivedLaneGreenAuthorityRetry = (input: {
  readonly actionId: string;
  readonly auditPath: string;
  readonly controlCommonDir: string;
  readonly controlHeadSha: string;
  readonly coordinates: LaneGreenAuthorityReproofCoordinates;
  readonly currentPlanSha256: string;
  readonly currentTaskBlockHash: string;
  readonly expectedArchiveSha256: string;
  readonly expectedCandidateHeadSha: string;
  readonly expectedCandidateTreeSha: string;
  readonly recordPath: string;
  readonly root: string;
  readonly taskId: string;
  readonly transition: LaneGreenAuthorityReproofTransition;
}): {
  readonly admission: ReturnType<typeof admitArchivedLaneGreenAuthorityRetry>;
  readonly archive: ReturnType<typeof loadAuditedLaneGreenAuthorityArchive>;
  readonly candidateHeadSha: string;
  readonly candidateTreeSha: string;
  readonly factoryBaseSha: string;
} => {
  const archive = loadAuditedLaneGreenAuthorityArchive({
    actionId: input.actionId,
    auditPath: input.auditPath,
    recordPath: input.recordPath,
    taskId: input.taskId,
  });
  if (archive.sha256 !== input.expectedArchiveSha256)
    throw new Error(`${input.taskId}: terminal archive content drift`);
  const factoryBaseSha = String(archive.record.factoryBaseSha ?? "");
  if (!/^[0-9a-f]{40}$/.test(factoryBaseSha))
    throw new Error(`${input.taskId}: archived factory base is invalid`);
  if (!gitIsAncestor(factoryBaseSha, input.controlHeadSha, input.root))
    throw new Error(
      `${input.taskId}: archived authority is outside current history`,
    );
  const sourceHeadSha = input.transition.sourceHeadSha;
  const sourceTreeSha = runRtk(
    ["proxy", "git", "rev-parse", `${sourceHeadSha}^{tree}`],
    { cwd: input.root, quiet: true },
  );
  const sourceChangedFiles = lines(
    runRtk(
      [
        "proxy",
        "git",
        "diff",
        "--name-only",
        "--no-renames",
        `${input.transition.sourceBaseSha}..${sourceHeadSha}`,
      ],
      { cwd: input.root, quiet: true },
    ),
  );
  const sourceCommitPatchSha256s = input.transition.sourceCommits.map(
    (commit) => gitCommitPatchSha256(input.root, commit),
  );
  const sourcePatchSha256 = createHash("sha256")
    .update(
      execFileSync(
        "rtk",
        [
          "proxy",
          "git",
          "diff",
          "--binary",
          `${input.transition.sourceBaseSha}..${sourceHeadSha}`,
        ],
        { cwd: input.root },
      ),
    )
    .digest("hex");
  const admission = admitArchivedLaneGreenAuthorityRetry({
    archive: archive.record,
    coordinates: input.coordinates,
    currentPlanSha256: input.currentPlanSha256,
    currentTaskBlockHash: input.currentTaskBlockHash,
    sourceChangedFiles,
    sourceCommitPatchSha256s,
    sourcePatchSha256,
    sourceTreeSha,
    taskId: input.taskId,
    transition: input.transition,
  });
  assertLaneGreenAuthorityProofAncestry({
    proofBaseSha: admission.proofBaseSha,
    proofHeadSha: admission.proofHeadSha,
    root: input.root,
    taskId: input.taskId,
  });
  const workdir = realpathSync(input.coordinates.workdir);
  const expectedWorkdir = realpathSync(
    resolve(
      input.root,
      "..",
      ".maestro-brain-fabro-workdirs",
      `reproof-${input.taskId.toLowerCase()}-green-${input.coordinates.authorityId}`,
    ),
  );
  const candidateHeadSha = runRtk(["git", "rev-parse", "HEAD"], {
    cwd: workdir,
    quiet: true,
  });
  const candidateTreeSha = runRtk(["git", "rev-parse", "HEAD^{tree}"], {
    cwd: workdir,
    quiet: true,
  });
  const candidateCommits = lines(
    runRtk(
      ["proxy", "git", "rev-list", "--reverse", `${factoryBaseSha}..HEAD`],
      { cwd: workdir, quiet: true },
    ),
  );
  const candidateFiles = lines(
    runRtk(["proxy", "git", "diff", "--name-only", `${factoryBaseSha}..HEAD`], {
      cwd: workdir,
      quiet: true,
    }),
  );
  const candidateLinear = candidateCommits.every((commit) =>
    /^[0-9a-f]{40} [0-9a-f]{40}$/.test(
      runRtk(["proxy", "git", "rev-list", "--parents", "-n", "1", commit], {
        cwd: workdir,
        quiet: true,
      }),
    ),
  );
  const candidateIdentityMatches =
    candidateHeadSha === input.expectedCandidateHeadSha &&
    candidateTreeSha === input.expectedCandidateTreeSha &&
    candidateCommits.length === admission.sourceCommits.length &&
    candidateLinear &&
    JSON.stringify(candidateFiles) ===
      JSON.stringify(admission.sourceChangedFiles) &&
    runRtk(["git", "branch", "--show-current"], {
      cwd: workdir,
      quiet: true,
    }) === input.coordinates.branch &&
    realpathSync(
      runRtk(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd: workdir, quiet: true },
      ),
    ) === realpathSync(input.controlCommonDir) &&
    runRtk(["proxy", "git", "status", "--porcelain=v1"], {
      cwd: workdir,
      quiet: true,
    }) === "";
  const registered = runRtk(
    ["proxy", "git", "worktree", "list", "--porcelain"],
    { cwd: input.root, quiet: true },
  )
    .split("\n\n")
    .some((entry) => {
      const values = new Set(entry.split("\n"));
      return (
        values.has(`worktree ${workdir}`) &&
        values.has(`HEAD ${candidateHeadSha}`) &&
        values.has(`branch refs/heads/${input.coordinates.branch}`)
      );
    });
  if (workdir !== expectedWorkdir || !registered || !candidateIdentityMatches)
    throw new Error(`${input.taskId}: archived candidate identity drift`);
  return {
    admission,
    archive,
    candidateHeadSha,
    candidateTreeSha,
    factoryBaseSha,
  };
};
