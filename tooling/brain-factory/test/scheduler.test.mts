import { describe, expect, it } from "vitest";
import { buildManifest } from "../src/manifest.js";
import { selectReadyTasks } from "../src/scheduler.js";

describe("brain task scheduler", () => {
  it("starts independent contract lanes together", () => {
    const manifest = buildManifest();
    const result = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(),
      maximum: 10,
      tasks: manifest.tasks,
    });
    expect(result.selected.map((task) => task.taskId)).toEqual(
      expect.arrayContaining(["S00-T02", "S01-T01", "S02-T01", "S03-T01"]),
    );
    expect(
      result.selected.every((task) => task.fileInventoryStatus === "ready"),
    ).toBe(true);
  });

  it("does not dispatch an overlapping shared lock", () => {
    const manifest = buildManifest();
    const s01 = manifest.tasks.find((task) => task.taskId === "S01-T01");
    const s08 = manifest.tasks.find((task) => task.taskId === "S08-T01");
    expect(s01).toBeDefined();
    expect(s08).toBeDefined();
    if (!s01 || !s08) throw new Error("test fixtures missing from manifest");
    const synthetic = {
      ...s08,
      fileLocks: s01.fileLocks,
    };
    const result = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(),
      maximum: 2,
      requestedTaskIds: new Set([s01.taskId, synthetic.taskId]),
      tasks: [s01, synthetic],
    });
    expect(result.selected).toHaveLength(1);
  });

  it("requires integrated code-start dependencies", () => {
    const manifest = buildManifest();
    const task = manifest.tasks.find(
      (candidate) => candidate.taskId === "S01-T02",
    );
    expect(task).toBeDefined();
    if (!task) throw new Error("S01-T02 missing from manifest");
    expect(
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: new Set(),
        maximum: 1,
        tasks: [task],
      }).selected,
    ).toEqual([]);
  });

  it("does not dispatch S13 operations before MCP and export contracts", () => {
    const manifest = buildManifest();
    const task = manifest.tasks.find(
      (candidate) => candidate.taskId === "S13-T03",
    );
    expect(task).toBeDefined();
    if (!task) throw new Error("S13-T03 missing from manifest");
    const completed = new Set(["S06-T02", "S08-T01", "S11-T04"]);
    expect(
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: completed,
        maximum: 1,
        tasks: [task],
      }).selected,
    ).toEqual([]);
    completed.add("S12-T02");
    expect(
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: completed,
        maximum: 1,
        tasks: [task],
      }).selected.map((candidate) => candidate.taskId),
    ).toEqual(["S13-T03"]);
  });

  it("does not dispatch a task whose exact file inventory is open", () => {
    const manifest = buildManifest();
    const task = manifest.tasks.find(
      (candidate) => candidate.taskId === "S01-T01",
    );
    expect(task?.fileInventoryStatus).toBe("ready");
    const openTask = task
      ? ({
          ...task,
          fileInventoryStatus: "open:F" as const,
        } satisfies typeof task)
      : undefined;
    expect(
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: new Set(),
        maximum: 1,
        tasks: openTask ? [openTask] : [],
      }).selected,
    ).toEqual([]);
  });

  it("keeps locks held for lane-green tasks awaiting integration", () => {
    const manifest = buildManifest();
    const laneGreen = manifest.tasks.find(
      (candidate) => candidate.taskId === "S12-T01",
    );
    const candidate = manifest.tasks.find((task) => task.taskId === "S09-T01");
    expect(laneGreen).toBeDefined();
    expect(candidate).toBeDefined();
    if (!laneGreen || !candidate)
      throw new Error("scheduler fixtures missing from manifest");

    const overlappingCandidate = {
      ...candidate,
      fileLocks: laneGreen.fileLocks,
    };
    expect(
      selectReadyTasks({
        activeTaskIds: new Set([laneGreen.taskId]),
        completedTaskIds: new Set(),
        maximum: 1,
        tasks: [laneGreen, overlappingCandidate],
      }).selected,
    ).toEqual([]);
  });
});
