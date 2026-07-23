export type TerminalContractReproofRecord = Record<string, unknown>;

const terminalStatuses = new Set([
  "canceled",
  "cancelled",
  "failed",
  "succeeded",
]);

const string = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} is missing`);
  return value;
};

const sha = (value: unknown, length: 40 | 64, label: string): string => {
  const result = string(value, label);
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(result))
    throw new Error(`${label} is invalid`);
  return result;
};

const record = (
  value: unknown,
  label: string,
): TerminalContractReproofRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} is not an object`);
  return value as TerminalContractReproofRecord;
};

export interface TerminalContractReproofResumeInput {
  readonly admittedRequest: TerminalContractReproofRecord;
  readonly authorityRepairArchive: string;
  readonly authorityDeltaPaths: readonly string[];
  readonly canonicalOwnerFindingsSha256: string;
  readonly controlCommonDir: string;
  readonly controlRoot: string;
  readonly controlHeadSha: string;
  readonly currentPlanSha256: string;
  readonly currentTaskBlockHash: string;
  readonly currentTaskFileLocks: readonly string[];
  readonly evidence: string;
  readonly finalGate: TerminalContractReproofRecord;
  readonly hostTestMaxLoad1m: string;
  readonly inspectedRun: {
    readonly environment: TerminalContractReproofRecord;
    readonly inputs: TerminalContractReproofRecord;
    readonly runId: string;
    readonly status: string;
  };
  readonly proof: TerminalContractReproofRecord;
  readonly record: TerminalContractReproofRecord;
  readonly requestPath: string;
  readonly routing: TerminalContractReproofRecord;
  readonly sourceCommits: readonly string[];
  readonly terminalStatus: string;
  readonly worktree: {
    readonly branch: string;
    readonly clean: boolean;
    readonly commonDir: string;
    readonly controlCheckout: boolean;
    readonly factoryRootContained: boolean;
    readonly headSha: string;
    readonly requestControlHeadIsAncestor: boolean;
    readonly registered: boolean;
    readonly sourceRangeIsValid: boolean;
    readonly workdir: string;
  };
}

export interface TerminalContractReproofResumePlan {
  readonly launchInputs: TerminalContractReproofLaunchInputs;
  readonly preparingRecord: TerminalContractReproofRecord;
  readonly priorRunId: string;
  readonly terminalStatus: string;
}

export interface TerminalContractReproofLaunchInputs {
  readonly authority_repair_archive: string;
  readonly base_sha: string;
  readonly control_common_dir: string;
  readonly control_head_sha: string;
  readonly control_root: string;
  readonly current_plan_sha256: string;
  readonly evidence_dir: string;
  readonly host_test_max_load_1m: string;
  readonly reproof_request: string;
  readonly resume_branch: string;
  readonly resume_commits: string;
  readonly resume_expected_commit: string;
  readonly resume_mode: "preserved-worktree";
  readonly resume_proof_head: string;
  readonly resume_source_head: string;
  readonly resume_task_base: string;
  readonly start_sha: string;
  readonly task_id: string;
  readonly workdir: string;
}

