import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { buildTaskLaunchEnv } from "./build-task-launch-env.js";
import { materializeBuildTaskRunConfig } from "./build-task-run-config.js";
import { admitContractReproof } from "./contract-reproof-admission.js";
import {
  canonicalContractReproofFinding,
  type ContractReproofFinding,
} from "./contract-reproof.js";
import {
  acquireDispatcherLock,
  promoteTaskReservation,
  replaceTerminalTaskRecord,
} from "./dispatch-ownership.js";
import { buildManifest } from "./manifest.js";
import type { IntegrationFinding } from "./integration-finding.js";
import { materializeLaneGreenAuthorityWorkflow } from "./lane-green-authority-workflow.js";
import { gitCommonDir, gitIsAncestor, runRtk } from "./process.js";
import { validateResumeSource } from "./resume-support.js";
import { planIntegrationOwnerReworkRoute } from "./route-integration-rework.js";
import { reconcileTerminalContractReproofCreating } from "./terminal-contract-reproof-recovery.js";
import {
  buildTerminalContractReproofResume,
  runTerminalContractReproofResume,
  type TerminalContractReproofRecord,
} from "./terminal-contract-reproof-resume.js";
import {
  containedTerminalReproofFile,
  observeTerminalReproofWorktree,
  readContainedTerminalReproofJson,
} from "./terminal-contract-reproof-safety.js";

