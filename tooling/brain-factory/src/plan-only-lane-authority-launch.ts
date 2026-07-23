type JsonRecord = Record<string, unknown>;
interface ReservationInput {
  readonly branch: string;
  readonly controlHeadSha: string;
  readonly planSha256: string;
  readonly sourceBaseSha: string;
  readonly sourceCommits: readonly string[];
  readonly sourceCommitPatchSha256s: readonly string[];
  readonly sourceHeadSha: string;
  readonly sourceTreeSha: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
  readonly workdir: string;
  readonly workflowName: string;
}

export const buildPlanOnlyLaneAuthorityReservation = (
  input: ReservationInput,
): JsonRecord => ({
  baseSha: input.controlHeadSha,
  branch: input.branch,
  mode: "plan-only-lane-authority",
  phase: "reserved",
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
  workflowName: input.workflowName,
});
export const assertPlanOnlyAuthorityControllerStatus = (
  status: readonly string[],
): void => {
  if (status.some((line) => line !== "?? .mcp.json")) {
    throw new Error("plan-only authority controller is dirty");
  }
};

export const assertPlanOnlyWorkflowIdentity = (input: {
  readonly expected: string;
  readonly observed: unknown;
  readonly taskId: string;
}): void => {
  if (input.observed !== input.expected)
    throw new Error(
      `${input.taskId}: preparing owner workflow identity drifted`,
    );
};

export const buildPlanOnlyLaneAuthorityLaunchSpec = (input: {
  readonly branch: string;
  readonly candidateCommits: readonly string[];
  readonly candidateCommonDir: string;
  readonly candidateHeadSha: string;
  readonly candidateTreeSha: string;
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
  readonly workflowName: string;
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
    ...buildPlanOnlyLaneAuthorityReservation(input),
    candidateCommits: input.candidateCommits,
    candidateCommonDir: input.candidateCommonDir,
    candidateHeadSha: input.candidateHeadSha,
    candidateTreeSha: input.candidateTreeSha,
    candidateCommitPatchSha256s: input.sourceCommitPatchSha256s,
    phase: "replayed",
  },
});

export const buildPlanOnlyCandidateCheckpoint = (input: {
  readonly preparingRecord: JsonRecord;
  readonly prior?: JsonRecord;
}): JsonRecord =>
  input.prior?.phase === "creating"
    ? {
        ...input.preparingRecord,
        phase: "creating",
        ...(typeof input.prior.runId === "string"
          ? { runId: input.prior.runId }
          : {}),
      }
    : input.preparingRecord;

export const runPlanOnlyLaneAuthorityLaunch = (input: {
  readonly existingRunId?: string;
  readonly inspectRunStatus?: (runId: string) => string;
  readonly resolveExistingRunId?: () => string | undefined;
  readonly reserveOwner: () => void;
  readonly prepareExactCandidate: () => string;
  readonly createRun: (headSha: string) => string;
  readonly recordRun: (runId: string) => void;
  readonly startRun: (runId: string) => void;
  readonly promoteOwner: (runId: string) => void;
}): string => {
  input.reserveOwner();
  const candidateHead = input.prepareExactCandidate();
  const existingRunId = input.existingRunId ?? input.resolveExistingRunId?.();
  if (existingRunId) {
    if (!input.inspectRunStatus)
      throw new Error("plan-only run inspection is missing");
    const status = input.inspectRunStatus(existingRunId);
    if (new Set(["canceled", "cancelled", "failed", "succeeded"]).has(status))
      throw new Error(
        `plan-only durable run ${existingRunId} is terminal (${status})`,
      );
    if (status === "created") input.startRun(existingRunId);
    input.promoteOwner(existingRunId);
    return existingRunId;
  }
  const runId = input.createRun(candidateHead);
  if (!runId) throw new Error("plan-only authority returned no run ID");
  input.recordRun(runId);
  input.startRun(runId);
  input.promoteOwner(runId);
  return runId;
};
