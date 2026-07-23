type JsonRecord = Record<string, unknown>;

export interface LaneGreenAuthorityReproofCoordinates {
  readonly authorityId: string;
  readonly branch: string;
  readonly workdir: string;
  readonly workflowName: string;
}

export interface LaneGreenAuthorityTerminalRetry {
  readonly archiveActionId: string;
  readonly archiveSha256: string;
  readonly candidateTreeSha: string;
  readonly priorRunId: string;
  readonly terminalStatus: string;
}

export const buildLaneGreenAuthorityReproofLaunchSpec = (input: {
  readonly controlCommonDir: string;
  readonly controlHeadSha: string;
  readonly controlRoot: string;
  readonly coordinates: LaneGreenAuthorityReproofCoordinates;
  readonly evidence: string;
  readonly planSha256: string;
  readonly proofBaseSha: string;
  readonly proofFindingIds: readonly string[];
  readonly proofGateStage: "pre-review";
  readonly proofHeadSha: string;
  readonly proofPlanSha256: string;
  readonly proofTaskBlockHash: string;
  readonly sourceBaseSha: string;
  readonly sourceCommits: readonly string[];
  readonly sourceCommitPatchSha256s: readonly string[];
  readonly sourceHeadSha: string;
  readonly sourceTreeSha: string;
  readonly startSha: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
  readonly terminalRetry?: LaneGreenAuthorityTerminalRetry;
}): {
  readonly configInputs: JsonRecord;
  readonly preparingRecord: JsonRecord;
} => ({
  configInputs: {
    authority_repair_archive: "none",
    base_sha: input.controlHeadSha,
    control_common_dir: input.controlCommonDir,
    control_root: input.controlRoot,
    evidence_dir: input.evidence,
    host_test_max_load_1m: "20",
    reproof_request: "none",
    resume_branch: input.coordinates.branch,
    resume_commits: input.sourceCommits.join(","),
    resume_expected_commit: "none",
    resume_mode: "none",
    resume_proof_head: input.sourceHeadSha,
    resume_source_head: input.sourceHeadSha,
    resume_task_base: input.sourceBaseSha,
    start_sha: input.startSha,
    task_id: input.taskId,
    workdir: input.coordinates.workdir,
  },
  preparingRecord: {
    baseSha: input.controlHeadSha,
    branch: input.coordinates.branch,
    factoryBaseSha: input.controlHeadSha,
    mode: "lane-green-authority-reproof",
    phase: "reserved",
    planSha256: input.planSha256,
    proofBaseSha: input.proofBaseSha,
    proofFindingIds: input.proofFindingIds,
    proofGateStage: input.proofGateStage,
    proofHeadSha: input.proofHeadSha,
    proofPlanSha256: input.proofPlanSha256,
    proofTaskBlockHash: input.proofTaskBlockHash,
    sourceCommits: input.sourceCommits,
    sourceCommitPatchSha256s: input.sourceCommitPatchSha256s,
    sourceHeadSha: input.sourceHeadSha,
    sourceTreeSha: input.sourceTreeSha,
    status: "preparing",
    taskBaseSha: input.sourceBaseSha,
    taskBlockHash: input.taskBlockHash,
    taskId: input.taskId,
    workdir: input.coordinates.workdir,
    workflowName: input.coordinates.workflowName,
    ...(input.terminalRetry === undefined
      ? {}
      : {
          terminalArchiveActionId: input.terminalRetry.archiveActionId,
          terminalArchiveSha256: input.terminalRetry.archiveSha256,
          terminalCandidateHeadSha: input.startSha,
          terminalCandidateTreeSha: input.terminalRetry.candidateTreeSha,
          terminalPriorRunId: input.terminalRetry.priorRunId,
          terminalStatus: input.terminalRetry.terminalStatus,
        }),
  },
});