export const buildTerminalContractReproofResume = (
  input: TerminalContractReproofResumeInput,
): TerminalContractReproofResumePlan => {
  const taskId = string(input.record.taskId, "terminal owner task ID");
  const runId = string(input.record.runId, `${taskId}: terminal owner run ID`);
  const branch = string(
    input.record.branch,
    `${taskId}: terminal owner branch`,
  );
  const workdir = string(
    input.record.workdir,
    `${taskId}: terminal owner worktree`,
  );
  const requestSha256 = sha(
    input.record.requestSha256,
    64,
    `${taskId}: terminal owner request hash`,
  );
  const ownerFindingsSha256 = sha(
    input.record.ownerFindingsSha256,
    64,
    `${taskId}: terminal owner findings hash`,
  );
  const canonicalOwnerFindingsSha256 = sha(
    input.canonicalOwnerFindingsSha256,
    64,
    `${taskId}: canonical owner findings hash`,
  );
  if (canonicalOwnerFindingsSha256 !== ownerFindingsSha256)
    throw new Error(`${taskId}: admitted owner findings drift`);
  const sourceHeadSha = sha(
    input.record.sourceHeadSha,
    40,
    `${taskId}: terminal owner source HEAD`,
  );
  const taskBaseSha = sha(
    input.record.taskBaseSha,
    40,
    `${taskId}: terminal owner task base`,
  );
  const controlHeadSha = sha(
    input.controlHeadSha,
    40,
    `${taskId}: current control HEAD`,
  );
  const currentPlanSha256 = sha(
    input.currentPlanSha256,
    64,
    `${taskId}: current plan hash`,
  );
  const currentTaskBlockHash = sha(
    input.currentTaskBlockHash,
    64,
    `${taskId}: current task hash`,
  );
  const fileLocks = new Set(input.currentTaskFileLocks);
  const controlOnly = (path: string): boolean =>
    path === ".fabro/workflows/brain-build-task/workflow.fabro" ||
    path ===
      "docs/superpowers/execution/maestro-brain/parallelism-contract.json" ||
    path === "docs/superpowers/execution/maestro-brain/task-manifest.json" ||
    path.startsWith("docs/superpowers/plans/") ||
    path.startsWith("docs/superpowers/specs/") ||
    path.startsWith("tooling/brain-factory/src/") ||
    path.startsWith("tooling/brain-factory/test/");
  if (
    input.authorityDeltaPaths.some(
      (path) => !controlOnly(path) || fileLocks.has(path),
    )
  )
    throw new Error(`${taskId}: terminal reproof authority delta is unsafe`);

  if (
    input.record.mode !== "contract-reproof" ||
    input.record.status !== "launched" ||
    input.record.resumeStrategy !== "in-lane-cherry-pick"
  )
    throw new Error(`${taskId}: terminal owner mode is not resumable`);
  if (
    !terminalStatuses.has(input.terminalStatus) ||
    input.inspectedRun.status !== input.terminalStatus ||
    input.inspectedRun.runId !== runId
  )
    throw new Error(`${taskId}: terminal Fabro ownership is not exact`);

  const requestTaskId = string(
    input.admittedRequest.taskId,
    `${taskId}: request task ID`,
  );
  const requestControlHeadSha = sha(
    input.admittedRequest.controlHeadSha,
    40,
    `${taskId}: request control HEAD`,
  );
  const requestPlanSha256 = sha(
    input.admittedRequest.planSha256,
    64,
    `${taskId}: request plan hash`,
  );
  if (
    requestTaskId !== taskId ||
    input.admittedRequest.requestSha256 !== requestSha256 ||
    input.admittedRequest.taskBlockHash !== currentTaskBlockHash
  )
    throw new Error(`${taskId}: admitted request identity drift`);

  const runInputs = input.inspectedRun.inputs;
  const compiledValue = (key: string, environmentKey: string): unknown =>
    Object.hasOwn(runInputs, key)
      ? runInputs[key]
      : input.inspectedRun.environment[environmentKey];
  if (
    compiledValue(
      "authority_repair_archive",
      "BRAIN_AUTHORITY_REPAIR_ARCHIVE",
    ) !== input.authorityRepairArchive ||
    runInputs.base_sha !== requestControlHeadSha ||
    runInputs.control_common_dir !== input.controlCommonDir ||
    runInputs.control_root !== input.controlRoot ||
    runInputs.evidence_dir !== input.evidence ||
    compiledValue("host_test_max_load_1m", "BRAIN_HOST_TEST_MAX_LOAD_1M") !==
      input.hostTestMaxLoad1m ||
    runInputs.reproof_request !== input.requestPath ||
    runInputs.resume_branch !== branch ||
    runInputs.resume_commits !== input.sourceCommits.join(",") ||
    runInputs.resume_expected_commit !== "none" ||
    runInputs.resume_mode !== "conflict-aware" ||
    runInputs.resume_proof_head !== "none" ||
    runInputs.resume_source_head !== sourceHeadSha ||
    runInputs.resume_task_base !== taskBaseSha ||
    runInputs.task_id !== taskId ||
    runInputs.start_sha !== requestControlHeadSha ||
    runInputs.workdir !== workdir
  )
    throw new Error(`${taskId}: compiled request launch identity drift`);

  const routingOwners = record(
    input.routing.owners,
    `${taskId}: owner routing entries`,
  );
  const routed = record(routingOwners[taskId], `${taskId}: routed owner`);
  if (
    input.routing.schemaVersion !== "maestro-brain-owner-rework-routing/v1" ||
    input.routing.status !== "complete" ||
    input.routing.findingSha256 !== canonicalOwnerFindingsSha256 ||
    !/^[0-9a-f]{64}$/.test(String(input.routing.resultSha256 ?? "")) ||
    !/^[0-9a-f]{64}$/.test(String(input.routing.selectionFileSha256 ?? "")) ||
    !/^[0-9a-f]{64}$/.test(
      String(input.routing.selectionPayloadSha256 ?? ""),
    ) ||
    routed.runId !== runId ||
    routed.status !== "launched" ||
    routed.requestSha256 !== requestSha256 ||
    routed.findingsSha256 !== ownerFindingsSha256
  )
    throw new Error(`${taskId}: owner routing receipt drift`);

  const candidateHeadSha = sha(
    input.worktree.headSha,
    40,
    `${taskId}: candidate HEAD`,
  );
  if (
    !input.worktree.clean ||
    input.worktree.controlCheckout ||
    !input.worktree.factoryRootContained ||
    !input.worktree.requestControlHeadIsAncestor ||
    !input.worktree.sourceRangeIsValid ||
    !input.worktree.registered ||
    input.worktree.branch !== branch ||
    input.worktree.workdir !== workdir ||
    input.worktree.commonDir !== input.controlCommonDir
  )
    throw new Error(`${taskId}: preserved worktree identity drift`);

  if (
    input.proof.taskId !== taskId ||
    input.proof.baseSha !== requestControlHeadSha ||
    input.proof.headSha !== candidateHeadSha ||
    input.proof.reviewHeadSha !== candidateHeadSha ||
    !new Set(["pending", "rework"]).has(String(input.proof.reviewVerdict)) ||
    input.proof.planSha256 !== requestPlanSha256 ||
    input.proof.taskBlockHash !== currentTaskBlockHash ||
    input.finalGate.taskId !== taskId ||
    input.finalGate.headSha !== candidateHeadSha ||
    input.finalGate.currentHeadSha !== candidateHeadSha ||
    input.finalGate.stage !== "pre-review" ||
    input.finalGate.status !== "passed" ||
    input.finalGate.planSha256 !== requestPlanSha256 ||
    input.finalGate.taskBlockHash !== currentTaskBlockHash
  )
    throw new Error(`${taskId}: preserved proof or gate identity drift`);

  if (
    input.sourceCommits.length === 0 ||
    input.sourceCommits.some((commit) => !/^[0-9a-f]{40}$/.test(commit))
  )
    throw new Error(`${taskId}: preserved source commits are invalid`);

  const launchInputs = {
    authority_repair_archive: input.authorityRepairArchive,
    base_sha: requestControlHeadSha,
    control_common_dir: input.controlCommonDir,
    control_head_sha: controlHeadSha,
    control_root: input.controlRoot,
    current_plan_sha256: currentPlanSha256,
    evidence_dir: input.evidence,
    host_test_max_load_1m: input.hostTestMaxLoad1m,
    reproof_request: input.requestPath,
    resume_branch: branch,
    resume_commits: input.sourceCommits.join(","),
    resume_expected_commit: "none",
    resume_mode: "preserved-worktree",
    resume_proof_head: candidateHeadSha,
    resume_source_head: sourceHeadSha,
    resume_task_base: taskBaseSha,
    start_sha: candidateHeadSha,
    task_id: taskId,
    workdir,
  } as const;
  return {
    launchInputs,
    preparingRecord: {
      branch,
      controlHeadSha,
      mode: "contract-reproof",
      ownerFindingsSha256,
      planSha256: currentPlanSha256,
      requestPath: input.requestPath,
      requestSha256,
      resumeStrategy: "in-lane-cherry-pick",
      sourceHeadSha,
      status: "preparing",
      taskBaseSha,
      taskBlockHash: currentTaskBlockHash,
      taskId,
      workdir,
    },
    priorRunId: runId,
    terminalStatus: input.terminalStatus,
  };
};

export const runTerminalContractReproofResume = (input: {
  readonly discoverOrCreate: () => string;
  readonly promote: (runId: string) => void;
  readonly recordCreated: (runId: string) => void;
  readonly start: (runId: string) => void;
}): string => {
  const runId = input.discoverOrCreate();
  if (!runId) throw new Error("terminal contract-reproof returned no run ID");
  input.recordCreated(runId);
  input.start(runId);
  input.promote(runId);
  return runId;
};
