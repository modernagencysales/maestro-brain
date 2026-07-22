import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { acquireDispatcherLock } from "./dispatch-ownership.js";
import { loadLaneGreenAuthorityReproofAdmission } from "./lane-green-authority-reproof-admission.js";
import {
  inspectLaneGreenAuthorityReproofRun,
  laneGreenAuthorityLines as lines,
  laneGreenAuthorityRecord as record,
  laneGreenAuthorityReproofRunIsTerminal,
  type JsonRecord,
} from "./lane-green-authority-reproof-owner.js";
import { executeNewLaneGreenAuthorityReproof } from "./lane-green-authority-reproof-run.js";
import { resolveLaneGreenAuthorityPreparingOwner } from "./lane-green-authority-reproof-resume.js";
import type { LaneGreenAuthorityReproofCoordinates } from "./lane-green-authority-reproof-spec.js";
import { buildManifest } from "./manifest.js";
import { gitBranchExists, gitCommonDir, runRtk } from "./process.js";

export const laneGreenAuthorityReproofCoordinates = (input: {
  readonly controlHeadSha: string;
  readonly planSha256: string;
  readonly root: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
}): LaneGreenAuthorityReproofCoordinates => {
  for (const [label, value, length] of [
    ["control HEAD", input.controlHeadSha, 40],
    ["plan SHA", input.planSha256, 64],
    ["task hash", input.taskBlockHash, 64],
  ] as const) {
    if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value))
      throw new Error(`lane-green authority reproof ${label} is invalid`);
  }
  const authorityId = createHash("sha256")
    .update(
      `${input.controlHeadSha}:${input.planSha256}:${input.taskBlockHash}:lane-green-authority-reproof`,
    )
    .digest("hex")
    .slice(0, 12);
  const slug = input.taskId.toLowerCase();
  return {
    authorityId,
    branch: `fabro/reproof-${slug}-green-${authorityId}`,
    workdir: resolve(
      input.root,
      "..",
      ".maestro-brain-fabro-workdirs",
      `reproof-${slug}-green-${authorityId}`,
    ),
  };
};

export { resolveLaneGreenAuthorityReproofReservation } from "./lane-green-authority-reproof-recovery.js";
export { runLaneGreenAuthorityReproofLaunch } from "./lane-green-authority-reproof-run.js";
export { buildLaneGreenAuthorityReproofLaunchSpec } from "./lane-green-authority-reproof-spec.js";

