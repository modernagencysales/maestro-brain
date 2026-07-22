import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { selectAuthorityTransition } from "../src/authority-transition-cli.js";
import { assertExactLaneGreenAuthorityCandidate } from "../src/lane-green-authority-reproof-candidate.js";

import {
  buildLaneGreenAuthorityReproofLaunchSpec,
  laneGreenAuthorityReproofCoordinates,
  resolveLaneGreenAuthorityReproofReservation,
  runLaneGreenAuthorityReproofLaunch,
} from "../src/lane-green-authority-reproof-launch.js";

const sha = (value: string, length = 40): string => value.repeat(length);

describe("lane-green authority reproof launch", () => {
  it("rejects any replayed candidate identity drift before launch", () => {
    const expected = {
      branch: "fabro/reproof-s05",
      changedFiles: ["owned.ts"],
      commitCount: 1,
      commonDir: "/git",
      patchSha256: "a".repeat(64),
    };
    const observed = {
      ...expected,
      commits: ["b".repeat(40)],
      status: "",
    };
    expect(() =>
      assertExactLaneGreenAuthorityCandidate({
        expected,
        observed: { ...observed, patchSha256: "c".repeat(64) },
        taskId: "S05-T01",
      }),
    ).toThrow("replayed candidate identity mismatch");
    expect(() =>
      assertExactLaneGreenAuthorityCandidate({
        expected,
        observed,
        taskId: "S05-T01",
      }),
    ).not.toThrow();
  });

  it("rejects mutually exclusive authority CLI modes in the production parser", () => {
    expect(() =>
      selectAuthorityTransition(
        ["--lane-green-authority-reproof", "--checkpoint-reproof"],
        "S05-T01",
      ),
    ).toThrow("choose exactly one authority transition");
    expect(
      selectAuthorityTransition(["--lane-green-authority-reproof"], "S05-T01")
        .laneGreenAuthorityReproof,
    ).toBe(true);

    const resumePath = fileURLToPath(
      new URL("../src/resume.mts", import.meta.url),
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resumePath,
        "--task",
        "S05-T01",
        "--lane-green-authority-reproof",
        "--checkpoint-reproof",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("choose exactly one authority transition");
  });

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
    expect(resumeSource).toContain("selectAuthorityTransition(");
    expect(resumeSource).toContain("launchLaneGreenAuthorityReproof({");
    expect(launchSource).not.toContain("preserveAuthorityRefreshEvidence");
    expect(launchSource).not.toContain("writeFileSync");
    expect(launchSource).toContain('process.off("exit", releaseOnExit)');
  });

  it("creates and replays before launching the normal build-task workflow", () => {
    const events: string[] = [];
    const runId = runLaneGreenAuthorityReproofLaunch({
      createCurrentWorktree: () => events.push("worktree"),
      reserveOwner: () => events.push("reserve"),
      replayExactCommits: () => events.push("replay"),
      launchNormalBuildTask: () => (events.push("launch"), "run-1"),
      recordOwner: () => events.push("record"),
      promoteOwner: () => events.push("promote"),
    });
    expect(runId).toBe("run-1");
    expect(events).toEqual([
      "reserve",
      "worktree",
      "replay",
      "launch",
      "record",
      "promote",
    ]);
  });

  it.each(["worktree", "replay", "launch", "record", "promote"] as const)(
    "preserves the preparing checkpoint when %s fails",
    (failure) => {
      const events: string[] = [];
      const step = (name: typeof failure): void => {
        events.push(name);
        if (failure === name) throw new Error(`${name} failed`);
      };
      expect(() =>
        runLaneGreenAuthorityReproofLaunch({
          reserveOwner: () => events.push("reserve"),
          createCurrentWorktree: () => step("worktree"),
          replayExactCommits: () => step("replay"),
          launchNormalBuildTask: () => (step("launch"), "run-1"),
          recordOwner: () => step("record"),
          promoteOwner: () => step("promote"),
        }),
      ).toThrow(`${failure} failed`);
      expect(events[0]).toBe("reserve");
      expect(events).not.toContain("rollback");
    },
  );

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
      proofBaseSha: sha("1"),
      proofFindingIds: ["OWNERSHIP-S05-T01-001"],
      proofGateStage: "pre-review",
      proofHeadSha: sha("2"),
      proofPlanSha256: sha("3", 64),
      proofTaskBlockHash: sha("4", 64),
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
      proofBaseSha: sha("1"),
      proofHeadSha: sha("2"),
      proofPlanSha256: sha("3", 64),
      proofTaskBlockHash: sha("4", 64),
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
