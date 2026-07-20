import { describe, expect, it } from "vitest";

import {
  checkpointReproofCoordinates,
  runCheckpointReproofLaunch,
} from "../src/checkpoint-reproof-launch.js";

describe("checkpoint reproof launch", () => {
  it("creates a fresh current-authority owner before normal review", () => {
    const events: string[] = [];
    const runId = runCheckpointReproofLaunch({
      createCurrentWorktree: () => events.push("worktree"),
      cherryPickExactCheckpoint: () => events.push("cherry-pick"),
      launchNormalBuildTask: () => (events.push("launch"), "run-1"),
      recordOwner: () => events.push("record"),
      promoteOwner: () => events.push("promote"),
      rollback: () => events.push("rollback"),
    });
    expect(runId).toBe("run-1");
    expect(events).toEqual([
      "worktree",
      "cherry-pick",
      "launch",
      "record",
      "promote",
    ]);
    expect(
      checkpointReproofCoordinates({
        taskId: "S04-T04",
        controlHeadSha: "a".repeat(40),
        planSha256: "b".repeat(64),
        taskBlockHash: "c".repeat(64),
        root: "/repo",
      }).branch,
    ).toMatch(/^fabro\/reproof-s04-t04-checkpoint-[0-9a-f]{12}$/);
  });
});
