import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { selectAuthorityTransition } from "../src/authority-transition-cli.js";
import {
  assertPlanOnlyAuthorityControllerStatus,
  assertPlanOnlyWorkflowIdentity,
  buildPlanOnlyCandidateCheckpoint,
  buildPlanOnlyLaneAuthorityLaunchSpec,
  runPlanOnlyLaneAuthorityLaunch,
} from "../src/plan-only-lane-authority-launch.js";
import { assertPlanOnlyCandidateIdentity } from "../src/plan-only-lane-authority-candidate.js";
import { candidateIdentityFromRecord } from "../src/plan-only-lane-authority-run.js";
import { gitCommitPatchSha256 } from "../src/lane-green-authority-reproof-candidate.js";
import { inspectLaneGreenAuthorityFabroRun } from "../src/lane-green-authority-reproof-inspect.js";
import { preparePlanOnlyCandidate } from "../src/plan-only-lane-authority-candidate.js";
import { recoverPlanOnlyCreatingRun } from "../src/plan-only-lane-authority-recovery.js";

const sha40 = (value: string): string => value.repeat(40).slice(0, 40);
const sha64 = (value: string): string => value.repeat(64).slice(0, 64);
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

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
      workflowName: "BrainBuildTaskS11T02Plan123456789abc",
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

  it("reconciles a durable creating run without creating another", () => {
    const calls: string[] = [];
    expect(
      runPlanOnlyLaneAuthorityLaunch({
        existingRunId: "01KZZZZZZZZZZZZZZZZZZZZZZZ",
        inspectRunStatus: () => "running",
        reserveOwner: () => calls.push("reserve"),
        prepareExactCandidate: () => {
          calls.push("replay");
          return sha40("a");
        },
        createRun: () => {
          calls.push("create");
          return "duplicate";
        },
        recordRun: () => calls.push("record"),
        startRun: () => calls.push("start"),
        promoteOwner: () => calls.push("promote"),
      }),
    ).toBe("01KZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(calls).toEqual(["reserve", "replay", "promote"]);
  });

  it("discovers a durable creating run after exact candidate preparation", () => {
    const calls: string[] = [];
    expect(
      runPlanOnlyLaneAuthorityLaunch({
        inspectRunStatus: () => "running",
        resolveExistingRunId: () => {
          calls.push("discover");
          return "01KZZZZZZZZZZZZZZZZZZZZZZZ";
        },
        reserveOwner: () => calls.push("reserve"),
        prepareExactCandidate: () => {
          calls.push("replay");
          return sha40("a");
        },
        createRun: () => {
          calls.push("create");
          return "duplicate";
        },
        recordRun: () => calls.push("record"),
        startRun: () => calls.push("start"),
        promoteOwner: () => calls.push("promote"),
      }),
    ).toBe("01KZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(calls).toEqual(["reserve", "replay", "discover", "promote"]);
  });

  it("retains a known creating run while checkpointing the candidate", () => {
    const runId = "01KZZZZZZZZZZZZZZZZZZZZZZZ";
    expect(
      buildPlanOnlyCandidateCheckpoint({
        preparingRecord: { phase: "replayed", candidateHeadSha: sha40("a") },
        prior: { phase: "creating", runId },
      }),
    ).toEqual({
      phase: "creating",
      candidateHeadSha: sha40("a"),
      runId,
    });
  });

  it("rejects a stale deterministic workflow identity", () => {
    expect(() =>
      assertPlanOnlyWorkflowIdentity({
        expected: "BrainBuildTaskS11T02Plan123456789abc",
        observed: "BrainBuildTaskS11T02Planabcdef123456",
        taskId: "S11-T02",
      }),
    ).toThrow("preparing owner workflow identity drifted");
  });

  it("never adopts candidate identity from a reserved record", () => {
    const replayed = {
      branch: "fabro/plan-only-s11-t02",
      candidateCommitPatchSha256s: [sha64("1")],
      candidateCommits: [sha40("2")],
      candidateCommonDir: "/repo/.git",
      candidateHeadSha: sha40("2"),
      candidateTreeSha: sha40("3"),
      phase: "reserved",
    };
    expect(candidateIdentityFromRecord(replayed)).toBeUndefined();
    expect(
      candidateIdentityFromRecord({ ...replayed, phase: "replayed" }),
    ).toMatchObject({ candidateHeadSha: sha40("2") });
  });

  it("replays a reserved crash to byte-identical commit SHAs", () => {
    const root = mkdtempSync(join(tmpdir(), "plan-only-replay-"));
    git(root, "init", "-q");
    git(root, "config", "user.email", "factory@example.test");
    git(root, "config", "user.name", "Brain Factory");
    writeFileSync(
      join(root, ".gitignore"),
      ".brain-review-output/\n.tokensave\n",
    );
    writeFileSync(join(root, "owned.txt"), "base\n");
    git(root, "add", ".gitignore", "owned.txt");
    git(root, "commit", "-qm", "base");
    const base = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-qb", "source");
    writeFileSync(join(root, "owned.txt"), "base\none\n");
    git(root, "commit", "-qam", "one");
    const source = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-qB", "control", base);
    const workdir = join(root, "candidate");
    const common = {
      branch: "fabro/plan-only-s11-t02-test",
      controlHeadSha: base,
      expectedPatchDigests: [gitCommitPatchSha256(root, source)],
      hydrate: () => undefined,
      root,
      sourceCommits: [source],
      workdir,
    };
    const first = preparePlanOnlyCandidate(common);
    const second = preparePlanOnlyCandidate(common);
    expect(second.candidateCommits).toEqual(first.candidateCommits);
    expect(second.candidateHeadSha).toBe(first.candidateHeadSha);
    expect(second.candidateTreeSha).toBe(first.candidateTreeSha);
  });

  it("recovers post-create crash through durable fake Fabro discovery", () => {
    const root = mkdtempSync(join(tmpdir(), "plan-only-fabro-crash-"));
    const recordPath = join(root, "S11-T02.json");
    const auditPath = join(root, "audit.jsonl");
    const workflowName = "BrainBuildTaskS11T02Plan123456789abc";
    const expectedConfigInputs = {
      base_sha: sha40("1"),
      resume_source_head: sha40("2"),
      resume_task_base: sha40("3"),
      task_id: "S11-T02",
      workdir: "/candidate",
    };
    const reservation = {
      baseSha: sha40("1"),
      branch: "fabro/plan-only-s11-t02-test",
      mode: "plan-only-lane-authority",
      phase: "creating",
      status: "preparing",
      taskId: "S11-T02",
      workdir: "/candidate",
      workflowName,
    };
    writeFileSync(recordPath, `${JSON.stringify(reservation, null, 2)}\n`);
    const fakeRtk = join(root, "rtk");
    writeFileSync(
      fakeRtk,
      `#!/bin/sh
printf '%s\n' '[{"run_id":"01KZZZZZZZZZZZZZZZZZZZZZZZ","run_spec":{"settings":{"run":{"metadata":{"task":"S11-T02"},"inputs":{"base_sha":"${sha40("1")}","resume_source_head":"${sha40("2")}","resume_task_base":"${sha40("3")}","task_id":"S11-T02","workdir":"/candidate"}}}}}]'
`,
    );
    chmodSync(fakeRtk, 0o755);
    const recovered = recoverPlanOnlyCreatingRun({
      auditPath,
      branch: reservation.branch,
      expectedConfigInputs,
      expectedReservation: reservation,
      inspect: (target) =>
        inspectLaneGreenAuthorityFabroRun(target, {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ""}`,
        }),
      now: "2026-07-22T00:00:00.000Z",
      recordPath,
      reservation,
      taskId: "S11-T02",
      workflowName,
    });
    expect(recovered).toBe("01KZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(JSON.parse(readFileSync(recordPath, "utf8")).runId).toBe(recovered);
  });

  it("rejects a discovered run with mismatched source lineage", () => {
    const workflowName = "BrainBuildTaskS11T02Plan123456789abc";
    const reservation = {
      phase: "creating",
      status: "preparing",
      taskId: "S11-T02",
      workflowName,
    };
    expect(() =>
      recoverPlanOnlyCreatingRun({
        auditPath: "/unused/audit.jsonl",
        branch: "fabro/plan-only-s11-t02-test",
        expectedConfigInputs: {
          resume_source_head: sha40("1"),
          resume_task_base: sha40("2"),
          task_id: "S11-T02",
        },
        expectedReservation: reservation,
        inspect: () => [
          {
            run_id: "01KZZZZZZZZZZZZZZZZZZZZZZZ",
            run_spec: {
              settings: {
                run: {
                  inputs: {
                    resume_source_head: sha40("9"),
                    resume_task_base: sha40("2"),
                    task_id: "S11-T02",
                  },
                  metadata: { task: "S11-T02" },
                },
              },
            },
          },
        ],
        now: "2026-07-22T00:00:00.000Z",
        recordPath: "/unused/S11-T02.json",
        reservation,
        taskId: "S11-T02",
        workflowName,
      }),
    ).toThrow("preparing reservation launch state is unknown");
  });
});
