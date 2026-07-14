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
      expect.arrayContaining(["S01-T01", "S02-T01", "S03-T01", "S11-T01"]),
    );
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
});
