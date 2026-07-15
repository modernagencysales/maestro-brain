import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  commandsForProfiles,
  focusedGateCommand,
  type GateCommand,
  lintCommandForFiles,
} from "./gates.js";
import {
  git,
  gitIsAncestor,
  type JsonRecord,
  readJson,
  record,
  string,
} from "./integration-check-support.js";
import {
  deduplicateGateCommands,
  gateCommandSetHash,
} from "./lane-gate-cache.js";
import type { GateProfile } from "./manifest.js";

export interface IntegratedLaneCheckInput {
  readonly baseSha: string;
  readonly controlRoot: string;
  readonly evidenceDirectory: string;
  readonly headSha: string;
  readonly includedTasks: readonly unknown[];
  readonly integrationId: string;
  readonly manifestTranche: string;
  readonly workdir: string;
}

const manifestTasksFor = (controlRoot: string): Map<string, JsonRecord> => {
  const manifest = readJson(
    resolve(
      controlRoot,
      "docs/superpowers/execution/maestro-brain/task-manifest.json",
    ),
  );
  if (!Array.isArray(manifest.tasks))
    throw new Error("task manifest has no tasks");
  return new Map(
    manifest.tasks.map((value, index) => {
      const task = record(value, `manifest.tasks[${index}]`);
      return [string(task.taskId, `manifest.tasks[${index}].taskId`), task];
    }),
  );
};

