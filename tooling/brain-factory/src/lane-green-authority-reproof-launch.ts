import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildTaskLaunchEnv } from "./build-task-launch-env.js";
import { materializeBuildTaskRunConfig } from "./build-task-run-config.js";
import { hydrateWorktreeDependencies } from "./dependencies.js";
import {
  acquireDispatcherLock,
  promoteTaskReservation,
  recordPreparingTaskLaunch,
  replaceTerminalTaskRecord,
  reserveTaskPreparing,
} from "./dispatch-ownership.js";
import { loadLaneGreenAuthorityReproofAdmission } from "./lane-green-authority-reproof-admission.js";
import {
  inspectLaneGreenAuthorityReproofRun,
  laneGreenAuthorityLines as lines,
  laneGreenAuthorityRecord as record,
  laneGreenAuthorityReproofRunIsTerminal,
  type JsonRecord,
} from "./lane-green-authority-reproof-owner.js";
import { resolveLaneGreenAuthorityReproofReservation } from "./lane-green-authority-reproof-recovery.js";
import {
  buildLaneGreenAuthorityReproofLaunchSpec,
  type LaneGreenAuthorityReproofCoordinates,
} from "./lane-green-authority-reproof-spec.js";
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
    if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
      throw new Error(`lane-green authority reproof ${label} is invalid`);
    }
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
  if (!runId) {
    throw new Error("lane-green authority reproof returned no run ID");
  }
  input.recordOwner(runId);
  input.promoteOwner(runId);
  return runId;
};

