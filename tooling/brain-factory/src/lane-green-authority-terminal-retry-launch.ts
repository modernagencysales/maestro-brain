import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { acquireDispatcherLock } from "./dispatch-ownership.js";
import {
  inspectLaneGreenAuthorityReproofRun,
  laneGreenAuthorityLines as lines,
  laneGreenAuthorityRecord as record,
  laneGreenAuthorityReproofRunIsTerminal,
} from "./lane-green-authority-reproof-owner.js";
import { executeNewLaneGreenAuthorityReproof } from "./lane-green-authority-reproof-run.js";
import { resolveLaneGreenAuthorityPreparingOwner } from "./lane-green-authority-reproof-resume.js";
import { prepareArchivedLaneGreenAuthorityRetry } from "./lane-green-authority-terminal-retry-runtime.js";
import {
  authorizedTerminalLaneGreenCandidate,
  loadAuditedLaneGreenAuthorityArchive,
} from "./lane-green-authority-terminal-retry.js";
import { buildManifest } from "./manifest.js";
import { gitCommonDir, runRtk } from "./process.js";
import {
  laneGreenAuthorityReproofCoordinates,
  terminalLaneGreenRetryCoordinates,
} from "./lane-green-authority-reproof-coordinates.js";

export const launchTerminalLaneGreenAuthorityRetry = (input: {
  readonly actionId: string;
  readonly evidence: string;
  readonly recordPath: string;
  readonly root: string;
  readonly state: string;
  readonly taskId: string;
}): void => {
  const authorizedCandidate = authorizedTerminalLaneGreenCandidate({
    actionId: input.actionId,
    taskId: input.taskId,
  });
  const manifest = buildManifest(input.root);
  const task = manifest.tasks.find(
    (candidate) => candidate.taskId === input.taskId,
  );
  if (!task) throw new Error(`unknown task ${input.taskId}`);
  const transition = task.laneGreenAuthorityReproofTransition;
  if (!transition)
    throw new Error(`${input.taskId}: exact authority transition missing`);
  const controlHeadSha = runRtk(["git", "rev-parse", "HEAD"], {
    cwd: input.root,
    quiet: true,
  });
  const controlStatus = lines(
    runRtk(["proxy", "git", "status", "--porcelain=v1"], {
      cwd: input.root,
      quiet: true,
    }),
  );
  if (controlStatus.some((line) => line !== "?? .mcp.json"))
    throw new Error(`${input.taskId}: terminal-retry controller is dirty`);
  const archive = loadAuditedLaneGreenAuthorityArchive({
    actionId: input.actionId,
    auditPath: resolve(input.state, "recovery-audit.jsonl"),
    recordPath: input.recordPath,
    taskId: input.taskId,
  });
  const factoryBaseSha = String(archive.record.factoryBaseSha ?? "");
  const archivedCoordinates = laneGreenAuthorityReproofCoordinates({
    controlHeadSha: factoryBaseSha,
    planSha256: manifest.planSha256,
    root: input.root,
    taskBlockHash: task.taskBlockHash,
    taskId: input.taskId,
  });
  const recordContent = existsSync(input.recordPath)
    ? readFileSync(input.recordPath, "utf8")
    : undefined;
  const owner = recordContent
    ? record(JSON.parse(recordContent), `${input.taskId}: retry owner`)
    : undefined;
  if (
    owner !== undefined &&
    (owner.mode !== "lane-green-authority-reproof" ||
      owner.terminalArchiveActionId !== input.actionId)
  )
    throw new Error(`${input.taskId}: a different owner blocks terminal retry`);
  if (owner?.status === "launched" && typeof owner.runId === "string") {
    const status = inspectLaneGreenAuthorityReproofRun(owner.runId);
    if (!laneGreenAuthorityReproofRunIsTerminal(status)) {
      console.log(
        `${input.taskId}: terminal retry already owned by ${owner.runId}`,
      );
      return;
    }
    throw new Error(
      `${input.taskId}: retry run ${owner.runId} is terminal; archive it before another retry`,
    );
  }
  if (owner !== undefined && owner.status !== "preparing")
    throw new Error(`${input.taskId}: terminal retry owner status is unknown`);
  const archivedStatus = inspectLaneGreenAuthorityReproofRun(
    String(archive.record.runId),
  );
  if (archivedStatus !== archive.status)
    throw new Error(`${input.taskId}: archived Fabro status drift`);
  const auditPath = resolve(input.state, "recovery-audit.jsonl");
  const controlCommonDir = gitCommonDir(input.root);
  const prepare = () =>
    prepareArchivedLaneGreenAuthorityRetry({
      actionId: input.actionId,
      auditPath,
      controlCommonDir,
      controlHeadSha,
      coordinates: archivedCoordinates,
      currentPlanSha256: manifest.planSha256,
      currentTaskBlockHash: task.taskBlockHash,
      expectedArchiveSha256: authorizedCandidate.archiveSha256,
      expectedCandidateHeadSha: authorizedCandidate.headSha,
      expectedCandidateTreeSha: authorizedCandidate.treeSha,
      recordPath: input.recordPath,
      root: input.root,
      taskId: input.taskId,
      transition,
    });
  let retry = prepare();
  const now = new Date().toISOString();
  const release = acquireDispatcherLock({
    auditPath,
    lockPath: resolve(input.state, "dispatch.lock"),
    now,
    owner: {
      archiveActionId: input.actionId,
      mode: "lane-green-authority-terminal-retry",
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
      runRtk(["git", "rev-parse", "HEAD"], { cwd: input.root, quiet: true }) !==
        controlHeadSha ||
      (recordContent === undefined && existsSync(input.recordPath)) ||
      (recordContent !== undefined &&
        readFileSync(input.recordPath, "utf8") !== recordContent)
    )
      throw new Error(
        `${input.taskId}: authority changed during terminal admission`,
      );
    retry = prepare();
    const coordinates = terminalLaneGreenRetryCoordinates({
      archiveActionId: input.actionId,
      candidateHeadSha: retry.candidateHeadSha,
      coordinates: archivedCoordinates,
    });
    const terminalRetry = {
      archiveActionId: input.actionId,
      archiveSha256: retry.archive.sha256,
      candidateTreeSha: retry.candidateTreeSha,
      priorRunId: String(retry.archive.record.runId),
      terminalStatus: retry.archive.status,
    } as const;
    const preparing = resolveLaneGreenAuthorityPreparingOwner({
      admission: retry.admission,
      auditPath,
      controlCommonDir,
      controlHeadSha: retry.factoryBaseSha,
      coordinates,
      evidence: input.evidence,
      now,
      planSha256: manifest.planSha256,
      ...(owner === undefined ? {} : { preparingOwner: owner }),
      recordPath: input.recordPath,
      root: input.root,
      taskBlockHash: task.taskBlockHash,
      taskId: input.taskId,
      terminalRetry,
      terminalStartSha: retry.candidateHeadSha,
    });
    if (preparing.kind === "recovered") {
      console.log(
        `${input.taskId}: recovered terminal retry ${preparing.runId}`,
      );
      return;
    }
    const runId = executeNewLaneGreenAuthorityReproof({
      admission: retry.admission,
      auditPath,
      controlCommonDir,
      controlHeadSha: retry.factoryBaseSha,
      coordinates,
      evidence: input.evidence,
      now,
      planSha256: manifest.planSha256,
      recordPath: input.recordPath,
      reuseReservation: preparing.reuseReservation,
      reuseWorktree: true,
      root: input.root,
      state: input.state,
      taskBlockHash: task.taskBlockHash,
      taskId: input.taskId,
      terminalRetry,
      terminalStartSha: retry.candidateHeadSha,
    });
    console.log(
      `${input.taskId}: terminal lane-green retry launched as ${runId}`,
    );
  } finally {
    releaseNow();
  }
};
