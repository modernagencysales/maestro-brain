import { describe, expect, it, vi } from "vitest";

import {
  buildTerminalContractReproofResume,
  runTerminalContractReproofResume,
} from "../src/terminal-contract-reproof-resume.js";

const sha = (value: string): string => value.repeat(40).slice(0, 40);
const digest = (value: string): string => value.repeat(64).slice(0, 64);

const taskId = "S04-T04";
const runId = "01KY64NR32560KPVBY5NXZ7RQP";
const requestPath = "/evidence/reproofs/S04-T04/43aa1624/969bd3c8/request.json";
const requestSha256 =
  "b108e00922cbff5785f6d9c7ed3295c5685fd3a063b8cc3b9aa963ad42aad421";
const findingsSha256 =
  "25038431c86e7376c5d3410be27eecca20a4144910caa13068129ecf4004b707";
const sourceBaseSha = "f6a9988a0a5efc40201b005fa2cdc1021b0d17f2";
const sourceHeadSha = "7c6499da177e4c6bc98ea8e095ab5b5271df6659";
const controlHeadSha = "d1fab8d48bf0291f67e7ccaa45d6c71c13040f94";
const requestControlHeadSha = "969bd3c821f5db26ea586bbec82a5014d6d68909";
const candidateHeadSha = "f07e866188df807d10f1b01843aaebfddf80a033";
const taskBlockHash =
  "43aa1624cd7754ad5635e47f0e43bc7333c8b04b639a33b7670a7e032707dea1";

const fixture = () => ({
  admittedRequest: {
    controlHeadSha: requestControlHeadSha,
    planSha256: digest("a"),
    priorIntegrationId: "wave-000056",
    requestSha256,
    taskBlockHash,
    taskId,
  },
  authorityDeltaPaths: [
    "docs/superpowers/plans/current.md",
    "tooling/brain-factory/src/review-aggregate.mts",
  ],
  controlCommonDir: "/repo/.git",
  controlHeadSha,
  currentPlanSha256: digest("b"),
  currentTaskBlockHash: taskBlockHash,
  currentTaskFileLocks: [
    "packages/convex/confect/slack/channelPolicies.impl.ts",
  ],
  finalGate: {
    currentHeadSha: candidateHeadSha,
    headSha: candidateHeadSha,
    planSha256: digest("a"),
    stage: "pre-review",
    status: "passed",
    taskBlockHash,
    taskId,
  },
  inspectedRun: {
    inputs: {
      base_sha: requestControlHeadSha,
      reproof_request: requestPath,
      resume_branch: "fabro/reproof-s04-t04-969bd3c8",
      resume_commits: `${sha("1")},${sha("2")}`,
      resume_source_head: sourceHeadSha,
      resume_task_base: sourceBaseSha,
      task_id: taskId,
      workdir: "/worktrees/reproof-s04-t04-969bd3c8",
    },
    runId,
    status: "failed",
  },
  proof: {
    baseSha: requestControlHeadSha,
    headSha: candidateHeadSha,
    planSha256: digest("a"),
    reviewHeadSha: candidateHeadSha,
    reviewVerdict: "pending",
    taskBlockHash,
    taskId,
  },
  record: {
    branch: "fabro/reproof-s04-t04-969bd3c8",
    mode: "contract-reproof",
    ownerFindingsSha256: findingsSha256,
    requestSha256,
    resumeStrategy: "in-lane-cherry-pick",
    runId,
    sourceHeadSha,
    status: "launched",
    taskBaseSha: sourceBaseSha,
    taskId,
    workdir: "/worktrees/reproof-s04-t04-969bd3c8",
  },
  requestPath,
  routing: {
    owners: {
      [taskId]: {
        findingsSha256,
        requestSha256,
        runId,
        status: "launched",
      },
    },
    schemaVersion: "maestro-brain-owner-rework-routing/v1",
    status: "complete",
  },
  sourceCommits: [sha("1"), sha("2")],
  terminalStatus: "failed",
  worktree: {
    branch: "fabro/reproof-s04-t04-969bd3c8",
    clean: true,
    commonDir: "/repo/.git",
    headSha: candidateHeadSha,
    requestControlHeadIsAncestor: true,
    sourceRangeIsValid: true,
    workdir: "/worktrees/reproof-s04-t04-969bd3c8",
  },
});

describe("terminal contract-reproof resume", () => {
  it("binds the exact S04 terminal owner into a preserved current-workflow launch", () => {
    const result = buildTerminalContractReproofResume(fixture());

    expect(result.preparingRecord).toMatchObject({
      branch: "fabro/reproof-s04-t04-969bd3c8",
      mode: "contract-reproof",
      ownerFindingsSha256: findingsSha256,
      requestSha256,
      sourceHeadSha,
      status: "preparing",
      taskBaseSha: sourceBaseSha,
      taskId,
      workdir: "/worktrees/reproof-s04-t04-969bd3c8",
    });
    expect(result.launchInputs).toMatchObject({
      base_sha: requestControlHeadSha,
      reproof_request: requestPath,
      resume_branch: "fabro/reproof-s04-t04-969bd3c8",
      resume_mode: "preserved-worktree",
      resume_proof_head: candidateHeadSha,
      resume_source_head: sourceHeadSha,
      resume_task_base: sourceBaseSha,
      start_sha: candidateHeadSha,
    });
    expect(result.launchInputs.resume_commits).toBe(`${sha("1")},${sha("2")}`);
  });

  it.each([
    ["live owner", { terminalStatus: "running" }],
    ["dirty worktree", { worktree: { ...fixture().worktree, clean: false } }],
    ["head drift", { worktree: { ...fixture().worktree, headSha: sha("d") } }],
    ["request drift", { requestPath: `${requestPath}.other` }],
    [
      "compiled source drift",
      {
        inspectedRun: {
          ...fixture().inspectedRun,
          inputs: {
            ...fixture().inspectedRun.inputs,
            resume_commits: sha("9"),
          },
        },
      },
    ],
    [
      "routing drift",
      {
        routing: {
          ...fixture().routing,
          owners: {
            [taskId]: {
              ...fixture().routing.owners[taskId],
              requestSha256: digest("e"),
            },
          },
        },
      },
    ],
    ["task contract drift", { currentTaskBlockHash: digest("f") }],
    [
      "non-control authority delta",
      { authorityDeltaPaths: ["packages/convex/confect/unrelated.ts"] },
    ],
    [
      "task-lock authority collision",
      {
        authorityDeltaPaths: [
          "packages/convex/confect/slack/channelPolicies.impl.ts",
        ],
      },
    ],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      buildTerminalContractReproofResume({ ...fixture(), ...override }),
    ).toThrow();
  });

  it("archives the terminal owner before launch and promotes only the returned run", () => {
    const order: string[] = [];
    const replaceTerminalOwner = vi.fn(() => order.push("replace"));
    const launch = vi.fn(() => {
      order.push("launch");
      return "01KY7000000000000000000000";
    });
    const promote = vi.fn(() => order.push("promote"));

    expect(
      runTerminalContractReproofResume({
        launch,
        promote,
        replaceTerminalOwner,
      }),
    ).toBe("01KY7000000000000000000000");
    expect(order).toEqual(["replace", "launch", "promote"]);
  });
});
