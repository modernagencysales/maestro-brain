export type ResumeGitRunner = (args: readonly string[]) => string;

export const nonEmptyResumeCommits = (input: {
  readonly changedPathsFor: (commit: string) => string;
  readonly revisionList: string;
}): readonly string[] =>
  input.revisionList
    .split("\n")
    .map((commit) => commit.trim())
    .filter(Boolean)
    .filter((commit) => input.changedPathsFor(commit).trim() !== "");

export const serializeResumeCommits = (
  taskId: string,
  commits: readonly string[],
): string => {
  if (commits.length === 0)
    throw new Error(`${taskId}: conflict-aware resume requires task commits`);
  for (const commit of commits) {
    if (!/^[0-9a-f]{40}$/i.test(commit))
      throw new Error(`${taskId}: invalid resume commit ${commit}`);
  }
  return commits.join(",");
};

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
  const taskCommits = nonEmptyResumeCommits({
    revisionList: input.runGit([
      "git",
      "rev-list",
      "--reverse",
      `${taskBaseSha}..${sourceHeadSha}`,
    ]),
    changedPathsFor: (commit) =>
      input.runGit([
        "git",
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        commit,
      ]),
  });
  if (taskCommits.length === 0) {
    throw new Error(
      `${input.taskId}: ${input.sourceRef} has no commits after ${input.taskBase}`,
    );
  }
  return { sourceHeadSha, taskBaseSha, taskCommits };
};
