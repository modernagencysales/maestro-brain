import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { archiveTerminalRun } from "../src/terminal-archive.js";

const roots: string[] = [];
const fixture = () => {
  const state = mkdtempSync(join(tmpdir(), "brain-terminal-archive-"));
  roots.push(state);
  const recordPath = join(state, "runs", "S08-T03.json");
  mkdirSync(join(state, "runs"), { recursive: true });
  return { recordPath, state };
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("explicit terminal run archive", () => {
  it("removes ownership only through one audited terminal action", () => {
    const value = fixture();
    writeFileSync(
      value.recordPath,
      JSON.stringify({
        branch: "fabro/brain-s08-t03",
        runId: "run-terminal",
        status: "launched",
        taskId: "S08-T03",
        workdir: "/tmp/s08-t03",
      }),
    );
    const archivedPath = archiveTerminalRun({
      actionId: "a".repeat(64),
      inspect: () => "failed",
      now: "2026-07-19T00:00:00.000Z",
      runId: "run-terminal",
      state: value.state,
      taskId: "S08-T03",
    });
    expect(existsSync(value.recordPath)).toBe(false);
    expect(readFileSync(archivedPath, "utf8")).toContain("run-terminal");
    expect(
      readFileSync(join(value.state, "recovery-audit.jsonl"), "utf8"),
    ).toContain("archive-terminal-task-run");
  });

  it("keeps ownership on live, unknown, or mismatched inspection", () => {
    for (const status of ["running", undefined] as const) {
      const value = fixture();
      writeFileSync(
        value.recordPath,
        JSON.stringify({ runId: "run-live", taskId: "S08-T03" }),
      );
      expect(() =>
        archiveTerminalRun({
          actionId: "b".repeat(64),
          inspect: () => status,
          now: "2026-07-19T00:00:00.000Z",
          runId: "run-live",
          state: value.state,
          taskId: "S08-T03",
        }),
      ).toThrow(status === undefined ? "status is unknown" : "not terminal");
      expect(existsSync(value.recordPath)).toBe(true);
    }
  });
});
