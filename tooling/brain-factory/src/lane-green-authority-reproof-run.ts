import { resolve } from "node:path";

import { buildTaskLaunchEnv } from "./build-task-launch-env.js";
import { materializeBuildTaskRunConfig } from "./build-task-run-config.js";
import {
  promoteTaskReservation,
  recordPreparingTaskLaunch,
  replaceTerminalTaskRecord,
  reserveTaskPreparing,
} from "./dispatch-ownership.js";
import { prepareExactLaneGreenAuthorityCandidate } from "./lane-green-authority-reproof-candidate.js";
import type { LaneGreenAuthorityReproofAdmission } from "./lane-green-authority-reproof.js";
import {
  buildLaneGreenAuthorityReproofLaunchSpec,
  type LaneGreenAuthorityReproofCoordinates,
} from "./lane-green-authority-reproof-spec.js";
import { runRtk } from "./process.js";

export const runLaneGreenAuthorityReproofLaunch = (input: {
  readonly createCurrentWorktree: () => void;
  readonly launchNormalBuildTask: () => string;
  readonly promoteOwner: (runId: string) => void;
  readonly recordOwner: (runId: string) => void;
  readonly replayExactCommits: () => void;
  readonly reserveOwner: () => void;
}): string => {
  input.reserveOwner();
  input.createCurrentWorktree();
  input.replayExactCommits();
  const runId = input.launchNormalBuildTask();
  if (!runId)
    throw new Error("lane-green authority reproof returned no run ID");
  input.recordOwner(runId);
  input.promoteOwner(runId);
  return runId;
};

