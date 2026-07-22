import { existsSync } from "node:fs";

import {
  promoteTaskReservation,
  recordPreparingTaskLaunch,
} from "./dispatch-ownership.js";
import type { LaneGreenAuthorityReproofAdmission } from "./lane-green-authority-reproof.js";
import { inspectLaneGreenAuthorityReproofRun } from "./lane-green-authority-reproof-owner.js";
import { resolveLaneGreenAuthorityReproofReservation } from "./lane-green-authority-reproof-recovery.js";
import {
  buildLaneGreenAuthorityReproofLaunchSpec,
  type LaneGreenAuthorityReproofCoordinates,
} from "./lane-green-authority-reproof-spec.js";
import type { JsonRecord } from "./lane-green-authority-reproof-owner.js";
import { gitBranchExists, runRtk } from "./process.js";

export type LaneGreenAuthorityPreparingResolution =
  | {
      readonly kind: "continue";
      readonly reuseReservation: boolean;
      readonly reuseWorktree: boolean;
    }
  | { readonly kind: "recovered"; readonly runId: string };

export const resolveLaneGreenAuthorityPreparingOwner = (input: {
  readonly admission: LaneGreenAuthorityReproofAdmission;
  readonly auditPath: string;
  readonly controlCommonDir: string;
  readonly controlHeadSha: string;
  readonly coordinates: LaneGreenAuthorityReproofCoordinates;
  readonly evidence: string;
  readonly now: string;
  readonly planSha256: string;
  readonly preparingOwner?: JsonRecord;
  readonly recordPath: string;
  readonly root: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
}): LaneGreenAuthorityPreparingResolution => {
  if (input.preparingOwner === undefined) {
    return {
      kind: "continue",
      reuseReservation: false,
      reuseWorktree: false,
    };
  }
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
  const branchExists = gitBranchExists(input.coordinates.branch, input.root);
  const worktreeExists = existsSync(input.coordinates.workdir);
  if (
    !branchExists &&
    !worktreeExists &&
    input.preparingOwner.runId === undefined
  ) {
    const recovery = resolveLaneGreenAuthorityReproofReservation({
      candidates: [],
      expectedConfigInputs: reservationSpec.configInputs,
      expectedReservation: reservationSpec.preparingRecord,
      reservation: input.preparingOwner,
    });
    if (recovery.kind !== "retry-launch")
      throw new Error(`${input.taskId}: preparing reservation is ambiguous`);
    return {
      kind: "continue",
      reuseReservation: true,
      reuseWorktree: false,
    };
  }
  if (!branchExists || !worktreeExists)
    throw new Error(`${input.taskId}: preparing owner coordinates are missing`);
  if (
    input.preparingOwner.phase === "reserved" &&
    input.preparingOwner.runId === undefined
  ) {
    return {
      kind: "continue",
      reuseReservation: true,
      reuseWorktree: true,
    };
  }
  const startSha = runRtk(["git", "rev-parse", "HEAD"], {
    cwd: input.coordinates.workdir,
    quiet: true,
  });
  const spec = buildLaneGreenAuthorityReproofLaunchSpec({
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
  const priorRunId =
    typeof input.preparingOwner.runId === "string"
      ? input.preparingOwner.runId
      : undefined;
  let inspection: unknown;
  try {
    inspection = JSON.parse(
      runRtk(
        [
          "fabro",
          "inspect",
          priorRunId ?? "BrainBuildTask",
          "--json",
          "--quiet",
        ],
        { quiet: true },
      ),
    );
  } catch {
    throw new Error(
      `${input.taskId}: preparing reservation launch state is unknown`,
    );
  }
  const expectedPreparing = { ...spec.preparingRecord, phase: "creating" };
  const recovery = resolveLaneGreenAuthorityReproofReservation({
    candidates: [{ branch: input.coordinates.branch, inspection }],
    expectedConfigInputs: spec.configInputs,
    expectedReservation: expectedPreparing,
    reservation: priorRunId
      ? Object.fromEntries(
          Object.entries(input.preparingOwner).filter(
            ([key]) => key !== "runId",
          ),
        )
      : input.preparingOwner,
  });
  if (recovery.kind !== "recover-launched")
    throw new Error(`${input.taskId}: preparing launch was not proven absent`);
  if (!priorRunId) {
    recordPreparingTaskLaunch({
      auditPath: input.auditPath,
      expected: expectedPreparing,
      now: input.now,
      recordPath: input.recordPath,
      runId: recovery.runId,
      taskId: input.taskId,
    });
  }
  const status = inspectLaneGreenAuthorityReproofRun(recovery.runId);
  if (status === "created") {
    runRtk(["fabro", "start", recovery.runId, "--json", "--no-upgrade-check"], {
      quiet: true,
    });
  }
  promoteTaskReservation(input.recordPath, {
    ...expectedPreparing,
    phase: "launched",
    runId: recovery.runId,
    status: "launched",
  });
  return { kind: "recovered", runId: recovery.runId };
};
