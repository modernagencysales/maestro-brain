import { describe, expect, it } from "vitest";

import { selectAuthorityTransition } from "../src/authority-transition-cli.js";
import {
  assertPlanOnlyAuthorityControllerStatus,
  buildPlanOnlyLaneAuthorityLaunchSpec,
  runPlanOnlyLaneAuthorityLaunch,
} from "../src/plan-only-lane-authority-launch.js";
import { assertPlanOnlyCandidateIdentity } from "../src/plan-only-lane-authority-candidate.js";

const sha40 = (value: string): string => value.repeat(40).slice(0, 40);
const sha64 = (value: string): string => value.repeat(64).slice(0, 64);

describe("plan-only lane authority launch", () => {
  it("reserves and replays before creating the normal build run", () => {
    const calls: string[] = [];
    expect(
      runPlanOnlyLaneAuthorityLaunch({
        reserveOwner: () => calls.push("reserve"),
        prepareExactCandidate: () => {
          calls.push("replay");
          return sha40("a");
        },
        createRun: (headSha) => {
          calls.push(`create:${headSha}`);
          return "01KZZZZZZZZZZZZZZZZZZZZZZZ";
        },
        recordRun: () => calls.push("record"),
        startRun: () => calls.push("start"),
        promoteOwner: () => calls.push("promote"),
      }),
    ).toBe("01KZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(calls).toEqual([
      "reserve",
      "replay",
      `create:${sha40("a")}`,
      "record",
      "start",
      "promote",
    ]);
  });

  it("builds a replay-only normal BrainBuildTask reservation", () => {
    const spec = buildPlanOnlyLaneAuthorityLaunchSpec({
      branch: "fabro/plan-only-s11-t02-authority",
      candidateCommits: [sha40("9")],
      candidateCommonDir: "/repo/.git",
      candidateHeadSha: sha40("1"),
      candidateTreeSha: sha40("a"),
      controlHeadSha: sha40("2"),
      evidence: "/tmp/evidence",
      planSha256: sha64("3"),
      sourceBaseSha: sha40("4"),
      sourceCommits: [sha40("5")],
      sourceCommitPatchSha256s: [sha64("8")],
      sourceHeadSha: sha40("5"),
      sourceTreeSha: sha40("6"),
      taskBlockHash: sha64("7"),
      taskId: "S11-T02",
      workdir: "/tmp/workdir",
    });
    expect(spec.configInputs).toMatchObject({
      resume_expected_commit: sha40("1"),
      resume_mode: "plan-only-authority",
      start_sha: sha40("1"),
    });
    expect(spec.preparingRecord).toMatchObject({
      mode: "plan-only-lane-authority",
      candidateCommits: [sha40("9")],
      candidateCommonDir: "/repo/.git",
      candidateHeadSha: sha40("1"),
      candidateTreeSha: sha40("a"),
      sourceHeadSha: sha40("5"),
      sourceCommitPatchSha256s: [sha64("8")],
      status: "preparing",
    });
  });

  it("allows only the preserved MCP file in the controller", () => {
    expect(() =>
      assertPlanOnlyAuthorityControllerStatus(["?? .mcp.json"]),
    ).not.toThrow();
    expect(() => assertPlanOnlyAuthorityControllerStatus([])).not.toThrow();
    expect(() =>
      assertPlanOnlyAuthorityControllerStatus([" M package.json"]),
    ).toThrow("plan-only authority controller is dirty");
  });

  it("selects plan-only authority mutually exclusively", () => {
    expect(
      selectAuthorityTransition(["--plan-only-authority"], "S11-T02"),
    ).toMatchObject({ planOnlyAuthority: true });
    expect(() =>
      selectAuthorityTransition(
        ["--plan-only-authority", "--authority-refresh"],
        "S11-T02",
      ),
    ).toThrow("choose exactly one authority transition");
  });

  it("rejects replay drift before Fabro creation", () => {
    const exact = {
      branch: "fabro/plan-only-s11-t02",
      candidateCommits: [sha40("3"), sha40("4")],
      candidateHeadSha: sha40("4"),
      candidateTreeSha: sha40("5"),
      commonDir: "/repo/.git",
      patchDigests: [sha64("1"), sha64("2")],
      status: "",
    };
    expect(() =>
      assertPlanOnlyCandidateIdentity({ expected: exact, observed: exact }),
    ).not.toThrow();
    expect(() =>
      assertPlanOnlyCandidateIdentity({
        expected: exact,
        observed: { ...exact, candidateHeadSha: sha40("9") },
      }),
    ).toThrow("candidate identity mismatch");
  });

  it("stops immediately when replay fails", () => {
    const calls: string[] = [];
    expect(() =>
      runPlanOnlyLaneAuthorityLaunch({
        reserveOwner: () => calls.push("reserve"),
        prepareExactCandidate: () => {
          calls.push("replay");
          throw new Error("conflict");
        },
        createRun: () => {
          calls.push("create");
          return "run";
        },
        recordRun: () => calls.push("record"),
        startRun: () => calls.push("start"),
        promoteOwner: () => calls.push("promote"),
      }),
    ).toThrow("conflict");
    expect(calls).toEqual(["reserve", "replay"]);
  });
});
