import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildLaneGreenAuthorityReproofLaunchSpec,
  laneGreenAuthorityReproofCoordinates,
  resolveLaneGreenAuthorityReproofReservation,
  runLaneGreenAuthorityReproofLaunch,
} from "../src/lane-green-authority-reproof-launch.js";

const sha = (value: string, length = 40): string => value.repeat(length);

describe("lane-green authority reproof launch", () => {
  it("wires an exclusive resume CLI mode without evidence synthesis", () => {
    const resumeSource = readFileSync(
      fileURLToPath(new URL("../src/resume.mts", import.meta.url)),
      "utf8",
    );
    const launchSource = readFileSync(
      fileURLToPath(
        new URL(
          "../src/lane-green-authority-reproof-launch.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(resumeSource).toContain('"--lane-green-authority-reproof"');
    expect(resumeSource).toContain("launchLaneGreenAuthorityReproof({");
    expect(launchSource).not.toContain("preserveAuthorityRefreshEvidence");
    expect(launchSource).not.toContain("writeFileSync");
  });

  it("creates and replays before launching the normal build-task workflow", () => {
    const events: string[] = [];
    const runId = runLaneGreenAuthorityReproofLaunch({
      createCurrentWorktree: () => events.push("worktree"),
      replayExactCommits: () => events.push("replay"),
      launchNormalBuildTask: () => (events.push("launch"), "run-1"),
      recordOwner: () => events.push("record"),
      promoteOwner: () => events.push("promote"),
      rollback: () => events.push("rollback"),
    });
    expect(runId).toBe("run-1");
    expect(events).toEqual([
      "worktree",
      "replay",
      "launch",
      "record",
      "promote",
    ]);
  });

  it("uses deterministic current-authority coordinates", () => {
    expect(
      laneGreenAuthorityReproofCoordinates({
        controlHeadSha: sha("a"),
        planSha256: sha("b", 64),
        root: "/repo",
        taskBlockHash: sha("c", 64),
        taskId: "S05-T01",
      }).branch,
    ).toMatch(/^fabro\/reproof-s05-t01-green-[0-9a-f]{12}$/);
  });

  it("binds the reservation and launch inputs to current authority and exact replay", () => {
    const coordinates = {
      authorityId: "123456789abc",
      branch: "fabro/reproof-s05-t01-green-123456789abc",
      workdir: "/workdir",
    };
    const sourceCommits = [sha("d"), sha("e")];
    const spec = buildLaneGreenAuthorityReproofLaunchSpec({
      controlCommonDir: "/git-common",
      controlHeadSha: sha("a"),
      controlRoot: "/repo",
      coordinates,
      evidence: "/evidence",
      planSha256: sha("b", 64),
      sourceBaseSha: sha("c"),
      sourceCommits,
      sourceHeadSha: sha("e"),
      sourceTreeSha: sha("f"),
      startSha: sha("9"),
      taskBlockHash: sha("7", 64),
      taskId: "S05-T01",
    });
    expect(spec.preparingRecord).toMatchObject({
      baseSha: sha("a"),
      planSha256: sha("b", 64),
      sourceCommits,
      sourceHeadSha: sha("e"),
      taskBlockHash: sha("7", 64),
    });
    expect(spec.configInputs).toMatchObject({
      base_sha: sha("a"),
      resume_commits: sourceCommits.join(","),
      resume_source_head: sha("e"),
      start_sha: sha("9"),
      task_id: "S05-T01",
      workdir: "/workdir",
    });
  });

  it("recovers exactly one matching launched preparing reservation", () => {
    const expected = {
      baseSha: sha("a"),
      branch: "fabro/reproof-s05-t01-green-123456789abc",
      mode: "lane-green-authority-reproof",
      status: "preparing",
      taskId: "S05-T01",
      workdir: "/workdir",
    };
    expect(
      resolveLaneGreenAuthorityReproofReservation({
        candidates: [
          {
            branch: expected.branch,
            inspection: {
              run_id: "run-1",
              run_spec: {
                settings: {
                  run: {
                    inputs: {
                      base_sha: expected.baseSha,
                      task_id: expected.taskId,
                      workdir: expected.workdir,
                    },
                    metadata: { task: expected.taskId },
                  },
                },
              },
            },
          },
        ],
        expectedConfigInputs: {
          base_sha: expected.baseSha,
          task_id: expected.taskId,
          workdir: expected.workdir,
        },
        expectedReservation: expected,
        reservation: expected,
      }),
    ).toEqual({ kind: "recover-launched", runId: "run-1" });
  });

  it("permits relaunch only when reconciliation proves no launch occurred", () => {
    const expected = {
      baseSha: sha("a"),
      branch: "fabro/reproof-s05-t01-green-123456789abc",
      mode: "lane-green-authority-reproof",
      status: "preparing",
      taskId: "S05-T01",
      workdir: "/workdir",
    };
    expect(
      resolveLaneGreenAuthorityReproofReservation({
        candidates: [],
        expectedConfigInputs: {
          base_sha: expected.baseSha,
          task_id: expected.taskId,
          workdir: expected.workdir,
        },
        expectedReservation: expected,
        reservation: expected,
      }),
    ).toEqual({ kind: "retry-launch" });
    expect(() =>
      resolveLaneGreenAuthorityReproofReservation({
        expectedConfigInputs: {},
        expectedReservation: expected,
        reservation: expected,
      }),
    ).toThrow("preparing reservation launch state is unknown");
  });
});
