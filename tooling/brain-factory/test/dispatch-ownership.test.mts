import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireDispatcherLock,
  archiveTerminalTaskRecord,
  promoteTaskReservation,
  recoverTaskReservation,
  reserveTaskPreparing,
  runRecordOwnsTask,
} from "../src/dispatch-ownership.js";

const roots: string[] = [];
const fixture = () => {
  const root = mkdtempSync(resolve(tmpdir(), "brain-dispatch-ownership-"));
  roots.push(root);
  return {
    auditPath: resolve(root, "audit.jsonl"),
    lockPath: resolve(root, "dispatch.lock"),
    recordPath: resolve(root, "runs", "S08-T02.json"),
    root,
  };
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("brain dispatch ownership", () => {
  it("keeps resume locked, idempotent, and non-destructive", () => {
    const resume = readFileSync(
      new URL("../src/resume.mts", import.meta.url),
      "utf8",
    );
    expect(resume).toContain("acquireDispatcherLock");
    expect(resume).toContain("resume already owned by");
    expect(resume).toContain("archiveTerminalTaskRecord");
    expect(resume).not.toContain('"worktree", "remove"');
    expect(resume).not.toContain('"-B"');
  });

  it("acquires one exclusive dispatcher lock", () => {
    const value = fixture();
    const release = acquireDispatcherLock({
      auditPath: value.auditPath,
      lockPath: value.lockPath,
      now: "2026-07-14T00:00:00.000Z",
      owner: { pid: 1 },
    });
    expect(() =>
      acquireDispatcherLock({
        auditPath: value.auditPath,
        lockPath: value.lockPath,
        now: "2026-07-14T00:00:01.000Z",
        owner: { pid: 2 },
      }),
    ).toThrow("explicit audited recovery is required");
    release();
  });

  it("atomically reserves preparing before promotion", () => {
    const value = fixture();
    reserveTaskPreparing(value.recordPath, {
      status: "preparing",
      taskId: "S08-T02",
    });
    expect(() =>
      reserveTaskPreparing(value.recordPath, {
        status: "preparing",
        taskId: "S08-T02",
      }),
    ).toThrow("task reservation already exists");
    promoteTaskReservation(value.recordPath, {
      runId: "run-1",
      status: "launched",
      taskId: "S08-T02",
    });
    expect(JSON.parse(readFileSync(value.recordPath, "utf8"))).toMatchObject({
      runId: "run-1",
      status: "launched",
    });
  });

  it("treats inspection errors and unknown status as owned", () => {
    expect(
      runRecordOwnsTask({
        inspect: () => {
          throw new Error("inspect unavailable");
        },
        recordExists: true,
      }),
    ).toBe(true);
    expect(
      runRecordOwnsTask({ inspect: () => undefined, recordExists: true }),
    ).toBe(true);
  });

  it("requires explicit audited recovery and no unresolved worktree", () => {
    const value = fixture();
    reserveTaskPreparing(value.recordPath, {
      status: "preparing",
      taskId: "S08-T02",
    });
    expect(() =>
      recoverTaskReservation({
        auditPath: value.auditPath,
        branchExists: false,
        now: "2026-07-14T00:00:00.000Z",
        reason: "operator is attempting recovery",
        recordPath: value.recordPath,
        taskId: "S08-T02",
        worktreeExists: true,
      }),
    ).toThrow("unresolved worktree or branch still exists");
    recoverTaskReservation({
      auditPath: value.auditPath,
      branchExists: false,
      now: "2026-07-14T00:00:00.000Z",
      reason: "operator verified failed launch and removed the worktree",
      recordPath: value.recordPath,
      taskId: "S08-T02",
      worktreeExists: false,
    });
    expect(readFileSync(value.auditPath, "utf8")).toContain(
      "recover-task-reservation",
    );
  });

  it("archives only terminal ownership without removing its worktree", () => {
    const value = fixture();
    reserveTaskPreparing(value.recordPath, {
      runId: "run-1",
      taskId: "S08-T02",
    });
    expect(() =>
      archiveTerminalTaskRecord({
        auditPath: value.auditPath,
        now: "2026-07-14T00:00:00.000Z",
        recordPath: value.recordPath,
        runId: "run-1",
        status: "running",
        taskId: "S08-T02",
      }),
    ).toThrow(/refusing to archive non-terminal/);
    const archived = archiveTerminalTaskRecord({
      auditPath: value.auditPath,
      now: "2026-07-14T00:00:00.000Z",
      recordPath: value.recordPath,
      runId: "run-1",
      status: "failed",
      taskId: "S08-T02",
    });
    expect(readFileSync(archived, "utf8")).toContain("run-1");
  });
});
