import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  acquireDispatcherLock,
  promoteTaskReservation,
  recordPreparingTaskLaunch,
  reserveTaskPreparing,
} from "./dispatch-ownership.js";
import { buildManifest } from "./manifest.js";
import { loadPlanOnlyLaneAuthorityAdmission } from "./plan-only-lane-authority-admission.js";
import {
  planOnlyLaunchCoordinates,
  preparePlanOnlyCandidate,
} from "./plan-only-lane-authority-candidate.js";
import { createPlanOnlyFabroRun } from "./plan-only-lane-authority-fabro.js";
import {
  assertPlanOnlyAuthorityControllerStatus,
  buildPlanOnlyLaneAuthorityLaunchSpec,
  runPlanOnlyLaneAuthorityLaunch,
} from "./plan-only-lane-authority-launch.js";
import { runRtk } from "./process.js";

type JsonRecord = Record<string, unknown>;

interface LaunchInput {
  readonly evidence: string;
  readonly recordPath: string;
  readonly root: string;
  readonly state: string;
  readonly taskId: string;
}
type Manifest = ReturnType<typeof buildManifest>;
type ManifestTask = Manifest["tasks"][number];
type Admission = ReturnType<typeof loadPlanOnlyLaneAuthorityAdmission>;
type Coordinates = ReturnType<typeof planOnlyLaunchCoordinates>;

const executePlanOnlyLaunch = (input: {
  readonly admission: Admission;
  readonly auditPath: string;
  readonly controlHeadSha: string;
  readonly coordinates: Coordinates;
  readonly launch: LaunchInput;
  readonly manifest: Manifest;
  readonly now: string;
  readonly priorExists: boolean;
  readonly task: ManifestTask;
}): string => {
  let spec = buildPlanOnlyLaneAuthorityLaunchSpec({
    ...input.coordinates,
    candidateHeadSha: input.admission.sourceHeadSha,
    controlHeadSha: input.controlHeadSha,
    evidence: input.launch.evidence,
    planSha256: input.manifest.planSha256,
    sourceBaseSha: input.admission.sourceBaseSha,
    sourceCommits: input.admission.sourceCommits,
    sourceCommitPatchSha256s: input.admission.sourceCommitPatchSha256s,
    sourceHeadSha: input.admission.sourceHeadSha,
    sourceTreeSha: input.admission.sourceTreeSha,
    taskBlockHash: input.task.taskBlockHash,
    taskId: input.launch.taskId,
  });
  let env: NodeJS.ProcessEnv | undefined;
  const runId = runPlanOnlyLaneAuthorityLaunch({
    reserveOwner: () => {
      if (!input.priorExists)
        reserveTaskPreparing(input.launch.recordPath, spec.preparingRecord);
    },
    prepareExactCandidate: () => {
      const candidateHeadSha = preparePlanOnlyCandidate({
        ...input.coordinates,
        controlHeadSha: input.controlHeadSha,
        expectedPatchDigests: input.admission.sourceCommitPatchSha256s,
        root: input.launch.root,
        sourceCommits: input.admission.sourceCommits,
      });
      spec = buildPlanOnlyLaneAuthorityLaunchSpec({
        ...input.coordinates,
        candidateHeadSha,
        controlHeadSha: input.controlHeadSha,
        evidence: input.launch.evidence,
        planSha256: input.manifest.planSha256,
        sourceBaseSha: input.admission.sourceBaseSha,
        sourceCommits: input.admission.sourceCommits,
        sourceCommitPatchSha256s: input.admission.sourceCommitPatchSha256s,
        sourceHeadSha: input.admission.sourceHeadSha,
        sourceTreeSha: input.admission.sourceTreeSha,
        taskBlockHash: input.task.taskBlockHash,
        taskId: input.launch.taskId,
      });
      return candidateHeadSha;
    },
    createRun: (candidateHeadSha) => {
      const created = createPlanOnlyFabroRun({
        admission: input.admission,
        ...input.coordinates,
        candidateHeadSha,
        configInputs: spec.configInputs,
        controlHeadSha: input.controlHeadSha,
        evidence: input.launch.evidence,
        preparingRecord: spec.preparingRecord,
        recordPath: input.launch.recordPath,
        root: input.launch.root,
        state: input.launch.state,
        taskId: input.launch.taskId,
      });
      env = created.env;
      return created.runId;
    },
    recordRun: (runId) =>
      recordPreparingTaskLaunch({
        auditPath: input.auditPath,
        expected: { ...spec.preparingRecord, phase: "creating" },
        now: input.now,
        recordPath: input.launch.recordPath,
        runId,
        taskId: input.launch.taskId,
      }),
    startRun: (runId) => {
      if (!env) throw new Error("plan-only launch environment is missing");
      runRtk(["fabro", "start", runId, "--json", "--no-upgrade-check"], {
        env,
        quiet: true,
      });
    },
    promoteOwner: (runId) =>
      promoteTaskReservation(input.launch.recordPath, {
        ...spec.preparingRecord,
        phase: "launched",
        runId,
        status: "launched",
      }),
  });
  return runId;
};