export { resolveLaneGreenAuthorityReproofReservation } from "./lane-green-authority-reproof-recovery.js";
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
  if (controlStatus.some((line) => line !== "?? .mcp.json")) {
    throw new Error(`${input.taskId}: authority-reproof controller is dirty`);
  }
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
  let preparingOwner: JsonRecord | undefined;
  if (recordContent !== undefined) {
    const prior = record(JSON.parse(recordContent), `${input.taskId}: owner`);
    if (prior.taskId !== input.taskId) {
      throw new Error(`${input.taskId}: owner task identity mismatch`);
    }
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
      ) {
        throw new Error(`${input.taskId}: launched authority owner drifted`);
      }
      const status = inspectLaneGreenAuthorityReproofRun(prior.runId);
      if (laneGreenAuthorityReproofRunIsTerminal(status)) {
        throw new Error(
          `${input.taskId}: terminal authority reproof ${prior.runId} (${status}) requires audited resume or recovery`,
        );
      }
      console.log(
        `${input.taskId}: authority reproof already owned by ${prior.runId} (${status})`,
      );
      return;
    }
    if (prior.status === "preparing") {
      if (prior.mode !== "lane-green-authority-reproof") {
        throw new Error(`${input.taskId}: a different preparing owner exists`);
      }
      preparingOwner = prior;
    } else {
      if (typeof prior.runId !== "string" || !prior.runId) {
        throw new Error(`${input.taskId}: existing owner status is unknown`);
      }
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
  if (
    preparingOwner === undefined &&
    (gitBranchExists(coordinates.branch, input.root) ||
      existsSync(coordinates.workdir))
  ) {
    throw new Error(
      `${input.taskId}: authority-reproof coordinates already exist`,
    );
  }
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
  if (
    runRtk(["git", "rev-parse", "HEAD"], {
      cwd: input.root,
      quiet: true,
    }) !== controlHeadSha ||
    (recordContent === undefined && existsSync(input.recordPath)) ||
    (recordContent !== undefined &&
      readFileSync(input.recordPath, "utf8") !== recordContent)
  ) {
    throw new Error(`${input.taskId}: authority changed during admission`);
  }
  if (
    preparingOwner === undefined &&
    (gitBranchExists(coordinates.branch, input.root) ||
      existsSync(coordinates.workdir))
  ) {
    throw new Error(
      `${input.taskId}: authority coordinates changed under lock`,
    );
  }
  admission = loadLaneGreenAuthorityReproofAdmission({
    controlHeadSha,
    evidence: input.evidence,
    root: input.root,
    task,
  });
  const controlCommonDir = gitCommonDir(input.root);
  const reservationSpec = buildLaneGreenAuthorityReproofLaunchSpec({
    controlCommonDir,
    controlHeadSha,
    controlRoot: input.root,
    coordinates,
    evidence: input.evidence,
    planSha256: manifest.planSha256,
    sourceBaseSha: admission.sourceBaseSha,
    sourceCommits: admission.sourceCommits,
    sourceHeadSha: admission.sourceHeadSha,
    sourceTreeSha: admission.sourceTreeSha,
    startSha: controlHeadSha,
    taskBlockHash: task.taskBlockHash,
    taskId: input.taskId,
  });
  let reuseReservation = false;
  if (preparingOwner !== undefined) {
    const branchExists = gitBranchExists(coordinates.branch, input.root);
    const worktreeExists = existsSync(coordinates.workdir);
    if (
      !branchExists &&
      !worktreeExists &&
      preparingOwner.runId === undefined
    ) {
      const recovery = resolveLaneGreenAuthorityReproofReservation({
        candidates: [],
        expectedConfigInputs: reservationSpec.configInputs,
        expectedReservation: reservationSpec.preparingRecord,
        reservation: preparingOwner,
      });
      if (recovery.kind !== "retry-launch") {
        throw new Error(`${input.taskId}: preparing reservation is ambiguous`);
      }
      reuseReservation = true;
    } else if (!branchExists || !worktreeExists) {
      throw new Error(
        `${input.taskId}: preparing owner coordinates are missing`,
      );
    } else {
      const startSha = runRtk(["git", "rev-parse", "HEAD"], {
        cwd: coordinates.workdir,
        quiet: true,
      });
      const spec = buildLaneGreenAuthorityReproofLaunchSpec({
        controlCommonDir,
        controlHeadSha,
        controlRoot: input.root,
        coordinates,
        evidence: input.evidence,
        planSha256: manifest.planSha256,
        sourceBaseSha: admission.sourceBaseSha,
        sourceCommits: admission.sourceCommits,
        sourceHeadSha: admission.sourceHeadSha,
        sourceTreeSha: admission.sourceTreeSha,
        startSha,
        taskBlockHash: task.taskBlockHash,
        taskId: input.taskId,
      });
      const priorRunId =
        typeof preparingOwner.runId === "string"
          ? preparingOwner.runId
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
      const recovery = resolveLaneGreenAuthorityReproofReservation({
        candidates: [{ branch: coordinates.branch, inspection }],
        expectedConfigInputs: spec.configInputs,
        expectedReservation: spec.preparingRecord,
        reservation: priorRunId
          ? Object.fromEntries(
              Object.entries(preparingOwner).filter(([key]) => key !== "runId"),
            )
          : preparingOwner,
      });
      if (recovery.kind !== "recover-launched") {
        throw new Error(
          `${input.taskId}: preparing launch was not proven absent`,
        );
      }
      if (!priorRunId) {
        recordPreparingTaskLaunch({
          auditPath,
          expected: spec.preparingRecord,
          now,
          recordPath: input.recordPath,
          runId: recovery.runId,
          taskId: input.taskId,
        });
      }
      const status = inspectLaneGreenAuthorityReproofRun(recovery.runId);
      if (status === "created") {
        runRtk(
          ["fabro", "start", recovery.runId, "--json", "--no-upgrade-check"],
          { quiet: true },
        );
      }
      promoteTaskReservation(input.recordPath, {
        ...spec.preparingRecord,
        runId: recovery.runId,
        status: "launched",
      });
      releaseNow();
      console.log(
        `${input.taskId}: recovered lane-green authority reproof ${recovery.runId}`,
      );
      return;
    }
  }
  let launchSpec = reservationSpec;
  let launchEnv: NodeJS.ProcessEnv | undefined;
  const runId = runLaneGreenAuthorityReproofLaunch({
    reserveOwner: () => {
      if (reuseReservation) return;
      if (terminalOwner && recordContent !== undefined) {
        replaceTerminalTaskRecord({
          auditPath,
          expectedContent: recordContent,
          now,
          recordPath: input.recordPath,
          replacement: reservationSpec.preparingRecord,
          runId: terminalOwner.runId,
          status: terminalOwner.status,
          taskId: input.taskId,
        });
      } else {
        reserveTaskPreparing(input.recordPath, reservationSpec.preparingRecord);
      }
    },
    createCurrentWorktree: () => {
      runRtk(
        [
          "git",
          "worktree",
          "add",
          "-b",
          coordinates.branch,
          coordinates.workdir,
          controlHeadSha,
        ],
        { cwd: input.root },
      );
      hydrateWorktreeDependencies(input.root, coordinates.workdir);
    },
    replayExactCommits: () =>
      runRtk(["proxy", "git", "cherry-pick", ...admission.sourceCommits], {
        cwd: coordinates.workdir,
      }),
    launchNormalBuildTask: () => {
      const startSha = runRtk(["git", "rev-parse", "HEAD"], {
        cwd: coordinates.workdir,
        quiet: true,
      });
      launchSpec = buildLaneGreenAuthorityReproofLaunchSpec({
        controlCommonDir,
        controlHeadSha,
        controlRoot: input.root,
        coordinates,
        evidence: input.evidence,
        planSha256: manifest.planSha256,
        sourceBaseSha: admission.sourceBaseSha,
        sourceCommits: admission.sourceCommits,
        sourceHeadSha: admission.sourceHeadSha,
        sourceTreeSha: admission.sourceTreeSha,
        startSha,
        taskBlockHash: task.taskBlockHash,
        taskId: input.taskId,
      });
      launchEnv = buildTaskLaunchEnv({
        authorityRepairArchive: "none",
        baseSha: controlHeadSha,
        controlCommonDir,
        controlRoot: input.root,
        evidence: input.evidence,
        hostTestMaxLoad1m: "20",
        reproofRequest: "none",
        resumeBranch: coordinates.branch,
        resumeCommits: admission.sourceCommits.join(","),
        resumeExpectedCommit: "none",
        resumeMode: "none",
        resumeProofHead: admission.sourceHeadSha,
        resumeSourceHead: admission.sourceHeadSha,
        resumeTaskBase: admission.sourceBaseSha,
        startSha,
        taskId: input.taskId,
        workdir: coordinates.workdir,
      });
      const config = materializeBuildTaskRunConfig({
        env: launchEnv,
        graph: resolve(".fabro/workflows/brain-build-task/workflow.fabro"),
        path: resolve(
          input.state,
          "launch-configs",
          `lane-green-${input.taskId}-${coordinates.authorityId}.toml`,
        ),
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
    recordOwner: (createdRunId) => {
      if (!launchEnv)
        throw new Error("authority reproof launch env is missing");
      recordPreparingTaskLaunch({
        auditPath,
        expected: launchSpec.preparingRecord,
        now,
        recordPath: input.recordPath,
        runId: createdRunId,
        taskId: input.taskId,
      });
      runRtk(["fabro", "start", createdRunId, "--json", "--no-upgrade-check"], {
        env: launchEnv,
        quiet: true,
      });
    },
    promoteOwner: (createdRunId) =>
      promoteTaskReservation(input.recordPath, {
        ...launchSpec.preparingRecord,
        runId: createdRunId,
        status: "launched",
      }),
  });
  releaseNow();
  console.log(
    `${input.taskId}: lane-green authority reproof launched as ${runId}`,
  );
};
