import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildTaskLaunchEnv } from "./build-task-launch-env.js";
import { materializeBuildTaskRunConfig } from "./build-task-run-config.js";
import { admitContractReproof } from "./contract-reproof-admission.js";
import {
  acquireDispatcherLock,
  promoteTaskReservation,
  replaceTerminalTaskRecord,
} from "./dispatch-ownership.js";
import { buildManifest } from "./manifest.js";
import { gitCommonDir, gitIsAncestor, runRtk } from "./process.js";
import { validateResumeSource } from "./resume-support.js";
import {
  buildTerminalContractReproofResume,
  runTerminalContractReproofResume,
  type TerminalContractReproofRecord,
} from "./terminal-contract-reproof-resume.js";

const record = (
  value: unknown,
  label: string,
): TerminalContractReproofRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} is not an object`);
  return value as TerminalContractReproofRecord;
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
  const runId = String(owner.runId ?? "");
  const inspection = inspectRun(runId);
  const manifest = buildManifest(input.root);
  const task = manifest.tasks.find(
    (candidate) => candidate.taskId === input.taskId,
  );
  if (!task) throw new Error(`unknown task ${input.taskId}`);
  const controlHeadSha = runRtk(["git", "rev-parse", "HEAD"], { quiet: true });
  const controlCommonDir = gitCommonDir(input.root);
  const requestPath = String(inspection.inputs.reproof_request ?? "");
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
  const git = (args: readonly string[]): string =>
    runRtk(["proxy", "git", ...args], { cwd: workdir, quiet: true });
  const proof = record(
    JSON.parse(
      readFileSync(
        resolve(
          input.evidence,
          "lane-results",
          input.taskId,
          "ci-proof-packet.json",
        ),
        "utf8",
      ),
    ) as unknown,
    `${input.taskId}: proof`,
  );
  const finalGate = record(
    JSON.parse(
      readFileSync(
        resolve(
          input.evidence,
          "lane-results",
          input.taskId,
          "lane-gate-report.json",
        ),
        "utf8",
      ),
    ) as unknown,
    `${input.taskId}: gate`,
  );
  const routing = record(
    JSON.parse(
      readFileSync(
        resolve(
          input.evidence,
          "integration",
          String(admitted.request.priorIntegrationId),
          "owner-rework-routing.json",
        ),
        "utf8",
      ),
    ) as unknown,
    `${input.taskId}: owner routing`,
  );
  const plan = buildTerminalContractReproofResume({
    admittedRequest:
      admitted.request as unknown as TerminalContractReproofRecord,
    authorityDeltaPaths,
    controlCommonDir,
    controlHeadSha,
    currentPlanSha256: manifest.planSha256,
    currentTaskBlockHash: task.taskBlockHash,
    currentTaskFileLocks: task.fileLocks,
    finalGate,
    inspectedRun: inspection,
    proof,
    record: owner,
    requestPath,
    routing,
    sourceCommits: source.taskCommits,
    terminalStatus: inspection.status,
    worktree: {
      branch: git(["branch", "--show-current"]),
      clean: git(["status", "--porcelain=v1"]) === "",
      commonDir: git([
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]),
      headSha: git(["rev-parse", "HEAD"]),
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
    authorityRepairArchive: "none",
    baseSha: plan.launchInputs.base_sha,
    controlCommonDir,
    controlRoot: input.root,
    evidence: input.evidence,
    hostTestMaxLoad1m: "20",
    reproofRequest: requestPath,
    resumeBranch: plan.launchInputs.resume_branch,
    resumeCommits: plan.launchInputs.resume_commits,
    resumeExpectedCommit: "none",
    resumeMode: "preserved-worktree",
    resumeProofHead: plan.launchInputs.resume_proof_head,
    resumeSourceHead: plan.launchInputs.resume_source_head,
    resumeTaskBase: plan.launchInputs.resume_task_base,
    startSha: plan.launchInputs.start_sha,
    taskId: input.taskId,
    workdir,
  });
  const config = materializeBuildTaskRunConfig({
    env: launchEnv,
    graph: resolve(
      input.root,
      ".fabro/workflows/brain-build-task/workflow.fabro",
    ),
    path: resolve(
      input.state,
      "launch-configs",
      `terminal-reproof-${input.taskId}.toml`,
    ),
  });
  const nextRunId = runTerminalContractReproofResume({
    replaceTerminalOwner: () =>
      replaceTerminalTaskRecord({
        auditPath,
        expectedContent: recordContent,
        now,
        recordPath: input.recordPath,
        replacement: plan.preparingRecord,
        runId: plan.priorRunId,
        status: plan.terminalStatus,
        taskId: input.taskId,
      }),
    launch: () => {
      const output = JSON.parse(
        runRtk(
          [
            "fabro",
            "run",
            config,
            "--detach",
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
    promote: (newRunId) =>
      promoteTaskReservation(input.recordPath, {
        ...plan.preparingRecord,
        runId: newRunId,
        status: "launched",
      }),
  });
  console.log(
    `${input.taskId}: terminal contract-reproof resumed as ${nextRunId}`,
  );
};
