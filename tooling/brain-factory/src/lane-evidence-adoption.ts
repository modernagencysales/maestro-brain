import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

import {
  acquireEvidenceWriteLock,
  atomicWrite,
  fileSha256,
  jsonContent,
} from "./evidence-write.js";
import {
  gitIsAncestor,
  type JsonRecord,
  readJson,
  record,
  string,
} from "./integration-check-support.js";
import { authoritativeIntegrationResultBindsLane } from "./integration-authority.js";

const ADOPTION_SCHEMA = "maestro-brain-lane-evidence-adoption/v1";

const safeSegment = (value: string, label: string): string => {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`${label} is not a safe path segment`);
  }
  return value;
};

interface ManifestTask {
  readonly acceptanceAfter: string;
  readonly taskId: string;
  readonly tranche: string;
}

interface IntegrationAuthority {
  readonly integrationHeadSha: string;
  readonly integrationId: string;
  readonly integrationResultPath: string;
  readonly integrationResultSha256: string;
  readonly laneHeadSha: string;
}

export interface LaneEvidenceAdoptionResult {
  readonly integrationId: string;
  readonly taskId: string;
}

export interface LaneEvidenceAdoptionInput {
  readonly apply?: boolean;
  readonly controlRoot: string;
  readonly currentHeadSha: string;
  readonly evidenceDirectory: string;
  readonly isAncestor?: (ancestor: string, descendant: string) => boolean;
  readonly workdir: string;
}

const manifestTasks = (controlRoot: string): Map<string, ManifestTask> => {
  const manifest = readJson(
    resolve(
      controlRoot,
      "docs/superpowers/execution/maestro-brain/task-manifest.json",
    ),
  );
  if (
    manifest.schemaVersion !== "maestro-brain-task-manifest/v1" ||
    !Array.isArray(manifest.tasks)
  ) {
    throw new Error("unexpected task manifest for lane evidence adoption");
  }
  return new Map(
    manifest.tasks.map((value, index) => {
      const task = record(value, `manifest.tasks[${index}]`);
      const taskId = string(task.taskId, `manifest.tasks[${index}].taskId`);
      return [
        taskId,
        {
          acceptanceAfter: string(
            task.acceptanceAfter,
            `${taskId}: acceptanceAfter`,
          ),
          taskId,
          tranche: string(task.tranche, `${taskId}: tranche`),
        },
      ];
    }),
  );
};

const authorityFor = (input: {
  readonly currentHeadSha: string;
  readonly evidenceDirectory: string;
  readonly existingIntegrationId?: string;
  readonly isAncestor: (ancestor: string, descendant: string) => boolean;
  readonly lane: JsonRecord;
  readonly task: ManifestTask;
}): IntegrationAuthority => {
  const integrationRoot = resolve(input.evidenceDirectory, "integration");
  const taskId = input.task.taskId;
  const laneHeadSha = string(input.lane.headSha, `${taskId}: lane headSha`);
  const laneIntegrationHeadSha = string(
    input.lane.integrationHeadSha,
    `${taskId}: integrationHeadSha`,
  );
  const authorities: IntegrationAuthority[] = [];

  for (const entry of readdirSync(integrationRoot, { withFileTypes: true })
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const resultDirectory = resolve(integrationRoot, entry.name);
    const resultPath = resolve(resultDirectory, "integration-result.json");
    if (!existsSync(resultPath)) continue;
    const result = readJson(resultPath);
    const integrationId = entry.name;
    if (
      !integrationId ||
      (input.existingIntegrationId &&
        input.existingIntegrationId !== integrationId) ||
      !authoritativeIntegrationResultBindsLane({
        integrationHeadSha: laneIntegrationHeadSha,
        integrationId,
        laneHeadSha,
        result,
        resultDirectory,
        taskId,
        taskTranche: input.task.tranche,
      })
    ) {
      continue;
    }
    if (!input.isAncestor(laneIntegrationHeadSha, input.currentHeadSha)) {
      continue;
    }
    authorities.push({
      integrationHeadSha: laneIntegrationHeadSha,
      integrationId,
      integrationResultPath: relative(input.evidenceDirectory, resultPath),
      integrationResultSha256: fileSha256(resultPath),
      laneHeadSha,
    });
  }

  if (authorities.length !== 1) {
    throw new Error(
      `${taskId}: legacy lane has ${authorities.length} authoritative integration results; refusing to invent provenance`,
    );
  }
  return authorities[0] as IntegrationAuthority;
};

const acceptanceBlockerFor = (lane: JsonRecord, task: ManifestTask): string => {
  if (
    lane.accepted === false &&
    typeof lane.acceptanceBlocker === "string" &&
    lane.acceptanceBlocker.trim()
  ) {
    return lane.acceptanceBlocker;
  }
  return task.acceptanceAfter === "none"
    ? "Acceptance remains deferred until the task acceptance contract is re-proved; adopted integration evidence proves integration only."
    : `Acceptance remains deferred until ${task.acceptanceAfter}; adopted integration evidence proves integration only.`;
};

const receiptFor = (input: {
  readonly adoption: JsonRecord;
  readonly laneResultSha256After: string;
  readonly taskId: string;
}): JsonRecord => ({
  ...input.adoption,
  laneResultSha256After: input.laneResultSha256After,
  taskId: input.taskId,
});

/**
 * Upgrade only historical `integrated` lane records. A passed integration
 * result must bind the exact task, lane head, integration head, broad gate,
 * and current ancestry before any provenance or acceptance field is written.
 */