export const launchPlanOnlyLaneAuthority = (input: {
  readonly evidence: string;
  readonly recordPath: string;
  readonly root: string;
  readonly state: string;
  readonly taskId: string;
}): void => {
  const manifest = buildManifest(input.root);
  const task = manifest.tasks.find(({ taskId }) => taskId === input.taskId);
  if (!task) throw new Error(`unknown task ${input.taskId}`);
  const controlHeadSha = runRtk(["git", "rev-parse", "HEAD"], {
    cwd: input.root,
    quiet: true,
  });
  assertPlanOnlyAuthorityControllerStatus(
    runRtk(["proxy", "git", "status", "--porcelain=v1"], {
      cwd: input.root,
      quiet: true,
    })
      .split("\n")
      .filter(Boolean),
  );
  const prior = existsSync(input.recordPath)
    ? (JSON.parse(readFileSync(input.recordPath, "utf8")) as JsonRecord)
    : undefined;
  if (
    prior &&
    (prior.mode !== "plan-only-lane-authority" ||
      prior.status !== "preparing" ||
      prior.taskId !== input.taskId)
  )
    throw new Error(`${input.taskId}: another owner already exists`);
  const admission = loadPlanOnlyLaneAuthorityAdmission({
    controlHeadSha,
    evidence: input.evidence,
    manifest,
    ownerDisposition: "absent",
    root: input.root,
    task,
  });
  const coordinates = planOnlyLaunchCoordinates({
    controlHeadSha,
    planSha256: manifest.planSha256,
    root: input.root,
    taskBlockHash: task.taskBlockHash,
    taskId: input.taskId,
  });
  if (
    prior &&
    (prior.branch !== coordinates.branch ||
      prior.workdir !== coordinates.workdir ||
      prior.planSha256 !== manifest.planSha256 ||
      prior.taskBlockHash !== task.taskBlockHash ||
      prior.taskBaseSha !== admission.sourceBaseSha ||
      prior.sourceHeadSha !== admission.sourceHeadSha ||
      prior.sourceTreeSha !== admission.sourceTreeSha ||
      JSON.stringify(prior.sourceCommits) !==
        JSON.stringify(admission.sourceCommits) ||
      JSON.stringify(prior.sourceCommitPatchSha256s) !==
        JSON.stringify(admission.sourceCommitPatchSha256s))
  )
    throw new Error(`${input.taskId}: preparing owner identity drifted`);
  const now = new Date().toISOString();
  const auditPath = resolve(input.state, "recovery-audit.jsonl");
  const release = acquireDispatcherLock({
    auditPath,
    lockPath: resolve(input.state, "dispatch.lock"),
    now,
    owner: {
      mode: "plan-only-lane-authority",
      pid: process.pid,
      startedAt: now,
      taskId: input.taskId,
    },
  });
  try {
    const runId = executePlanOnlyLaunch({
      admission,
      auditPath,
      controlHeadSha,
      coordinates,
      launch: input,
      manifest,
      now,
      priorExists: prior !== undefined,
      task,
    });
    console.log(`${input.taskId}: plan-only authority launched as ${runId}`);
  } finally {
    release();
  }
};
