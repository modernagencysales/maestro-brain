type JsonRecord = Record<string, unknown>;
export const assertPlanOnlyAuthorityControllerStatus = (
  status: readonly string[],
): void => {
  if (status.some((line) => line !== "?? .mcp.json")) {
    throw new Error("plan-only authority controller is dirty");
  }
};

export const buildPlanOnlyLaneAuthorityLaunchSpec = (input: {
  readonly branch: string;
  readonly candidateHeadSha: string;
  readonly controlHeadSha: string;
  readonly evidence: string;
  readonly planSha256: string;
  readonly sourceBaseSha: string;
  readonly sourceCommits: readonly string[];
  readonly sourceCommitPatchSha256s: readonly string[];
  readonly sourceHeadSha: string;
  readonly sourceTreeSha: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
  readonly workdir: string;
}): {
  readonly configInputs: JsonRecord;
  readonly preparingRecord: JsonRecord;
} => ({
  configInputs: {
    base_sha: input.controlHeadSha,
    evidence_dir: input.evidence,
    resume_branch: input.branch,
    resume_commits: input.sourceCommits.join(","),
    resume_expected_commit: input.candidateHeadSha,
    resume_mode: "plan-only-authority",
    resume_source_head: input.sourceHeadSha,
    resume_task_base: input.sourceBaseSha,
    start_sha: input.candidateHeadSha,
    task_id: input.taskId,
    workdir: input.workdir,
  },
  preparingRecord: {
    baseSha: input.controlHeadSha,
    branch: input.branch,
    mode: "plan-only-lane-authority",
    planSha256: input.planSha256,
    sourceCommits: input.sourceCommits,
    sourceCommitPatchSha256s: input.sourceCommitPatchSha256s,
    sourceHeadSha: input.sourceHeadSha,
    sourceTreeSha: input.sourceTreeSha,
    status: "preparing",
    taskBaseSha: input.sourceBaseSha,
    taskBlockHash: input.taskBlockHash,
    taskId: input.taskId,
    workdir: input.workdir,
  },
});

export const runPlanOnlyLaneAuthorityLaunch = (input: {
  readonly reserveOwner: () => void;
  readonly prepareExactCandidate: () => string;
  readonly createRun: (headSha: string) => string;
  readonly recordRun: (runId: string) => void;
  readonly startRun: (runId: string) => void;
  readonly promoteOwner: (runId: string) => void;
}): string => {
  input.reserveOwner();
  const candidateHead = input.prepareExactCandidate();
  const runId = input.createRun(candidateHead);
  if (!runId) throw new Error("plan-only authority returned no run ID");
  input.recordRun(runId);
  input.startRun(runId);
  input.promoteOwner(runId);
  return runId;
};