export const launchLaneGreenAuthorityReproof = (input: {
  readonly evidence: string;
  readonly recordPath: string;
  readonly root: string;
  readonly state: string;
  readonly taskId: string;
}): void => {
  const manifest = buildManifest(input.root);
  const task = manifest.tasks.find(
    (candidate) => candidate.taskId === input.taskId,
  );
  if (!task) throw new Error(`unknown task ${input.taskId}`);
  const controlHeadSha = runRtk(["git", "rev-parse", "HEAD"], {
    cwd: input.root,
    quiet: true,
  });
  const controlStatus = lines(
    runRtk(["git", "status", "--porcelain=v1"], {
      cwd: input.root,
      quiet: true,
    }),
  );
  if (controlStatus.some((line) => line !== "?? .mcp.json"))
    throw new Error(`${input.taskId}: authority-reproof controller is dirty`);
  const coordinates = laneGreenAuthorityReproofCoordinates({
    controlHeadSha,
    planSha256: manifest.planSha256,
    root: input.root,
    taskBlockHash: task.taskBlockHash,
    taskId: input.taskId,
  });
  const recordContent = existsSync(input.recordPath)
    ? readFileSync(input.recordPath, "utf8")
    : undefined;
  let terminalOwner:
    { readonly runId: string; readonly status: string } | undefined;
  let launchedOwner: JsonRecord | undefined;
  let preparingOwner: JsonRecord | undefined;
  if (recordContent !== undefined) {
    const prior = record(JSON.parse(recordContent), `${input.taskId}: owner`);
    if (prior.taskId !== input.taskId)
      throw new Error(`${input.taskId}: owner task identity mismatch`);
    if (
      prior.mode === "lane-green-authority-reproof" &&
      prior.status === "launched" &&
      typeof prior.runId === "string"
    ) {
      if (
        prior.planSha256 !== manifest.planSha256 ||
        prior.taskBlockHash !== task.taskBlockHash ||
        prior.branch !== coordinates.branch ||
        prior.workdir !== coordinates.workdir
      )
        throw new Error(`${input.taskId}: launched authority owner drifted`);
      const status = inspectLaneGreenAuthorityReproofRun(prior.runId);
      if (laneGreenAuthorityReproofRunIsTerminal(status)) {
        throw new Error(
          `${input.taskId}: terminal authority reproof ${prior.runId} (${status}) requires audited resume or recovery`,
        );
      }
      launchedOwner = prior;
    } else if (prior.status === "preparing") {
      if (prior.mode !== "lane-green-authority-reproof")
        throw new Error(`${input.taskId}: a different preparing owner exists`);
      preparingOwner = prior;
    } else {
      if (typeof prior.runId !== "string" || !prior.runId)
        throw new Error(`${input.taskId}: existing owner status is unknown`);
      const status = inspectLaneGreenAuthorityReproofRun(prior.runId);
      if (!laneGreenAuthorityReproofRunIsTerminal(status)) {
        throw new Error(
          `${input.taskId}: live Fabro run ${prior.runId} (${status}) owns this task`,
        );
      }
      terminalOwner = { runId: prior.runId, status };
    }
  }
  let admission = loadLaneGreenAuthorityReproofAdmission({
    controlHeadSha,
    evidence: input.evidence,
    root: input.root,
    task,
  });
  if (launchedOwner !== undefined) {
    if (
      launchedOwner.factoryBaseSha !== controlHeadSha ||
      launchedOwner.taskBaseSha !== admission.sourceBaseSha ||
      launchedOwner.proofBaseSha !== admission.proofBaseSha ||
      launchedOwner.proofHeadSha !== admission.proofHeadSha ||
      launchedOwner.proofPlanSha256 !== admission.oldPlanSha256 ||
      launchedOwner.proofTaskBlockHash !== admission.oldTaskBlockHash ||
      launchedOwner.proofGateStage !== admission.proofGateStage ||
      JSON.stringify(launchedOwner.proofFindingIds) !==
        JSON.stringify(admission.proofFindingIds) ||
      launchedOwner.sourceHeadSha !== admission.sourceHeadSha ||
      launchedOwner.sourceTreeSha !== admission.sourceTreeSha ||
      JSON.stringify(launchedOwner.sourceCommits) !==
        JSON.stringify(admission.sourceCommits)
    )
      throw new Error(`${input.taskId}: launched authority source drifted`);
    console.log(
      `${input.taskId}: authority reproof already owned by ${String(launchedOwner.runId)}`,
    );
    return;
  }
  if (
    preparingOwner === undefined &&
    (gitBranchExists(coordinates.branch, input.root) ||
      existsSync(coordinates.workdir))
  )
    throw new Error(
      `${input.taskId}: authority-reproof coordinates already exist`,
    );
  const now = new Date().toISOString();
  const auditPath = resolve(input.state, "recovery-audit.jsonl");
  const release = acquireDispatcherLock({
    auditPath,
    lockPath: resolve(input.state, "dispatch.lock"),
    now,
    owner: {
      mode: "lane-green-authority-reproof",
      pid: process.pid,
      startedAt: now,
      taskId: input.taskId,
    },
  });
  const releaseOnExit = (): void => release();
  process.once("exit", releaseOnExit);
  const releaseNow = (): void => {
    process.off("exit", releaseOnExit);
    release();
  };
  try {
    if (
      runRtk(["git", "rev-parse", "HEAD"], {
        cwd: input.root,
        quiet: true,
      }) !== controlHeadSha ||
      (recordContent === undefined && existsSync(input.recordPath)) ||
      (recordContent !== undefined &&
        readFileSync(input.recordPath, "utf8") !== recordContent)
    )
      throw new Error(`${input.taskId}: authority changed during admission`);
    if (
      preparingOwner === undefined &&
      (gitBranchExists(coordinates.branch, input.root) ||
        existsSync(coordinates.workdir))
    )
      throw new Error(
        `${input.taskId}: authority coordinates changed under lock`,
      );
    admission = loadLaneGreenAuthorityReproofAdmission({
      controlHeadSha,
      evidence: input.evidence,
      root: input.root,
      task,
    });
    const controlCommonDir = gitCommonDir(input.root);
    const preparing = resolveLaneGreenAuthorityPreparingOwner({
      admission,
      auditPath,
      controlCommonDir,
      controlHeadSha,
      coordinates,
      evidence: input.evidence,
      now,
      planSha256: manifest.planSha256,
      ...(preparingOwner === undefined ? {} : { preparingOwner }),
      recordPath: input.recordPath,
      root: input.root,
      taskBlockHash: task.taskBlockHash,
      taskId: input.taskId,
    });
    if (preparing.kind === "recovered") {
      console.log(
        `${input.taskId}: recovered lane-green authority reproof ${preparing.runId}`,
      );
      return;
    }
    const runId = executeNewLaneGreenAuthorityReproof({
      admission,
      auditPath,
      controlCommonDir,
      controlHeadSha,
      coordinates,
      evidence: input.evidence,
      now,
      planSha256: manifest.planSha256,
      ...(recordContent === undefined ? {} : { recordContent }),
      recordPath: input.recordPath,
      reuseReservation: preparing.reuseReservation,
      reuseWorktree: preparing.reuseWorktree,
      root: input.root,
      state: input.state,
      taskBlockHash: task.taskBlockHash,
      taskId: input.taskId,
      ...(terminalOwner === undefined ? {} : { terminalOwner }),
    });
    console.log(
      `${input.taskId}: lane-green authority reproof launched as ${runId}`,
    );
  } finally {
    releaseNow();
  }
};
