export type ResumeGitRunner = (args: readonly string[]) => string;

const requiredOutput = (value: string, label: string): string => {
  const output = value.trim();
  if (!output) throw new Error(`${label} resolved to an empty value`);
  return output;
};

export const validateResumeSource = (input: {
  readonly runGit: ResumeGitRunner;
  readonly sourceRef: string;
  readonly taskBase: string;
  readonly taskId: string;
}): {
  readonly sourceHeadSha: string;
  readonly taskBaseSha: string;
  readonly taskCommits: readonly string[];
} => {
  const taskBaseSha = requiredOutput(
    input.runGit([
      "git",
      "rev-parse",
      "--verify",
      `${input.taskBase}^{commit}`,
    ]),
    `${input.taskId}: task base`,
  );
  const sourceHeadSha = requiredOutput(
    input.runGit([
      "git",
      "rev-parse",
      "--verify",
      `${input.sourceRef}^{commit}`,
    ]),
    `${input.taskId}: source ref`,
  );
  try {
    input.runGit([
      "git",
      "merge-base",
      "--is-ancestor",
      taskBaseSha,
      sourceHeadSha,
    ]);
  } catch {
    throw new Error(
      `${input.taskId}: ${input.sourceRef} is not descended from ${input.taskBase}`,
    );
  }
  const taskCommits = input
    .runGit([
      "git",
      "rev-list",
      "--reverse",
      `${taskBaseSha}..${sourceHeadSha}`,
    ])
    .split("\n")
    .map((commit) => commit.trim())
    .filter(Boolean)
    .filter(
      (commit) =>
        input
          .runGit([
            "git",
            "diff-tree",
            "--no-commit-id",
            "--name-only",
            "-r",
            commit,
          ])
          .trim() !== "",
    );
  if (taskCommits.length === 0) {
    throw new Error(
      `${input.taskId}: ${input.sourceRef} has no commits after ${input.taskBase}`,
    );
  }
  return { sourceHeadSha, taskBaseSha, taskCommits };
};
