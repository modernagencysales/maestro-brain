import { describe, expect, it } from "vitest";
import { buildManifest, validateManifest } from "../src/manifest.js";
import { selectReadyTasks } from "../src/scheduler.js";

describe("control-lane receipt contract", () => {
  it("binds four full ordered commits and the exact tail", () => {
    const task = buildManifest().tasks.find(
      (item) => item.taskId === "S15-T01",
    );
    if (!task) throw new Error("missing control task");
    const chain = task.controlCommitChain;
    if (!chain) throw new Error("missing control commit chain");
    expect(chain).toHaveLength(4);
    expect(chain.every((sha) => /^[0-9a-f]{40}$/.test(sha))).toBe(true);
    expect(task.controlHeadSha).toBe(chain.at(-1));
    expect(validateManifest(buildManifest())).toEqual([]);
  });

  it("does not dispatch the control checkpoint as product work", () => {
    const manifest = buildManifest();
    const result = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(["S05-T01"]),
      maximum: 100,
      tasks: manifest.tasks,
    });
    expect(result.selected.some((task) => task.kind === "control")).toBe(false);
  });
});
