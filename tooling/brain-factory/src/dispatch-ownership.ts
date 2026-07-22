import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { BrainTaskContract } from "./manifest.js";
import { validateProofContract } from "./proof.js";

type JsonRecord = Record<string, unknown>;

const owningLaneResultStatuses = new Set(["lane_green", "false_green"]);

export const laneResultRetainsTaskOwnership = (
  status: string | undefined,
): boolean => status !== undefined && owningLaneResultStatuses.has(status);

const jsonRecord = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return value as JsonRecord;
};

const nonemptyString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is missing`);
  }
  return value;
};

export const resolveGreenHeadTransitionBase = (input: {
  readonly controlHeadSha: string;
  readonly finalGate: unknown;
  readonly isAncestor: (ancestor: string, descendant: string) => boolean;
  readonly lane: unknown;
  readonly predecessor: BrainTaskContract;
  readonly proof: unknown;
  readonly transition: BrainTaskContract;
  readonly treeAt: (headSha: string) => string;
}): string => {
  const label = `${input.transition.taskId}: green-head proof chain drift`;
  if (
    input.transition.greenHeadAfter !== input.predecessor.taskId ||
    input.transition.mandatorySameWaveAfter !== input.predecessor.taskId
  ) {
    throw new Error(label);
  }
  const lane = jsonRecord(input.lane, label);
  const proof = jsonRecord(input.proof, label);
  const gate = jsonRecord(input.finalGate, label);
  validateProofContract(proof, input.predecessor);
  const headSha = nonemptyString(lane.headSha, label);
  const treeSha = input.treeAt(headSha);
  const proofBaseSha = nonemptyString(proof.baseSha, label);
  if (
    !/^[0-9a-f]{40}$/.test(headSha) ||
    !/^[0-9a-f]{40}$/.test(treeSha) ||
    !/^[0-9a-f]{40}$/.test(proofBaseSha) ||
    lane.schemaVersion !== "maestro-brain-lane-result/v1" ||
    lane.taskId !== input.predecessor.taskId ||
    lane.status !== "lane_green" ||
    lane.treeSha !== treeSha ||
    proof.headSha !== headSha ||
    proof.reviewVerdict !== "pass" ||
    proof.reviewHeadSha !== headSha ||
    !Array.isArray(proof.reviewFindings) ||
    proof.reviewFindings.length !== 0 ||
    gate.schemaVersion !== "maestro-brain-lane-gate/v1" ||
    gate.taskId !== input.predecessor.taskId ||
    gate.stage !== "final" ||
    gate.status !== "passed" ||
    gate.headSha !== headSha ||
    gate.currentHeadSha !== headSha ||
    gate.currentTreeSha !== treeSha ||
    gate.planSha256 !== proof.planSha256 ||
    gate.taskBlockHash !== input.predecessor.taskBlockHash ||
    !input.isAncestor(proofBaseSha, headSha) ||
    !input.isAncestor(input.controlHeadSha, headSha)
  ) {
    throw new Error(label);
  }
  return headSha;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
};

const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

export type PreparingTaskReconciliation =
  | { readonly kind: "ambiguous" }
  | { readonly kind: "launched"; readonly runId: string }
  | { readonly kind: "not-launched" }
  | { readonly kind: "unknown" };

export const reconcilePreparingTaskReservation = (input: {
  readonly candidates?: readonly {
    readonly branch?: unknown;
    readonly inspection?: unknown;
  }[];
  readonly expectedConfigInputs: unknown;
  readonly reservation: unknown;
}): PreparingTaskReconciliation => {
  if (input.candidates === undefined) return { kind: "unknown" };

  let reservation: JsonRecord;
  let taskId: string;
  let branch: string;
  let workdir: string;
  let baseSha: string;
  let configInputs: JsonRecord;
  try {
    reservation = jsonRecord(input.reservation, "preparing reservation");
    if (reservation.status !== "preparing") return { kind: "unknown" };
    taskId = nonemptyString(reservation.taskId, "reservation task ID");
    branch = nonemptyString(reservation.branch, "reservation branch");
    workdir = nonemptyString(reservation.workdir, "reservation workdir");
    baseSha = nonemptyString(reservation.baseSha, "reservation base SHA");
    configInputs = jsonRecord(input.expectedConfigInputs, "config inputs");
    if (
      configInputs.task_id !== taskId ||
      configInputs.workdir !== workdir ||
      configInputs.base_sha !== baseSha
    ) {
      return { kind: "unknown" };
    }
  } catch {
    return { kind: "unknown" };
  }

  const runIds: string[] = [];
  for (const candidate of input.candidates) {
    try {
      if (candidate.branch !== branch) return { kind: "unknown" };
      const inspectionItems = Array.isArray(candidate.inspection)
        ? candidate.inspection
        : [candidate.inspection];
      if (inspectionItems.length !== 1) return { kind: "unknown" };
      const run = jsonRecord(inspectionItems[0], "Fabro candidate run");
      const runId = nonemptyString(run.run_id, "Fabro candidate run ID");
      const runSpec = jsonRecord(run.run_spec, "Fabro candidate run spec");
      const settings = jsonRecord(
        runSpec.settings,
        "Fabro candidate run settings",
      );
      const configuration = jsonRecord(
        settings.run,
        "Fabro candidate run configuration",
      );
      const metadata = jsonRecord(
        configuration.metadata ?? runSpec.labels ?? run.labels,
        "Fabro candidate metadata",
      );
      const candidateInputs = jsonRecord(
        configuration.inputs,
        "Fabro candidate inputs",
      );
      if (
        metadata.task !== taskId ||
        canonicalJson(candidateInputs) !== canonicalJson(configInputs)
      ) {
        return { kind: "unknown" };
      }
      runIds.push(runId);
    } catch {
      return { kind: "unknown" };
    }
  }

  if (runIds.length === 0) return { kind: "not-launched" };
  if (runIds.length !== 1 || new Set(runIds).size !== 1)
    return { kind: "ambiguous" };
  const [runId] = runIds;
  if (runId === undefined) return { kind: "unknown" };
  return { kind: "launched", runId };
};

export const taskReservationOwnsIntegrationCandidate = (
  value: unknown,
  expectedTaskId: string,
  inspect: (runId: string) => string | undefined,
): boolean => {
  const reservation = jsonRecord(value, `${expectedTaskId}: task reservation`);
  if (reservation.taskId !== expectedTaskId) {
    throw new Error(`${expectedTaskId}: reservation task identity mismatch`);
  }
  nonemptyString(reservation.branch, `${expectedTaskId}: reservation branch`);
  nonemptyString(reservation.workdir, `${expectedTaskId}: reservation workdir`);
  if (reservation.status === "preparing") return true;
  if (reservation.status === "launched") {
    const runId = nonemptyString(
      reservation.runId,
      `${expectedTaskId}: launched reservation has no run ID`,
    );
    let status: string | undefined;
    try {
      status = inspect(runId);
    } catch {
      return true;
    }
    return !new Set(["canceled", "cancelled", "failed", "succeeded"]).has(
      status ?? "unknown",
    );
  }
  throw new Error(`${expectedTaskId}: task reservation status is invalid`);
};

export const taskIsAvailableIntegrationCandidate = (input: {
  readonly completed: boolean;
  readonly inspect: (runId: string) => string | undefined;
  readonly reservation?: unknown;
  readonly taskId: string;
}): boolean => {
  if (input.completed) return false;
  if (input.reservation === undefined) return true;
  return !taskReservationOwnsIntegrationCandidate(
    input.reservation,
    input.taskId,
    input.inspect,
  );
};

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;

const appendAudit = (path: string, value: JsonRecord): void => {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const descriptor = openSync(path, "a");
  try {
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const directoryDescriptor = openSync(directory, "r");
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
};

export const acquireDispatcherLock = (input: {
  readonly auditPath: string;
  readonly lockPath: string;
  readonly now: string;
  readonly owner: JsonRecord;
  readonly recoveryReason?: string;
}): (() => void) => {
  if (existsSync(input.lockPath)) {
    if (!input.recoveryReason?.trim()) {
      throw new Error(
        `dispatcher lock already exists at ${input.lockPath}; explicit audited recovery is required`,
      );
    }
    const ownerPath = `${input.lockPath}/owner.json`;
    appendAudit(input.auditPath, {
      action: "recover-dispatch-lock",
      at: input.now,
      lockPath: input.lockPath,
      previousOwner: existsSync(ownerPath)
        ? JSON.parse(readFileSync(ownerPath, "utf8"))
        : null,
      reason: input.recoveryReason.trim(),
    });
    rmSync(input.lockPath, { recursive: true });
  }

  try {
    mkdirSync(input.lockPath);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new Error(`dispatcher lock already exists at ${input.lockPath}`);
    }
    throw error;
  }
  writeFileSync(
    `${input.lockPath}/owner.json`,
    `${JSON.stringify(input.owner, null, 2)}\n`,
  );

  return () => rmSync(input.lockPath, { recursive: true });
};

export const reserveTaskPreparing = (
  path: string,
  reservation: JsonRecord,
): void => {
  mkdirSync(dirname(path), { recursive: true });
  let descriptor: number;
  try {
    descriptor = openSync(path, "wx");
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new Error(
        `task reservation already exists at ${path}; explicit audited recovery is required`,
      );
    }
    throw error;
  }
  try {
    writeFileSync(descriptor, `${JSON.stringify(reservation, null, 2)}\n`);
  } finally {
    closeSync(descriptor);
  }
};

export const promoteTaskReservation = (
  path: string,
  record: JsonRecord,
): void => {
  const temporary = `${path}.next`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
    flag: "wx",
  });
  renameSync(temporary, path);
};

export const recoveryCoordinatesForRecord = (input: {
  readonly record: {
    readonly branch?: unknown;
    readonly mode?: unknown;
    readonly taskId?: unknown;
    readonly workdir?: unknown;
  };
  readonly requestedTaskId: string;
}): { readonly branch: string; readonly workdir: string } => {
  if (input.record.taskId !== input.requestedTaskId) {
    throw new Error(
      `${input.requestedTaskId}: record taskId ${String(input.record.taskId)} does not match requested task`,
    );
  }
  if (typeof input.record.branch !== "string" || !input.record.branch.trim()) {
    throw new Error(`${input.requestedTaskId}: record branch is missing`);
  }
  if (
    typeof input.record.workdir !== "string" ||
    !input.record.workdir.trim()
  ) {
    throw new Error(`${input.requestedTaskId}: record workdir is missing`);
  }
  return {
    branch: input.record.branch,
    workdir: input.record.workdir,
  };
};

export const recoverTaskReservation = (input: {
  readonly auditPath: string;
  readonly branchExists: boolean;
  readonly now: string;
  readonly reason?: string;
  readonly recordPath: string;
  readonly taskId: string;
  readonly worktreeExists: boolean;
}): void => {
  if (!input.reason?.trim()) {
    throw new Error(`${input.taskId}: recovery requires --recovery-reason`);
  }
  if (input.worktreeExists || input.branchExists) {
    throw new Error(
      `${input.taskId}: unresolved worktree or branch still exists; inspect and resolve it explicitly before recovering the reservation`,
    );
  }
  if (!existsSync(input.recordPath)) {
    throw new Error(`${input.taskId}: no task reservation exists to recover`);
  }
  const archivedPath = `${input.recordPath}.recovered-${input.now.replaceAll(":", "-")}`;
  renameSync(input.recordPath, archivedPath);
  appendAudit(input.auditPath, {
    action: "recover-task-reservation",
    archivedPath,
    at: input.now,
    reason: input.reason.trim(),
    taskId: input.taskId,
  });
};

export const archiveTerminalTaskRecord = (input: {
  readonly actionId?: string;
  readonly afterAudit?: () => void;
  readonly auditPath: string;
  readonly now: string;
  readonly recordPath: string;
  readonly runId: string;
  readonly status: string;
  readonly taskId: string;
}): string => {
  if (
    !new Set(["canceled", "cancelled", "failed", "succeeded"]).has(input.status)
  )
    throw new Error(
      `${input.taskId}: refusing to archive non-terminal run ${input.runId}`,
    );
  const actionId =
    input.actionId ??
    createHash("sha256")
      .update(
        canonicalJson({
          recordPath: input.recordPath,
          runId: input.runId,
          status: input.status,
          taskId: input.taskId,
        }),
      )
      .digest("hex");
  if (!/^[0-9a-zA-Z._-]+$/.test(actionId)) {
    throw new Error(`${input.taskId}: archive action ID is unsafe`);
  }
  const archivedPath = `${input.recordPath}.terminal-${actionId}`;
  if (existsSync(input.recordPath) && existsSync(archivedPath)) {
    throw new Error(`${input.taskId}: deterministic archive path conflicts`);
  }
  const materializedPath = existsSync(input.recordPath)
    ? input.recordPath
    : existsSync(archivedPath)
      ? archivedPath
      : undefined;
  if (materializedPath === undefined) {
    throw new Error(`${input.taskId}: terminal task record is missing`);
  }
  const archived = jsonRecord(
    JSON.parse(readFileSync(materializedPath, "utf8")),
    `${input.taskId}: terminal task record`,
  );
  if (archived.taskId !== input.taskId || archived.runId !== input.runId) {
    throw new Error(`${input.taskId}: archive identity mismatch`);
  }
  const auditEvent = {
    action: "archive-terminal-task-run",
    actionId,
    archivedPath,
    at: input.now,
    runId: input.runId,
    status: input.status,
    taskId: input.taskId,
  };
  if (existsSync(input.auditPath)) {
    const events = readFileSync(input.auditPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => jsonRecord(JSON.parse(line), "task audit event"));
    const matching = events.filter((event) => event.actionId === actionId);
    if (matching.length > 1) {
      throw new Error(`${input.taskId}: duplicate archive audit events`);
    }
    if (matching.length === 1) {
      const [prior] = matching;
      if (prior === undefined) {
        throw new Error(`${input.taskId}: archive audit disappeared`);
      }
      for (const [key, expected] of Object.entries(auditEvent)) {
        if (key !== "at" && prior[key] !== expected) {
          throw new Error(`${input.taskId}: archive audit identity mismatch`);
        }
      }
      if (!existsSync(archivedPath)) {
        input.afterAudit?.();
        renameSync(input.recordPath, archivedPath);
      }
      return archivedPath;
    }
  }
  appendAudit(input.auditPath, auditEvent);
  input.afterAudit?.();
  if (!existsSync(archivedPath)) renameSync(input.recordPath, archivedPath);
  return archivedPath;
};

export const replaceTerminalTaskRecord = (
  input: {
    readonly auditPath: string;
    readonly expectedContent: string;
    readonly now: string;
    readonly recordPath: string;
    readonly replacement: JsonRecord;
    readonly runId: string;
    readonly status: string;
    readonly taskId: string;
  },
  filesystem: {
    readonly close: (descriptor: number) => void;
    readonly open: (path: string, flags: string) => number;
    readonly remove: (path: string) => void;
    readonly rename: (oldPath: string, newPath: string) => void;
    readonly sync: (descriptor: number) => void;
    readonly write: (descriptor: number, content: string) => void;
  } = {
    close: closeSync,
    open: openSync,
    remove: rmSync,
    rename: renameSync,
    sync: fsyncSync,
    write: (descriptor, content) => writeFileSync(descriptor, content, "utf8"),
  },
): string => {
  if (
    !new Set(["canceled", "cancelled", "failed", "succeeded"]).has(input.status)
  ) {
    throw new Error(
      `${input.taskId}: refusing to replace non-terminal run ${input.runId}`,
    );
  }
  if (
    !existsSync(input.recordPath) ||
    readFileSync(input.recordPath, "utf8") !== input.expectedContent
  ) {
    throw new Error(
      `${input.taskId}: terminal reservation compare-and-swap failed`,
    );
  }
  const actionId = createHash("sha256")
    .update(
      canonicalJson({
        recordPath: input.recordPath,
        runId: input.runId,
        status: input.status,
        taskId: input.taskId,
      }),
    )
    .digest("hex");
  const archivedPath = `${input.recordPath}.terminal-${actionId}`;
  if (existsSync(archivedPath)) {
    if (readFileSync(archivedPath, "utf8") !== input.expectedContent) {
      throw new Error(`${input.taskId}: deterministic archive path conflicts`);
    }
  } else {
    const archiveDescriptor = openSync(archivedPath, "wx");
    try {
      writeFileSync(archiveDescriptor, input.expectedContent, "utf8");
      fsyncSync(archiveDescriptor);
    } finally {
      closeSync(archiveDescriptor);
    }
  }
  const auditEvent = {
    action: "archive-terminal-task-run",
    actionId,
    archivedPath,
    at: input.now,
    runId: input.runId,
    status: input.status,
    taskId: input.taskId,
  };
  const existingEvents = existsSync(input.auditPath)
    ? readFileSync(input.auditPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => jsonRecord(JSON.parse(line), "task audit event"))
        .filter((event) => event.actionId === actionId)
    : [];
  if (existingEvents.length > 1) {
    throw new Error(`${input.taskId}: duplicate replacement audit events`);
  }
  if (existingEvents.length === 1) {
    const [prior] = existingEvents;
    for (const [key, expected] of Object.entries(auditEvent)) {
      if (key !== "at" && prior?.[key] !== expected) {
        throw new Error(`${input.taskId}: replacement audit identity mismatch`);
      }
    }
  } else {
    appendAudit(input.auditPath, auditEvent);
  }
  const replacementContent = `${JSON.stringify(input.replacement, null, 2)}\n`;
  const temporary = `${input.recordPath}.next`;
  if (existsSync(temporary)) {
    throw new Error(`${input.taskId}: stale reservation replacement exists`);
  }
  let descriptor: number | undefined;
  try {
    descriptor = filesystem.open(temporary, "wx");
    try {
      filesystem.write(descriptor, replacementContent);
      filesystem.sync(descriptor);
    } finally {
      filesystem.close(descriptor);
    }
    if (readFileSync(input.recordPath, "utf8") !== input.expectedContent) {
      throw new Error(
        `${input.taskId}: terminal reservation changed before replace`,
      );
    }
    filesystem.rename(temporary, input.recordPath);
  } catch (error) {
    if (descriptor !== undefined && existsSync(temporary)) {
      try {
        filesystem.remove(temporary);
      } catch {
        // Preserve the materialization failure as the actionable error.
      }
    }
    throw error;
  }
  return archivedPath;
};

export const recordPreparingTaskLaunch = (input: {
  readonly auditPath: string;
  readonly expected: JsonRecord;
  readonly now: string;
  readonly recordPath: string;
  readonly runId: string;
  readonly taskId: string;
}): void => {
  const expectedContent = `${JSON.stringify(input.expected, null, 2)}\n`;
  if (
    !existsSync(input.recordPath) ||
    readFileSync(input.recordPath, "utf8") !== expectedContent
  ) {
    throw new Error(
      `${input.taskId}: preparing reservation compare-and-swap failed`,
    );
  }
  const replacementContent = `${JSON.stringify(
    { ...input.expected, runId: input.runId },
    null,
    2,
  )}\n`;
  const temporary = `${input.recordPath}.next`;
  if (existsSync(temporary)) {
    throw new Error(`${input.taskId}: stale reservation replacement exists`);
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx");
    try {
      writeFileSync(descriptor, replacementContent, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (readFileSync(input.recordPath, "utf8") !== expectedContent) {
      throw new Error(
        `${input.taskId}: preparing reservation changed before launch receipt`,
      );
    }
    appendAudit(input.auditPath, {
      action: "record-preparing-task-launch",
      at: input.now,
      branch: input.expected.branch,
      recordPath: input.recordPath,
      runId: input.runId,
      taskId: input.taskId,
      workdir: input.expected.workdir,
    });
    renameSync(temporary, input.recordPath);
  } catch (error) {
    if (descriptor !== undefined) rmSync(temporary, { force: true });
    throw error;
  }
};

interface ResumeIdentity {
  readonly branch: string;
  readonly mode: "resume-review";
  readonly resumeStrategy: "in-lane-cherry-pick" | "prelaunch-cherry-pick";
  readonly sourceHeadSha: string;
  readonly taskBaseSha: string;
  readonly taskId: string;
  readonly workdir: string;
}

interface PreservedResumeObservation {
  readonly branchExists: boolean;
  readonly cherryPickHead?: string;
  readonly controlCommonDir: string;
  readonly headSha: string;
  readonly proofHeadIsAncestor: boolean;
  readonly statusPorcelain: string;
  readonly taskBaseIsAncestor: boolean;
  readonly worktreeBranch: string;
  readonly worktreeCommonDir: string;
  readonly worktreeExists: boolean;
}

const safeArchiveActionId = (value: string): boolean =>
  /^[0-9a-zA-Z._-]+$/.test(value);

export const parseArchiveActionSelector = (
  args: readonly string[],
): string | undefined => {
  const indexes = args.flatMap((value, index) =>
    value === "--archive-action" ? [index] : [],
  );
  if (indexes.length === 0) return undefined;
  if (indexes.length > 1) {
    throw new Error("duplicate --archive-action flags");
  }
  const value = args[(indexes[0] ?? -1) + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--archive-action requires an ID");
  }
  if (!safeArchiveActionId(value)) {
    throw new Error("archive action selector is unsafe");
  }
  return value;
};

export const assertArchiveActionSelectorUsed = (input: {
  readonly archiveActionId: string | undefined;
  readonly auditedArchiveSelected: boolean;
  readonly taskId: string;
}): void => {
  if (input.archiveActionId !== undefined && !input.auditedArchiveSelected) {
    throw new Error(
      `${input.taskId}: --archive-action did not resolve through audited archive selection`,
    );
  }
};

export const assertArchiveActionSelectorApplicable = (input: {
  readonly archiveActionId: string | undefined;
  readonly preservedBranchExists: boolean;
  readonly preservedWorktreeExists: boolean;
  readonly recordExists: boolean;
  readonly taskId: string;
}): void => {
  if (
    input.archiveActionId !== undefined &&
    (input.recordExists ||
      (!input.preservedBranchExists && !input.preservedWorktreeExists))
  ) {
    throw new Error(
      `${input.taskId}: --archive-action did not resolve through audited archive selection`,
    );
  }
};

export const auditedTerminalResumeRecord = (input: {
  readonly archiveActionId?: string;
  readonly auditPath: string;
  readonly expected: ResumeIdentity;
  readonly recordPath: string;
}): {
  readonly actionId: string;
  readonly archivedPath: string;
  readonly record: JsonRecord;
  readonly runId: string;
  readonly status: string;
} => {
  if (
    input.archiveActionId !== undefined &&
    !safeArchiveActionId(input.archiveActionId)
  ) {
    throw new Error(
      `${input.expected.taskId}: archive action selector is unsafe`,
    );
  }
  if (!existsSync(input.auditPath)) {
    throw new Error(
      `${input.expected.taskId}: preserved terminal archive audit is missing`,
    );
  }
  const events = readFileSync(input.auditPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => jsonRecord(JSON.parse(line), "task audit event"))
    .filter(
      (event) =>
        event.action === "archive-terminal-task-run" &&
        event.taskId === input.expected.taskId &&
        (input.archiveActionId === undefined ||
          event.actionId === input.archiveActionId),
    );
  const candidates: {
    actionId: string;
    archivedPath: string;
    record: JsonRecord;
    runId: string;
    status: string;
  }[] = [];
  const seenActionIds = new Set<string>();
  for (const event of events) {
    const archivedPath = nonemptyString(
      event.archivedPath,
      `${input.expected.taskId}: archived terminal path`,
    );
    if (!existsSync(archivedPath)) {
      throw new Error(
        `${input.expected.taskId}: audited terminal archive is missing at ${archivedPath}`,
      );
    }
    const record = jsonRecord(
      JSON.parse(readFileSync(archivedPath, "utf8")),
      `${input.expected.taskId}: archived terminal record`,
    );
    const normalizedRecord: JsonRecord = {
      ...record,
      resumeStrategy: record.resumeStrategy ?? "prelaunch-cherry-pick",
    };
    const exactResume = Object.entries(input.expected).every(
      ([key, value]) => normalizedRecord[key] === value,
    );
    if (!exactResume) continue;

    const actionId = nonemptyString(
      event.actionId,
      `${input.expected.taskId}: archive action ID`,
    );
    if (!/^[0-9a-zA-Z._-]+$/.test(actionId)) {
      throw new Error(`${input.expected.taskId}: archive action ID is unsafe`);
    }
    if (seenActionIds.has(actionId)) {
      throw new Error(
        `${input.expected.taskId}: duplicate audited terminal archive action`,
      );
    }
    seenActionIds.add(actionId);
    if (archivedPath !== `${input.recordPath}.terminal-${actionId}`) {
      throw new Error(
        `${input.expected.taskId}: audited terminal archive path drift`,
      );
    }
    const runId = nonemptyString(
      event.runId,
      `${input.expected.taskId}: archived terminal run ID`,
    );
    const status = nonemptyString(
      event.status,
      `${input.expected.taskId}: archived terminal status`,
    );
    if (
      !new Set(["canceled", "cancelled", "failed", "succeeded"]).has(status)
    ) {
      throw new Error(
        `${input.expected.taskId}: audited archive status is not terminal`,
      );
    }
    if (record.taskId !== input.expected.taskId || record.runId !== runId) {
      throw new Error(
        `${input.expected.taskId}: audited terminal archive content drift`,
      );
    }
    candidates.push({ actionId, archivedPath, record, runId, status });
  }
  if (candidates.length === 0) {
    if (input.archiveActionId !== undefined) {
      throw new Error(
        `${input.expected.taskId}: no audited terminal archive matches action ${input.archiveActionId}`,
      );
    }
    throw new Error(
      `${input.expected.taskId}: no exact audited terminal archive matches preserved resume`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `${input.expected.taskId}: ambiguous audited terminal archives match preserved resume`,
    );
  }
  const [candidate] = candidates;
  if (candidate === undefined) {
    throw new Error(`${input.expected.taskId}: terminal archive disappeared`);
  }
  return candidate;
};

export type PreservedResumeDisposition =
  | { readonly kind: "create" }
  | { readonly kind: "reuse-clean"; readonly startSha: string }
  | { readonly kind: "reuse-conflict"; readonly startSha: string };

export const resolvePreservedFactoryBase = (input: {
  readonly proof?: {
    readonly baseSha?: unknown;
    readonly headSha?: unknown;
    readonly taskId?: unknown;
  };
  readonly recordFactoryBaseSha?: unknown;
  readonly taskId: string;
}): { readonly baseSha: string; readonly proofHeadSha?: string } => {
  let recordedBaseSha: string | undefined;
  if (input.recordFactoryBaseSha !== undefined) {
    if (!/^[0-9a-f]{40}$/.test(String(input.recordFactoryBaseSha))) {
      throw new Error(`${input.taskId}: recorded factory base is invalid`);
    }
    recordedBaseSha = String(input.recordFactoryBaseSha);
  }
  if (input.proof === undefined) {
    if (recordedBaseSha !== undefined) {
      return { baseSha: recordedBaseSha };
    }
    throw new Error(`${input.taskId}: preserved factory base is missing`);
  }
  if (input.proof.taskId !== input.taskId) {
    throw new Error(`${input.taskId}: proof task identity mismatch`);
  }
  if (!/^[0-9a-f]{40}$/.test(String(input.proof.baseSha))) {
    throw new Error(`${input.taskId}: proof factory base is invalid`);
  }
  if (!/^[0-9a-f]{40}$/.test(String(input.proof.headSha))) {
    throw new Error(`${input.taskId}: proof head is invalid`);
  }
  const proofBaseSha = String(input.proof.baseSha);
  if (recordedBaseSha !== undefined && recordedBaseSha !== proofBaseSha) {
    throw new Error(
      `${input.taskId}: recorded factory base differs from proof`,
    );
  }
  return {
    baseSha: recordedBaseSha ?? proofBaseSha,
    proofHeadSha: String(input.proof.headSha),
  };
};

export const preservedResumeDisposition = (input: {
  readonly expected: ResumeIdentity;
  readonly observation: PreservedResumeObservation;
  readonly record: Partial<ResumeIdentity>;
}): PreservedResumeDisposition => {
  const { expected, observation, record } = input;
  const identities = [
    ["task ID", record.taskId, expected.taskId],
    ["mode", record.mode, expected.mode],
    ["resume strategy", record.resumeStrategy, expected.resumeStrategy],
    ["source HEAD", record.sourceHeadSha, expected.sourceHeadSha],
    ["task base", record.taskBaseSha, expected.taskBaseSha],
    ["branch", record.branch, expected.branch],
    ["worktree", record.workdir, expected.workdir],
  ] as const;
  for (const [label, actual, wanted] of identities) {
    if (actual !== wanted) {
      throw new Error(`${expected.taskId}: preserved resume ${label} mismatch`);
    }
  }
  if (observation.branchExists !== observation.worktreeExists) {
    throw new Error(
      `${expected.taskId}: preserved resume branch/worktree presence mismatch`,
    );
  }
  if (!observation.branchExists) return { kind: "create" };
  if (observation.worktreeBranch !== expected.branch) {
    throw new Error(`${expected.taskId}: preserved worktree branch mismatch`);
  }
  if (observation.worktreeCommonDir !== observation.controlCommonDir) {
    throw new Error(
      `${expected.taskId}: preserved worktree repository mismatch`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(observation.headSha)) {
    throw new Error(`${expected.taskId}: preserved worktree HEAD is invalid`);
  }
  if (!observation.taskBaseIsAncestor) {
    throw new Error(
      `${expected.taskId}: preserved task base is not an ancestor of worktree HEAD`,
    );
  }

  const statusLines = observation.statusPorcelain
    .split("\n")
    .filter((line) => line.length > 0);
  if (statusLines.length === 0) {
    if (!observation.proofHeadIsAncestor) {
      throw new Error(
        `${expected.taskId}: preserved proof head is not an ancestor of worktree HEAD`,
      );
    }
    if (observation.cherryPickHead !== undefined) {
      throw new Error(
        `${expected.taskId}: clean worktree has an unexpected cherry-pick marker`,
      );
    }
    return { kind: "reuse-clean", startSha: observation.headSha };
  }

  if (statusLines.some((line) => line.startsWith("??"))) {
    throw new Error(
      `${expected.taskId}: preserved conflict contains untracked files`,
    );
  }
  if (expected.resumeStrategy !== "in-lane-cherry-pick") {
    throw new Error(
      `${expected.taskId}: dirty preserved worktree is not an in-lane resume`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(observation.cherryPickHead ?? "")) {
    throw new Error(
      `${expected.taskId}: dirty preserved worktree has no cherry-pick marker`,
    );
  }
  return { kind: "reuse-conflict", startSha: observation.headSha };
};

export const runRecordOwnsTask = (input: {
  readonly inspect: () => string | undefined;
  readonly recordExists: boolean;
}): boolean => {
  if (!input.recordExists) return false;
  try {
    input.inspect();
  } catch {
    return true;
  }
  return true;
};