const record = (
  value: unknown,
  label: string,
): TerminalContractReproofRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} is not an object`);
  return value as TerminalContractReproofRecord;
};

const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, candidate: unknown) =>
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
      ? Object.fromEntries(
          Object.entries(candidate as Record<string, unknown>).sort(
            ([a], [b]) => a.localeCompare(b),
          ),
        )
      : candidate,
  );

export const terminalContractReproofWorkflowName = (input: {
  readonly priorRunId: string;
  readonly proofHeadSha: string;
  readonly requestSha256: string;
  readonly taskId: string;
}): string => {
  const identity = createHash("sha256")
    .update(canonicalJson(input))
    .digest("hex")
    .slice(0, 12);
  return `BrainBuildTask${input.taskId.replaceAll("-", "")}Green${identity}`;
};

export const signedFindingsBindRoute = (
  signed: readonly unknown[],
  routed: readonly IntegrationFinding[],
  taskId: string,
): boolean => {
  if (signed.length !== routed.length) return false;
  return routed.every((finding) => {
    if (finding.ownerKind !== "task" || finding.taskId !== taskId) return false;
    const match = signed.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        (candidate as TerminalContractReproofRecord).id === finding.id,
    ) as Record<string, unknown> | undefined;
    if (!match) return false;
    try {
      const contractFinding = Object.fromEntries(
        Object.entries(finding).filter(([key]) => key !== "ownerKind"),
      ) as unknown as ContractReproofFinding;
      const admittedFinding = canonicalContractReproofFinding(
        match as unknown as ContractReproofFinding,
        taskId,
      );
      const routedFinding = canonicalContractReproofFinding(
        contractFinding,
        taskId,
      );
      const admittedContent = Object.fromEntries(
        Object.entries(admittedFinding).filter(
          ([key]) => key !== "priorEvidenceSha256",
        ),
      );
      const routedContent = Object.fromEntries(
        Object.entries(routedFinding).filter(
          ([key]) => key !== "priorEvidenceSha256",
        ),
      );
      // Routing binds selection/result provenance, while the signed reproof
      // request binds the later archived evidence packet. Both evidence lists
      // are canonical and hash-bound, but intentionally describe different sets.
      return canonicalJson(admittedContent) === canonicalJson(routedContent);
    } catch {
      return false;
    }
  });
};

const inspectRun = (
  runId: string,
): {
  readonly inputs: TerminalContractReproofRecord;
  readonly runId: string;
  readonly status: string;
} => {
  const parsed = JSON.parse(
    runRtk(["fabro", "inspect", runId, "--json", "--quiet"], { quiet: true }),
  ) as unknown;
  const item = record(
    Array.isArray(parsed) ? parsed[0] : parsed,
    `Fabro run ${runId}`,
  );
  const statusValue = item.status;
  const status =
    typeof statusValue === "string"
      ? statusValue
      : String(record(statusValue, `Fabro run ${runId} status`).kind ?? "");
  const runSpec = record(item.run_spec, `Fabro run ${runId} spec`);
  const settings = record(runSpec.settings, `Fabro run ${runId} settings`);
  const run = record(settings.run, `Fabro run ${runId} settings.run`);
  return {
    inputs: record(run.inputs, `Fabro run ${runId} inputs`),
    runId: String(item.run_id ?? ""),
    status,
  };
};

export const launchTerminalContractReproofResume = (input: {
  readonly evidence: string;
  readonly recordPath: string;
  readonly root: string;
  readonly state: string;
  readonly taskId: string;
}): void => {
  if (!existsSync(input.recordPath))
    throw new Error(
      `${input.taskId}: terminal contract-reproof requires an active owner`,
    );
  const now = new Date().toISOString();
  const auditPath = resolve(input.state, "recovery-audit.jsonl");
  const releaseLock = acquireDispatcherLock({
    auditPath,
    lockPath: resolve(input.state, "dispatch.lock"),
    now,
    owner: {
      controlRoot: input.root,
      mode: "terminal-contract-reproof",
      pid: process.pid,
      startedAt: now,
      taskId: input.taskId,
    },
  });
  process.once("exit", releaseLock);

  const recordContent = readFileSync(input.recordPath, "utf8");
  const owner = record(
    JSON.parse(recordContent) as unknown,
    `${input.taskId}: terminal owner`,
  );
  const controlCommonDir = realpathSync(gitCommonDir(input.root));
  if (owner.status === "preparing") {
    const expectedInputs = record(
      owner.expectedRunInputs,
      `${input.taskId}: creating run inputs`,
    );
    containedTerminalReproofFile(
      input.evidence,
      String(expectedInputs.reproof_request ?? ""),
      `${input.taskId}: creating reproof request`,
    );
    observeTerminalReproofWorktree({
      controlCommonDir,
      expectedBranch: String(expectedInputs.resume_branch ?? ""),
      expectedHead: String(expectedInputs.resume_proof_head ?? ""),
      root: input.root,
      runGit: (cwd, args) =>
        runRtk(["proxy", "git", ...args], { cwd, quiet: true }),
      workdir: String(expectedInputs.workdir ?? ""),
    });
    const recovered = reconcileTerminalContractReproofCreating({
      inspect: inspectRun,
      owner,
      promote: (newRunId) =>
        promoteTaskReservation(input.recordPath, {
          ...owner,
          phase: "launched",
          runId: newRunId,
          status: "launched",
        }),
      start: (newRunId) =>
        runRtk(["fabro", "start", newRunId, "--json", "--no-upgrade-check"], {
          quiet: true,
        }),
      taskId: input.taskId,
    });
    console.log(
      `${input.taskId}: terminal contract-reproof reconciled as ${recovered}`,
    );
    return;
  }
  const runId = String(owner.runId ?? "");
  const inspection = inspectRun(runId);
  const manifest = buildManifest(input.root);
  const task = manifest.tasks.find(
    (candidate) => candidate.taskId === input.taskId,
  );
  if (!task) throw new Error(`unknown task ${input.taskId}`);
  const controlHeadSha = runRtk(["git", "rev-parse", "HEAD"], { quiet: true });
  const requestPath = containedTerminalReproofFile(
    input.evidence,
    String(inspection.inputs.reproof_request ?? ""),
    `${input.taskId}: reproof request`,
  );
  const request = record(
    JSON.parse(readFileSync(requestPath, "utf8")) as unknown,
    `${input.taskId}: reproof request`,
  );
  const authorityDeltaPaths = runRtk(
    [
      "git",
      "diff",
      "--name-only",
      `${String(request.controlHeadSha ?? "")}..${controlHeadSha}`,
    ],
    { quiet: true },
  )
    .split("\n")
    .filter(Boolean);
  const admitted = admitContractReproof({
    allowAuthorityRefreshAdvance: true,
    changedFilesBetween: (ancestor, descendant) =>
      runRtk(["git", "diff", "--name-only", `${ancestor}..${descendant}`], {
        quiet: true,
      })
        .split("\n")
        .filter(Boolean),
    currentControlHead: controlHeadSha,
    evidenceDirectory: input.evidence,
    fileLocks: task.fileLocks,
    isAncestor: (ancestor, descendant) =>
      gitIsAncestor(ancestor, descendant, input.root),
    lanePriorIntegrationHeadSha: request.priorIntegrationHeadSha,
    lanePriorIntegrationId: request.priorIntegrationId,
    laneRequestSha256: owner.requestSha256,
    planSha256: String(request.planSha256 ?? ""),
    proofBaseSha: String(request.controlHeadSha ?? ""),
    requestPath,
    taskBlockHash: task.taskBlockHash,
    taskId: input.taskId,
  });
  const workdir = String(owner.workdir ?? "");
  const source = validateResumeSource({
    runGit: (args) => runRtk(args, { quiet: true }),
    sourceRef: String(owner.sourceHeadSha ?? ""),
    taskBase: String(owner.taskBaseSha ?? ""),
    taskId: input.taskId,
  });
  const observedWorktree = observeTerminalReproofWorktree({
    controlCommonDir,
    expectedBranch: String(owner.branch ?? ""),
    root: input.root,
    runGit: (cwd, args) =>
      runRtk(["proxy", "git", ...args], { cwd, quiet: true }),
    workdir,
  });
  const laneResultDirectory = resolve(
    input.evidence,
    "lane-results",
    input.taskId,
  );
  const proof = record(
    readContainedTerminalReproofJson(
      input.evidence,
      resolve(laneResultDirectory, "ci-proof-packet.json"),
      `${input.taskId}: proof`,
    ),
    `${input.taskId}: proof`,
  );
  const finalGate = record(
    readContainedTerminalReproofJson(
      input.evidence,
      resolve(laneResultDirectory, "lane-gate-report.json"),
      `${input.taskId}: gate`,
    ),
    `${input.taskId}: gate`,
  );
  const integrationId = String(admitted.request.priorIntegrationId);
  const integrationDirectory = resolve(
    input.evidence,
    "integration",
    integrationId,
  );
  const routing = record(
    readContainedTerminalReproofJson(
      input.evidence,
      resolve(integrationDirectory, "owner-rework-routing.json"),
      `${input.taskId}: owner routing`,
    ),
    `${input.taskId}: owner routing`,
  );
  const integrationResultContent = readFileSync(
    containedTerminalReproofFile(
      integrationDirectory,
      resolve(integrationDirectory, "integration-result.json"),
      `${input.taskId}: integration result`,
    ),
    "utf8",
  );
  const selectionContent = readFileSync(
    containedTerminalReproofFile(
      input.state,
      resolve(
        input.state,
        "runs",
        `integration-${integrationId}-selection.json`,
      ),
      `${input.taskId}: integration selection`,
    ),
    "utf8",
  );
  const adoptionPath = resolve(integrationDirectory, "finding-adoption.json");
  const adoptionContent = existsSync(adoptionPath)
    ? readFileSync(
        containedTerminalReproofFile(
          integrationDirectory,
          adoptionPath,
          `${input.taskId}: finding adoption`,
        ),
        "utf8",
      )
    : undefined;
  const adoption = adoptionContent
    ? record(
        JSON.parse(adoptionContent) as unknown,
        `${input.taskId}: adoption`,
      )
    : undefined;
  const route = planIntegrationOwnerReworkRoute({
    ...(adoptionContent ? { adoptionContent } : {}),
    ...(typeof adoption?.candidateHeadSha === "string"
      ? { expectedHeadSha: adoption.candidateHeadSha }
      : {}),
    expectedIntegrationId: integrationId,
    expectedResultSha256: String(routing.resultSha256 ?? ""),
    expectedSelectionFileSha256: String(routing.selectionFileSha256 ?? ""),
    expectedSelectionPayloadSha256: String(
      routing.selectionPayloadSha256 ?? "",
    ),
    integrationOwnedPaths: [],
    integrationResultContent,
    selectionContent,
    stateRoot: input.state,
  });
  const ownerRoute = route.ownerRoutes.find(
    (candidate) => candidate.taskId === input.taskId,
  );
  if (
    !ownerRoute ||
    !signedFindingsBindRoute(
      admitted.request.findings ?? [],
      ownerRoute.findings,
      input.taskId,
    )
  )
    throw new Error(`${input.taskId}: signed owner findings content drift`);
  const plan = buildTerminalContractReproofResume({
    admittedRequest:
      admitted.request as unknown as TerminalContractReproofRecord,
    authorityRepairArchive: "none",
    authorityDeltaPaths,
    canonicalOwnerFindingsSha256: ownerRoute.findingSha256,
    controlCommonDir,
    controlRoot: input.root,
    controlHeadSha,
    currentPlanSha256: manifest.planSha256,
    currentTaskBlockHash: task.taskBlockHash,
    currentTaskFileLocks: task.fileLocks,
    evidence: input.evidence,
    finalGate,
    hostTestMaxLoad1m: "20",
    inspectedRun: inspection,
    proof,
    record: owner,
    requestPath,
    routing,
    sourceCommits: source.taskCommits,
    terminalStatus: inspection.status,
    worktree: {
      ...observedWorktree,
      requestControlHeadIsAncestor: gitIsAncestor(
        admitted.request.controlHeadSha,
        "HEAD",
        workdir,
      ),
      sourceRangeIsValid:
        source.sourceHeadSha === owner.sourceHeadSha &&
        source.taskBaseSha === owner.taskBaseSha,
      workdir,
    },
  });
  const launchEnv = buildTaskLaunchEnv({
    authorityRepairArchive: plan.launchInputs.authority_repair_archive,
    baseSha: plan.launchInputs.base_sha,
    controlCommonDir: plan.launchInputs.control_common_dir,
    controlRoot: plan.launchInputs.control_root,
    evidence: plan.launchInputs.evidence_dir,
    hostTestMaxLoad1m: plan.launchInputs.host_test_max_load_1m,
    reproofRequest: plan.launchInputs.reproof_request,
    resumeBranch: plan.launchInputs.resume_branch,
    resumeCommits: plan.launchInputs.resume_commits,
    resumeExpectedCommit: plan.launchInputs.resume_expected_commit,
    resumeMode: plan.launchInputs.resume_mode,
    resumeProofHead: plan.launchInputs.resume_proof_head,
    resumeSourceHead: plan.launchInputs.resume_source_head,
    resumeTaskBase: plan.launchInputs.resume_task_base,
    startSha: plan.launchInputs.start_sha,
    taskId: plan.launchInputs.task_id,
    workdir: plan.launchInputs.workdir,
  });
  const workflowName = terminalContractReproofWorkflowName({
    priorRunId: plan.priorRunId,
    proofHeadSha: plan.launchInputs.resume_proof_head,
    requestSha256: String(plan.preparingRecord.requestSha256),
    taskId: input.taskId,
  });
  const expectedRunInputs = Object.fromEntries(
    Object.entries(plan.launchInputs).filter(
      ([key]) => !new Set(["control_head_sha", "current_plan_sha256"]).has(key),
    ),
  );
  const workflow = materializeLaneGreenAuthorityWorkflow({
    path: resolve(
      input.state,
      "launch-configs",
      `terminal-reproof-${input.taskId}.workflow.fabro`,
    ),
    sourcePath: resolve(
      input.root,
      ".fabro/workflows/brain-build-task/workflow.fabro",
    ),
    workflowName,
  });
  const config = materializeBuildTaskRunConfig({
    env: launchEnv,
    graph: workflow,
    path: resolve(
      input.state,
      "launch-configs",
      `terminal-reproof-${input.taskId}.toml`,
    ),
  });
  let createdStatus = "created";
  const nextRunId = runTerminalContractReproofResume({
    discoverOrCreate: () => {
      try {
        const discovered = inspectRun(workflowName);
        if (
          Object.entries(expectedRunInputs).some(
            ([key, value]) => discovered.inputs[key] !== value,
          )
        )
          throw new Error(`${input.taskId}: discovered run input drift`);
        createdStatus = discovered.status;
        return discovered.runId;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes(`No run found matching '${workflowName}'`)
        )
          throw error;
      }
      const output = JSON.parse(
        runRtk(
          [
            "fabro",
            "create",
            config,
            "--json",
            "--no-upgrade-check",
            "--environment",
            "local",
            "--label",
            `task=${input.taskId}`,
            "--label",
            "mode=terminal-contract-reproof",
            ...Object.entries(plan.launchInputs)
              .filter(
                ([key]) =>
                  !new Set(["control_head_sha", "current_plan_sha256"]).has(
                    key,
                  ),
              )
              .flatMap(([key, value]) => ["-I", `${key}=${value}`]),
          ],
          { env: launchEnv, quiet: true },
        ),
      ) as { run_id?: string; runId?: string };
      return output.run_id ?? output.runId ?? "";
    },
    recordCreated: (newRunId) =>
      replaceTerminalTaskRecord({
        auditPath,
        expectedContent: recordContent,
        now,
        recordPath: input.recordPath,
        replacement: {
          ...plan.preparingRecord,
          expectedRunInputs,
          phase: "creating",
          runId: newRunId,
          workflowName,
        },
        runId: plan.priorRunId,
        status: plan.terminalStatus,
        taskId: input.taskId,
      }),
    start: (newRunId) => {
      if (createdStatus === "created")
        runRtk(["fabro", "start", newRunId, "--json", "--no-upgrade-check"], {
          env: launchEnv,
          quiet: true,
        });
      else if (
        !new Set([
          "running",
          "succeeded",
          "failed",
          "canceled",
          "cancelled",
        ]).has(createdStatus)
      )
        throw new Error(`${input.taskId}: discovered run status is unsafe`);
    },
    promote: (newRunId) =>
      promoteTaskReservation(input.recordPath, {
        ...plan.preparingRecord,
        phase: "launched",
        runId: newRunId,
        status: "launched",
      }),
  });
  console.log(
    `${input.taskId}: terminal contract-reproof resumed as ${nextRunId}`,
  );
};
