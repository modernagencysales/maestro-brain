type JsonRecord = Record<string, unknown>;

export interface LaneGreenAuthorityReproofCoordinates {
  readonly authorityId: string;
  readonly branch: string;
  readonly workdir: string;
}

export const buildLaneGreenAuthorityReproofLaunchSpec = (input: {
  readonly controlCommonDir: string;
  readonly controlHeadSha: string;
  readonly controlRoot: string;
  readonly coordinates: LaneGreenAuthorityReproofCoordinates;
  readonly evidence: string;
  readonly planSha256: string;
  readonly sourceBaseSha: string;
  readonly sourceCommits: readonly string[];
  readonly sourceHeadSha: string;
  readonly sourceTreeSha: string;
  readonly startSha: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
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
    planSha256: input.planSha256,
    sourceCommits: input.sourceCommits,
    sourceHeadSha: input.sourceHeadSha,
    sourceTreeSha: input.sourceTreeSha,
    status: "preparing",
    taskBaseSha: input.sourceBaseSha,
    taskBlockHash: input.taskBlockHash,
    taskId: input.taskId,
    workdir: input.coordinates.workdir,
  },
});