export const validateIntegratedLanes = (
  input: IntegratedLaneCheckInput,
): void => {
  if (input.includedTasks.length === 0) throw new Error("no included tasks");
  const manifestTasks = manifestTasksFor(input.controlRoot);
  const includedTaskIds = input.includedTasks.map((value, index) =>
    string(
      record(value, `includedTasks[${index}]`).taskId,
      `includedTasks[${index}].taskId`,
    ),
  );
  if (new Set(includedTaskIds).size !== includedTaskIds.length) {
    throw new Error("duplicate included task");
  }
  const includedTaskSet = new Set(includedTaskIds);
  const seen = new Set<string>();
  const lockOwners = new Map<string, string>();

  for (const [index, value] of input.includedTasks.entries()) {
    const taskId = string(
      record(value, `includedTasks[${index}]`).taskId,
      `includedTasks[${index}].taskId`,
    );
    seen.add(taskId);
    const manifestTask = manifestTasks.get(taskId);
    if (!manifestTask) throw new Error(`${taskId}: absent from task manifest`);
    if (manifestTask.tranche !== input.manifestTranche) {
      throw new Error(`${taskId}: task manifest tranche mismatch`);
    }
    if (manifestTask.fileInventoryStatus !== "ready") {
      throw new Error(`${taskId}: file inventory is not dispatch-ready`);
    }
    if (!Array.isArray(manifestTask.fileLocks)) {
      throw new Error(`${taskId}: manifest fileLocks missing`);
    }
    for (const lock of manifestTask.fileLocks) {
      const exactLock = string(lock, `${taskId}: manifest file lock`);
      const owner = lockOwners.get(exactLock);
      if (owner) {
        throw new Error(
          `${taskId}: file lock ${exactLock} conflicts with ${owner}`,
        );
      }
      lockOwners.set(exactLock, taskId);
    }
    if (!Array.isArray(manifestTask.codeStartAfter)) {
      throw new Error(`${taskId}: manifest codeStartAfter missing`);
    }
    for (const dependency of manifestTask.codeStartAfter) {
      const dependencyId = string(
        dependency,
        `${taskId}: codeStartAfter dependency`,
      );
      if (includedTaskSet.has(dependencyId)) continue;
      const dependencyLanePath = resolve(
        input.evidenceDirectory,
        "lane-results",
        dependencyId,
        "lane-result.json",
      );
      if (!existsSync(dependencyLanePath)) {
        throw new Error(
          `${taskId}: dependency ${dependencyId} has no lane result`,
        );
      }
      const dependencyLane = readJson(dependencyLanePath);
      if (
        !new Set(["integrated", "accepted"]).has(
          String(dependencyLane.status),
        ) ||
        !gitIsAncestor(
          input.workdir,
          string(
            dependencyLane.integrationHeadSha,
            `${dependencyId}: integrationHeadSha`,
          ),
          input.baseSha,
        )
      ) {
        throw new Error(
          `${taskId}: dependency ${dependencyId} is not present on integration base`,
        );
      }
    }

    const laneDirectory = resolve(
      input.evidenceDirectory,
      "lane-results",
      taskId,
    );
    const lanePath = resolve(laneDirectory, "lane-result.json");
    if (!existsSync(lanePath))
      throw new Error(`${taskId}: missing lane result`);
    const lane = readJson(lanePath);
    if (!new Set(["integrated", "accepted"]).has(String(lane.status))) {
      throw new Error(`${taskId}: lane result not integrated`);
    }
    if (lane.integrationHeadSha !== input.headSha) {
      throw new Error(`${taskId}: integration head mismatch`);
    }
    if (lane.tranche !== input.manifestTranche) {
      throw new Error(`${taskId}: manifest tranche mismatch`);
    }
    if (lane.integrationId !== input.integrationId) {
      throw new Error(`${taskId}: integrationId mismatch`);
    }
    const laneHeadSha = string(lane.headSha, `${taskId}: lane headSha`);
    const proof = readJson(resolve(laneDirectory, "ci-proof-packet.json"));
    const proofBaseSha = string(proof.baseSha, `${taskId}: proof baseSha`);
    if (
      proof.taskId !== taskId ||
      proof.headSha !== laneHeadSha ||
      proof.reviewVerdict !== "pass" ||
      !Array.isArray(proof.focusedCommands) ||
      proof.focusedCommands.length === 0 ||
      proof.focusedCommands.some((command) => typeof command !== "string") ||
      !Array.isArray(proof.changedFiles) ||
      proof.changedFiles.length === 0 ||
      proof.changedFiles.some((file) => typeof file !== "string")
    ) {
      throw new Error(
        `${taskId}: proof does not bind a reviewed passing lane head`,
      );
    }
    if (!gitIsAncestor(input.workdir, proofBaseSha, laneHeadSha)) {
      throw new Error(
        `${taskId}: proof base is not an ancestor of the lane head`,
      );
    }
    if (!gitIsAncestor(input.workdir, laneHeadSha, input.headSha)) {
      const cherry = git(input.workdir, [
        "cherry",
        input.headSha,
        laneHeadSha,
        proofBaseSha,
      ]);
      const lines = cherry.split("\n").filter(Boolean);
      if (lines.length === 0 || lines.some((line) => !line.startsWith("- "))) {
        throw new Error(
          `${taskId}: lane commits are absent from integration head`,
        );
      }
    }

    const focusedCommands = (proof.focusedCommands as string[]).map((command) =>
      focusedGateCommand(command),
    );
    const changedFiles = (proof.changedFiles as string[]).filter((file) =>
      existsSync(resolve(input.workdir, file)),
    );
    const lintCommand = lintCommandForFiles(changedFiles);
    const gateCommands = deduplicateGateCommands([
      ...(changedFiles.length > 0
        ? [
            {
              program: "pnpm",
              args: ["exec", "prettier", "--check", ...changedFiles],
            } satisfies GateCommand,
          ]
        : []),
      ...(lintCommand ? [lintCommand] : []),
      ...focusedCommands,
      ...commandsForProfiles(manifestTask.gateProfiles as GateProfile[]),
    ]);
    const gate = readJson(resolve(laneDirectory, "lane-gate-report.json"));
    const commands = gateCommands.map(
      (command) => `rtk ${command.program} ${command.args.join(" ")}`,
    );
    if (
      gate.schemaVersion !== "maestro-brain-lane-gate/v1" ||
      gate.taskId !== taskId ||
      gate.stage !== "final" ||
      gate.status !== "passed" ||
      gate.headSha !== laneHeadSha ||
      gate.currentHeadSha !== laneHeadSha ||
      gate.commandSetHash !== gateCommandSetHash(gateCommands) ||
      JSON.stringify(gate.commands) !== JSON.stringify(commands)
    ) {
      throw new Error(`${taskId}: final lane gate does not bind the lane head`);
    }
  }

  const laneRoot = resolve(input.evidenceDirectory, "lane-results");
  const recordedForAttempt = readdirSync(laneRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((taskId) => {
      const lanePath = resolve(laneRoot, taskId, "lane-result.json");
      return (
        existsSync(lanePath) &&
        readJson(lanePath).integrationId === input.integrationId
      );
    })
    .sort();
  if (JSON.stringify(recordedForAttempt) !== JSON.stringify([...seen].sort())) {
    throw new Error(
      "included task set does not match lane integration records",
    );
  }
};
