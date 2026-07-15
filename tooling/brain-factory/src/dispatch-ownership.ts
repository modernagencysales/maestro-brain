import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

type JsonRecord = Record<string, unknown>;

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;

const appendAudit = (path: string, value: JsonRecord): void => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
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
  const archivedPath = `${input.recordPath}.terminal-${input.now.replaceAll(":", "-")}`;
  renameSync(input.recordPath, archivedPath);
  appendAudit(input.auditPath, {
    action: "archive-terminal-task-run",
    archivedPath,
    at: input.now,
    runId: input.runId,
    status: input.status,
    taskId: input.taskId,
  });
  return archivedPath;
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
