import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { selectAuthorityTransition } from "../src/authority-transition-cli.js";
import { assertLaneGreenAuthorityProofAncestry } from "../src/lane-green-authority-reproof-history.js";
import {
  assertExactLaneGreenAuthorityCandidate,
  repairLaneGreenAuthorityReplay,
} from "../src/lane-green-authority-reproof-candidate.js";

import {
  buildLaneGreenAuthorityReproofLaunchSpec,
  laneGreenAuthorityReproofCoordinates,
  resolveLaneGreenAuthorityReproofReservation,
  runLaneGreenAuthorityReproofLaunch,
} from "../src/lane-green-authority-reproof-launch.js";
import {
  inspectExactLaneGreenCreatingRun,
  resolveLaneGreenAuthorityPreparingOwner,
} from "../src/lane-green-authority-reproof-resume.js";
import { materializeLaneGreenAuthorityWorkflow } from "../src/lane-green-authority-workflow.js";

const sha = (value: string, length = 40): string => value.repeat(length);
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

describe("lane-green authority reproof launch", () => {
  it("rejects a proof base outside the exact proof HEAD history", () => {
    const root = mkdtempSync(join(tmpdir(), "lane-green-proof-history-"));
    git(root, "init", "-q");
    git(root, "config", "user.email", "factory@example.test");
    git(root, "config", "user.name", "Brain Factory");
    writeFileSync(join(root, "proof.txt"), "base\n");
    git(root, "add", "proof.txt");
    git(root, "commit", "-qm", "base");
    const common = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-qb", "proof-head");
    writeFileSync(join(root, "proof.txt"), "head\n");
    git(root, "commit", "-qam", "head");
    const proofHeadSha = git(root, "rev-parse", "HEAD");
    expect(() =>
      assertLaneGreenAuthorityProofAncestry({
        proofBaseSha: common,
        proofHeadSha,
        root,
        taskId: "S05-T01",
      }),
    ).not.toThrow();
    git(root, "checkout", "-q", common);
    git(root, "checkout", "-qb", "divergent-base");
    writeFileSync(join(root, "other.txt"), "other\n");
    git(root, "add", "other.txt");
    git(root, "commit", "-qm", "divergent");

    expect(() =>
      assertLaneGreenAuthorityProofAncestry({
        proofBaseSha: git(root, "rev-parse", "HEAD"),
        proofHeadSha,
        root,
        taskId: "S05-T01",
      }),
    ).toThrow("proof base is not an ancestor of proof HEAD");
  });

  it("rejects any replayed candidate identity drift before launch", () => {
    const expected = {
      branch: "fabro/reproof-s05",
      changedFiles: ["owned.ts"],
      commitCount: 1,
      orderedCommitPatchSha256s: ["d".repeat(64)],
      commonDir: "/git",
      patchSha256: "a".repeat(64),
    };
    const observed = {
      ...expected,
      commits: ["b".repeat(40)],
      orderedCommitPatchSha256s: ["d".repeat(64)],
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
        observed: { ...observed, status: " M owned.ts" },
        taskId: "S05-T01",
      }),
    ).toThrow("replayed candidate identity mismatch");
    expect(() =>
      assertExactLaneGreenAuthorityCandidate({
        expected,
        observed: {
          ...observed,
          orderedCommitPatchSha256s: ["e".repeat(64)],
        },
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

  it("repairs reserved candidates after add-only and partial replay crashes", () => {
    const root = mkdtempSync(join(tmpdir(), "lane-green-replay-"));
    git(root, "init", "-q");
    git(root, "config", "user.email", "factory@example.test");
    git(root, "config", "user.name", "Brain Factory");
    writeFileSync(join(root, "owned.txt"), "base\n");
    git(root, "add", "owned.txt");
    git(root, "commit", "-qm", "base");
    const base = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-qb", "source");
    writeFileSync(join(root, "owned.txt"), "base\none\n");
    git(root, "commit", "-qam", "one");
    const first = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "second.txt"), "two\n");
    git(root, "add", "second.txt");
    git(root, "commit", "-qm", "two");
    const second = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-qB", "candidate", base);

    repairLaneGreenAuthorityReplay({
      controlHeadSha: base,
      sourceCommits: [first, second],
      workdir: root,
    });
    expect(git(root, "rev-list", "--count", `${base}..HEAD`)).toBe("2");

    git(root, "reset", "--hard", "-q", base);
    git(root, "cherry-pick", first);
    writeFileSync(join(root, "owned.txt"), "partial dirty crash\n");
    repairLaneGreenAuthorityReplay({
      controlHeadSha: base,
      sourceCommits: [first, second],
      workdir: root,
    });
    expect(git(root, "rev-list", "--count", `${base}..HEAD`)).toBe("2");
    expect(git(root, "status", "--porcelain=v1")).toBe("");
  });

  it("retries creating-before-create only after exact no-run proof", () => {
    const workflowName = "BrainBuildTaskS05T01Green123456789abc";
    expect(
      inspectExactLaneGreenCreatingRun({
        inspect: (target) => {
          throw new Error(`No run found matching '${target}'`);
        },
        taskId: "S05-T01",
        workflowName,
      }),
    ).toEqual({ kind: "no-run" });
    expect(() =>
      inspectExactLaneGreenCreatingRun({
        inspect: (target) => {
          throw new Error(
            `No run found matching '${target}' (server unavailable)`,
          );
        },
        taskId: "S05-T01",
        workflowName,
      }),
    ).toThrow("preparing reservation launch state is unknown");
    const creating = {
      baseSha: sha("a"),
      branch: "fabro/reproof-s05-t01-green-123456789abc",
      mode: "lane-green-authority-reproof",
      phase: "creating",
      status: "preparing",
      taskId: "S05-T01",
      workdir: "/workdir",
      workflowName,
    };
    expect(
      resolveLaneGreenAuthorityReproofReservation({
        candidates: [],
        expectedConfigInputs: {
          base_sha: creating.baseSha,
          task_id: creating.taskId,
          workdir: creating.workdir,
        },
        expectedReservation: creating,
        reservation: creating,
      }),
    ).toEqual({ kind: "retry-launch" });
    expect(() =>
      inspectExactLaneGreenCreatingRun({
        inspect: () => {
          throw new Error("Fabro server unavailable");
        },
        taskId: "S05-T01",
        workflowName,
      }),
    ).toThrow("preparing reservation launch state is unknown");
  });

  it("rejects reserved owner drift before reusing existing coordinates", () => {
    const root = mkdtempSync(join(tmpdir(), "lane-green-owner-drift-"));
    git(root, "init", "-q");
    git(root, "config", "user.email", "factory@example.test");
    git(root, "config", "user.name", "Brain Factory");
    writeFileSync(join(root, "base.txt"), "base\n");
    git(root, "add", "base.txt");
    git(root, "commit", "-qm", "base");
    const controlHeadSha = git(root, "rev-parse", "HEAD");
    const coordinates = {
      authorityId: "123456789abc",
      branch: "fabro/reproof-s05-t01-green-123456789abc",
      workdir: join(root, "existing-worktree"),
      workflowName: "BrainBuildTaskS05T01Green123456789abc",
    };
    git(root, "branch", coordinates.branch);
    mkdirSync(coordinates.workdir);
    const admission = {
      mode: "lane-green-authority-reproof" as const,
      oldPlanSha256: sha("3", 64),
      oldTaskBlockHash: sha("4", 64),
      proofBaseSha: sha("1"),
      proofFindingIds: ["OWNERSHIP-S05-T01-001"],
      proofGateStage: "pre-review" as const,
      proofHeadSha: sha("2"),
      sourceBaseSha: sha("5"),
      sourceCommits: [sha("6")],
      sourceCommitPatchSha256s: [sha("7", 64)],
      sourceChangedFiles: ["owned.ts"],
      sourceHeadSha: sha("6"),
      sourcePatchSha256: sha("8", 64),
      sourceTreeSha: sha("9"),
    };
    const spec = buildLaneGreenAuthorityReproofLaunchSpec({
      controlCommonDir: git(root, "rev-parse", "--git-common-dir"),
      controlHeadSha,
      controlRoot: root,
      coordinates,
      evidence: join(root, "evidence"),
      planSha256: sha("a", 64),
      proofBaseSha: admission.proofBaseSha,
      proofFindingIds: admission.proofFindingIds,
      proofGateStage: admission.proofGateStage,
      proofHeadSha: admission.proofHeadSha,
      proofPlanSha256: admission.oldPlanSha256,
      proofTaskBlockHash: admission.oldTaskBlockHash,
      sourceBaseSha: admission.sourceBaseSha,
      sourceCommits: admission.sourceCommits,
      sourceCommitPatchSha256s: admission.sourceCommitPatchSha256s,
      sourceHeadSha: admission.sourceHeadSha,
      sourceTreeSha: admission.sourceTreeSha,
      startSha: controlHeadSha,
      taskBlockHash: sha("b", 64),
      taskId: "S05-T01",
    });

    expect(() =>
      resolveLaneGreenAuthorityPreparingOwner({
        admission,
        auditPath: join(root, "audit.jsonl"),
        controlCommonDir: git(root, "rev-parse", "--git-common-dir"),
        controlHeadSha,
        coordinates,
        evidence: join(root, "evidence"),
        now: "2026-07-22T00:00:00.000Z",
        planSha256: sha("a", 64),
        preparingOwner: { ...spec.preparingRecord, branch: "drifted" },
        recordPath: join(root, "owner.json"),
        root,
        taskBlockHash: sha("b", 64),
        taskId: "S05-T01",
      }),
    ).toThrow("lane-green authority reproof reservation mismatch");
  });

  it("materializes a deterministic uniquely named recovery workflow", () => {
    const root = mkdtempSync(join(tmpdir(), "lane-green-workflow-"));
    const sourcePath = join(root, "source.fabro");
    const path = join(root, "generated.fabro");
    writeFileSync(sourcePath, "digraph BrainBuildTask {\n  start\n}\n");
    const workflowName = "BrainBuildTaskS05T01Green123456789abc";
    expect(
      materializeLaneGreenAuthorityWorkflow({
        path,
        sourcePath,
        workflowName,
      }),
    ).toBe(path);
    expect(readFileSync(path, "utf8")).toContain(`digraph ${workflowName} {`);
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
    const recoverySource = readFileSync(
      fileURLToPath(
        new URL(
          "../src/lane-green-authority-reproof-resume.ts",
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
    expect(
      recoverySource.indexOf("prepareExactLaneGreenAuthorityCandidate({"),
    ).toBeLessThan(
      recoverySource.indexOf("inspectExactLaneGreenCreatingRun({"),
    );
    expect(recoverySource).not.toContain('priorRunId ?? "BrainBuildTask"');
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
    const coordinates = laneGreenAuthorityReproofCoordinates({
      controlHeadSha: sha("a"),
      planSha256: sha("b", 64),
      root: "/repo",
      taskBlockHash: sha("c", 64),
      taskId: "S05-T01",
    });
    expect(coordinates.branch).toMatch(
      /^fabro\/reproof-s05-t01-green-[0-9a-f]{12}$/,
    );
    expect(coordinates.workflowName).toMatch(
      /^BrainBuildTaskS05T01Green[0-9a-f]{12}$/,
    );
  });

  it("binds the reservation and launch inputs to current authority and exact replay", () => {
    const coordinates = {
      authorityId: "123456789abc",
      branch: "fabro/reproof-s05-t01-green-123456789abc",
      workdir: "/workdir",
      workflowName: "BrainBuildTaskS05T01Green123456789abc",
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
      sourceCommitPatchSha256s: [sha("8", 64), sha("9", 64)],
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
      sourceCommitPatchSha256s: [sha("8", 64), sha("9", 64)],
      sourceHeadSha: sha("e"),
      taskBlockHash: sha("7", 64),
      workflowName: coordinates.workflowName,
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