export const executeNewLaneGreenAuthorityReproof = (input: {
  readonly admission: LaneGreenAuthorityReproofAdmission;
  readonly auditPath: string;
  readonly controlCommonDir: string;
  readonly controlHeadSha: string;
  readonly coordinates: LaneGreenAuthorityReproofCoordinates;
  readonly evidence: string;
  readonly now: string;
  readonly planSha256: string;
  readonly recordContent?: string;
  readonly recordPath: string;
  readonly reuseReservation: boolean;
  readonly reuseWorktree: boolean;
  readonly root: string;
  readonly state: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
  readonly terminalOwner?: {
    readonly runId: string;
    readonly status: string;
  };
}): string => {
  const reservationSpec = buildLaneGreenAuthorityReproofLaunchSpec({
    controlCommonDir: input.controlCommonDir,
    controlHeadSha: input.controlHeadSha,
    controlRoot: input.root,
    coordinates: input.coordinates,
    evidence: input.evidence,
    planSha256: input.planSha256,
    proofBaseSha: input.admission.proofBaseSha,
    proofFindingIds: input.admission.proofFindingIds,
    proofGateStage: input.admission.proofGateStage,
    proofHeadSha: input.admission.proofHeadSha,
    proofPlanSha256: input.admission.oldPlanSha256,
    proofTaskBlockHash: input.admission.oldTaskBlockHash,
    sourceBaseSha: input.admission.sourceBaseSha,
    sourceCommits: input.admission.sourceCommits,
    sourceHeadSha: input.admission.sourceHeadSha,
    sourceTreeSha: input.admission.sourceTreeSha,
    startSha: input.controlHeadSha,
    taskBlockHash: input.taskBlockHash,
    taskId: input.taskId,
  });
  let launchSpec = reservationSpec;
  let launchEnv: NodeJS.ProcessEnv | undefined;
  return runLaneGreenAuthorityReproofLaunch({
    reserveOwner: () => {
      if (input.reuseReservation) return;
      if (input.terminalOwner && input.recordContent !== undefined) {
        replaceTerminalTaskRecord({
          auditPath: input.auditPath,
          expectedContent: input.recordContent,
          now: input.now,
          recordPath: input.recordPath,
          replacement: reservationSpec.preparingRecord,
          runId: input.terminalOwner.runId,
          status: input.terminalOwner.status,
          taskId: input.taskId,
        });
      } else {
        reserveTaskPreparing(input.recordPath, reservationSpec.preparingRecord);
      }
    },
    createCurrentWorktree: () => undefined,
    replayExactCommits: () => {
      const startSha = prepareExactLaneGreenAuthorityCandidate({
        admission: input.admission,
        controlCommonDir: input.controlCommonDir,
        controlHeadSha: input.controlHeadSha,
        coordinates: input.coordinates,
        reuseWorktree: input.reuseWorktree,
        root: input.root,
        taskId: input.taskId,
      });
      launchSpec = buildLaneGreenAuthorityReproofLaunchSpec({
        controlCommonDir: input.controlCommonDir,
        controlHeadSha: input.controlHeadSha,
        controlRoot: input.root,
        coordinates: input.coordinates,
        evidence: input.evidence,
        planSha256: input.planSha256,
        proofBaseSha: input.admission.proofBaseSha,
        proofFindingIds: input.admission.proofFindingIds,
        proofGateStage: input.admission.proofGateStage,
        proofHeadSha: input.admission.proofHeadSha,
        proofPlanSha256: input.admission.oldPlanSha256,
        proofTaskBlockHash: input.admission.oldTaskBlockHash,
        sourceBaseSha: input.admission.sourceBaseSha,
        sourceCommits: input.admission.sourceCommits,
        sourceHeadSha: input.admission.sourceHeadSha,
        sourceTreeSha: input.admission.sourceTreeSha,
        startSha,
        taskBlockHash: input.taskBlockHash,
        taskId: input.taskId,
      });
    },
    launchNormalBuildTask: () => {
      const startSha = String(launchSpec.configInputs.start_sha);
      launchEnv = buildTaskLaunchEnv({
        authorityRepairArchive: "none",
        baseSha: input.controlHeadSha,
        controlCommonDir: input.controlCommonDir,
        controlRoot: input.root,
        evidence: input.evidence,
        hostTestMaxLoad1m: "20",
        reproofRequest: "none",
        resumeBranch: input.coordinates.branch,
        resumeCommits: input.admission.sourceCommits.join(","),
        resumeExpectedCommit: "none",
        resumeMode: "none",
        resumeProofHead: input.admission.sourceHeadSha,
        resumeSourceHead: input.admission.sourceHeadSha,
        resumeTaskBase: input.admission.sourceBaseSha,
        startSha,
        taskId: input.taskId,
        workdir: input.coordinates.workdir,
      });
      const config = materializeBuildTaskRunConfig({
        env: launchEnv,
        graph: resolve(".fabro/workflows/brain-build-task/workflow.fabro"),
        path: resolve(
          input.state,
          "launch-configs",
          `lane-green-${input.taskId}-${input.coordinates.authorityId}.toml`,
        ),
      });
      promoteTaskReservation(input.recordPath, {
        ...launchSpec.preparingRecord,
        phase: "creating",
      });
      const created = JSON.parse(
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
            "mode=lane-green-authority-reproof",
            ...Object.entries(launchSpec.configInputs).flatMap(
              ([key, value]) => ["-I", `${key}=${String(value)}`],
            ),
          ],
          { env: launchEnv, quiet: true },
        ),
      ) as { run_id?: string; runId?: string };
      return created.run_id ?? created.runId ?? "";
    },
    recordOwner: (runId) => {
      if (!launchEnv)
        throw new Error("authority reproof launch env is missing");
      recordPreparingTaskLaunch({
        auditPath: input.auditPath,
        expected: { ...launchSpec.preparingRecord, phase: "creating" },
        now: input.now,
        recordPath: input.recordPath,
        runId,
        taskId: input.taskId,
      });
      runRtk(["fabro", "start", runId, "--json", "--no-upgrade-check"], {
        env: launchEnv,
        quiet: true,
      });
    },
    promoteOwner: (runId) =>
      promoteTaskReservation(input.recordPath, {
        ...launchSpec.preparingRecord,
        phase: "launched",
        runId,
        status: "launched",
      }),
  });
};
