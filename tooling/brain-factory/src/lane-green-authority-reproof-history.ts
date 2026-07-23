import { runRtk } from "./process.js";

export const assertLaneGreenAuthorityProofAncestry = (input: {
  readonly proofBaseSha: string;
  readonly proofHeadSha: string;
  readonly root: string;
  readonly taskId: string;
}): void => {
  try {
    runRtk(
      [
        "proxy",
        "git",
        "merge-base",
        "--is-ancestor",
        input.proofBaseSha,
        input.proofHeadSha,
      ],
      { cwd: input.root, quiet: true },
    );
  } catch (cause) {
    throw new Error(
      `${input.taskId}: proof base is not an ancestor of proof HEAD`,
      { cause },
    );
  }
};