const adoptLegacyIntegratedLaneEvidenceUnlocked = (
  input: LaneEvidenceAdoptionInput,
): readonly LaneEvidenceAdoptionResult[] => {
  const tasks = manifestTasks(input.controlRoot);
  const laneRoot = resolve(input.evidenceDirectory, "lane-results");
  const isAncestor =
    input.isAncestor ??
    ((ancestor: string, descendant: string) =>
      gitIsAncestor(input.workdir, ancestor, descendant));
  const adopted: LaneEvidenceAdoptionResult[] = [];

  for (const entry of readdirSync(laneRoot, { withFileTypes: true })
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const taskId = safeSegment(entry.name, "lane taskId");
    const lanePath = resolve(laneRoot, taskId, "lane-result.json");
    if (!existsSync(lanePath)) continue;
    const lane = readJson(lanePath);
    if (lane.taskId !== taskId || lane.status !== "integrated") continue;
    const task = tasks.get(taskId);
    if (!task) throw new Error(`${taskId}: absent from task manifest`);
    const embedded =
      typeof lane.evidenceAdoption === "object" &&
      lane.evidenceAdoption !== null
        ? record(lane.evidenceAdoption, `${taskId}: evidenceAdoption`)
        : undefined;
    const retainsAcceptedBecause = Object.hasOwn(lane, "acceptedBecause");
    const needsAdoption =
      typeof lane.integrationId !== "string" ||
      !lane.integrationId ||
      lane.accepted !== false ||
      typeof lane.acceptanceBlocker !== "string" ||
      !lane.acceptanceBlocker.trim() ||
      retainsAcceptedBecause;
    if (!needsAdoption && !embedded) continue;

    const authority = authorityFor({
      currentHeadSha: input.currentHeadSha,
      evidenceDirectory: input.evidenceDirectory,
      ...(typeof lane.integrationId === "string" && lane.integrationId
        ? { existingIntegrationId: lane.integrationId }
        : {}),
      isAncestor,
      lane,
      task,
    });
    const acceptanceBlocker = acceptanceBlockerFor(lane, task);
    const beforeSha256 = embedded
      ? string(
          embedded.laneResultSha256Before,
          `${taskId}: adopted before hash`,
        )
      : fileSha256(lanePath);
    const previousTranche = embedded
      ? string(embedded.previousTranche, `${taskId}: previous tranche`)
      : string(lane.tranche, `${taskId}: legacy lane tranche`);
    const adoption: JsonRecord = {
      acceptanceAfter: task.acceptanceAfter,
      acceptanceBlocker,
      accepted: false,
      integrationHeadSha: authority.integrationHeadSha,
      integrationId: authority.integrationId,
      integrationResultPath: authority.integrationResultPath,
      integrationResultSha256: authority.integrationResultSha256,
      laneHeadSha: authority.laneHeadSha,
      laneResultSha256Before: beforeSha256,
      manifestTranche: task.tranche,
      previousTranche,
      schemaVersion: ADOPTION_SCHEMA,
    };
    if (embedded && JSON.stringify(embedded) !== JSON.stringify(adoption)) {
      throw new Error(`${taskId}: adopted lane provenance drift`);
    }
    const laneWithoutAcceptedBecause = { ...lane };
    delete laneWithoutAcceptedBecause.acceptedBecause;
    const nextLane =
      embedded && !retainsAcceptedBecause
        ? lane
        : {
            ...laneWithoutAcceptedBecause,
            acceptanceBlocker,
            accepted: false,
            evidenceAdoption: adoption,
            integrationId: authority.integrationId,
            tranche: task.tranche,
          };
    const changesLane = JSON.stringify(nextLane) !== JSON.stringify(lane);
    if (changesLane && input.apply === false) {
      adopted.push({ integrationId: authority.integrationId, taskId });
      continue;
    }
    const beforeCleanupSha256 = fileSha256(lanePath);
    const receiptPath = resolve(
      laneRoot,
      taskId,
      "lane-evidence-adoption.json",
    );
    if (changesLane && embedded && existsSync(receiptPath)) {
      const existingReceipt = readJson(receiptPath);
      const expectedExistingReceipt = receiptFor({
        adoption: embedded,
        laneResultSha256After: beforeCleanupSha256,
        taskId,
      });
      if (
        JSON.stringify(existingReceipt) !==
        JSON.stringify(expectedExistingReceipt)
      ) {
        throw new Error(`${taskId}: lane evidence adoption receipt drift`);
      }
    }
    if (changesLane) atomicWrite(lanePath, jsonContent(nextLane));
    const afterSha256 = fileSha256(lanePath);
    const receipt = receiptFor({
      adoption,
      laneResultSha256After: afterSha256,
      taskId,
    });
    const receiptContent = jsonContent(receipt);
    if (existsSync(receiptPath)) {
      if (readFileSync(receiptPath, "utf8") !== receiptContent) {
        if (changesLane && embedded) {
          atomicWrite(receiptPath, receiptContent);
        } else {
          throw new Error(`${taskId}: lane evidence adoption receipt drift`);
        }
      }
    } else if (input.apply !== false) {
      atomicWrite(receiptPath, receiptContent);
    } else {
      throw new Error(`${taskId}: adopted lane evidence has no receipt`);
    }
    if (changesLane) {
      adopted.push({ integrationId: authority.integrationId, taskId });
    }
  }
  return adopted;
};

export const adoptLegacyIntegratedLaneEvidence = (
  input: LaneEvidenceAdoptionInput,
): readonly LaneEvidenceAdoptionResult[] => {
  if (input.apply === false) {
    return adoptLegacyIntegratedLaneEvidenceUnlocked(input);
  }
  const release = acquireEvidenceWriteLock(
    resolve(input.evidenceDirectory, ".lane-evidence-adoption.lock"),
  );
  try {
    return adoptLegacyIntegratedLaneEvidenceUnlocked(input);
  } finally {
    release();
  }
};
