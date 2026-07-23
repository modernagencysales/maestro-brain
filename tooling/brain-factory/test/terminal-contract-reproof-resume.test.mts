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
const controlRoot = "/repo";
const controlCommonDir = "/repo/.git";
const evidence = "/evidence";

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
  authorityRepairArchive: "none",
  controlCommonDir,
  controlRoot,
  controlHeadSha,
  canonicalOwnerFindingsSha256: findingsSha256,
  currentPlanSha256: digest("b"),
  currentTaskBlockHash: taskBlockHash,
  currentTaskFileLocks: [
    "packages/convex/confect/slack/channelPolicies.impl.ts",
  ],
  evidence,
  hostTestMaxLoad1m: "20",
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
      authority_repair_archive: "none",
      base_sha: requestControlHeadSha,
      control_common_dir: controlCommonDir,
      control_root: controlRoot,
      evidence_dir: evidence,
      host_test_max_load_1m: "20",
      reproof_request: requestPath,
      resume_branch: "fabro/reproof-s04-t04-969bd3c8",
      resume_commits: `${sha("1")},${sha("2")}`,
      resume_mode: "conflict-aware",
      resume_expected_commit: "none",
      resume_proof_head: "none",
      resume_source_head: sourceHeadSha,
      resume_task_base: sourceBaseSha,
      task_id: taskId,
      start_sha: requestControlHeadSha,
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
    findingSha256: findingsSha256,
    owners: {
      [taskId]: {
        findingsSha256,
        requestSha256,
        runId,
        status: "launched",
      },
    },
    schemaVersion: "maestro-brain-owner-rework-routing/v1",
    resultSha256: digest("3"),
    selectionFileSha256: digest("4"),
    selectionPayloadSha256: digest("5"),
    status: "complete",
  },
  sourceCommits: [sha("1"), sha("2")],
  terminalStatus: "failed",
  worktree: {
    branch: "fabro/reproof-s04-t04-969bd3c8",
    clean: true,
    commonDir: "/repo/.git",
    controlCheckout: false,
    factoryRootContained: true,
    headSha: candidateHeadSha,
    requestControlHeadIsAncestor: true,
    registered: true,
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
      authority_repair_archive: "none",
      base_sha: requestControlHeadSha,
      control_common_dir: controlCommonDir,
      control_root: controlRoot,
      evidence_dir: evidence,
      host_test_max_load_1m: "20",
      reproof_request: requestPath,
      resume_branch: "fabro/reproof-s04-t04-969bd3c8",
      resume_mode: "preserved-worktree",
      resume_expected_commit: "none",
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
    [
      "unregistered worktree",
      { worktree: { ...fixture().worktree, registered: false } },
    ],
    [
      "shared checkout",
      { worktree: { ...fixture().worktree, controlCheckout: true } },
    ],
    [
      "compiled mode drift",
      {
        inspectedRun: {
          ...fixture().inspectedRun,
          inputs: {
            ...fixture().inspectedRun.inputs,
            resume_mode: "preserved-worktree",
          },
        },
      },
    ],
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
    ["finding content drift", { canonicalOwnerFindingsSha256: digest("8") }],
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
    ["package metadata drift", { authorityDeltaPaths: ["package.json"] }],
    [
      "unrelated workflow drift",
      { authorityDeltaPaths: [".fabro/workflows/unrelated/workflow.fabro"] },
    ],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      buildTerminalContractReproofResume({ ...fixture(), ...override }),
    ).toThrow();
  });

  it("accepts the real factory-control evolution with an unchanged task contract", () => {
    expect(() =>
      buildTerminalContractReproofResume({
        ...fixture(),
        authorityDeltaPaths: [
          ".fabro/workflows/brain-build-task/workflow.fabro",
          "docs/superpowers/execution/maestro-brain/parallelism-contract.json",
          "docs/superpowers/execution/maestro-brain/task-manifest.json",
          "docs/superpowers/plans/2026-07-14-maestro-brain-agency-context-os-implementation-plan.md",
          "docs/superpowers/plans/2026-07-22-maestro-brain-repair-first-fabro-recovery-implementation-plan.md",
          "docs/superpowers/specs/2026-07-22-maestro-brain-repair-first-fabro-recovery-design.md",
          "tooling/brain-factory/src/authority-transition-cli.ts",
          "tooling/brain-factory/src/contract-reproof.ts",
          "tooling/brain-factory/src/lane-green-authority-reproof-admission.ts",
          "tooling/brain-factory/src/lane-green-authority-reproof-candidate.ts",
          "tooling/brain-factory/src/lane-green-authority-reproof-history.ts",
          "tooling/brain-factory/src/lane-green-authority-reproof-inspect.ts",
          "tooling/brain-factory/src/lane-green-authority-reproof-launch.ts",
          "tooling/brain-factory/src/lane-green-authority-reproof-owner.ts",
          "tooling/brain-factory/src/lane-green-authority-reproof-recovery.ts",
          "tooling/brain-factory/src/lane-green-authority-reproof-resume.ts",
          "tooling/brain-factory/src/lane-green-authority-reproof-run.ts",
          "tooling/brain-factory/src/lane-green-authority-reproof-spec.ts",
          "tooling/brain-factory/src/lane-green-authority-reproof.ts",
          "tooling/brain-factory/src/lane-green-authority-validation.ts",
          "tooling/brain-factory/src/lane-green-authority-workflow.ts",
          "tooling/brain-factory/src/manifest.ts",
          "tooling/brain-factory/src/process.ts",
          "tooling/brain-factory/src/resume.mts",
          "tooling/brain-factory/src/review-aggregate.mts",
          "tooling/brain-factory/src/review-worktrees.ts",
          "tooling/brain-factory/src/terminal-contract-reproof-launch.ts",
          "tooling/brain-factory/src/terminal-contract-reproof-recovery.ts",
          "tooling/brain-factory/src/terminal-contract-reproof-resume.ts",
          "tooling/brain-factory/src/terminal-contract-reproof-safety.ts",
          "tooling/brain-factory/src/transient-confect-codegen.ts",
          "tooling/brain-factory/test/authority-refresh.test.mts",
          "tooling/brain-factory/test/contract-reproof.test.mts",
          "tooling/brain-factory/test/lane-green-authority-reproof-launch.test.mts",
          "tooling/brain-factory/test/lane-green-authority-reproof.test.mts",
          "tooling/brain-factory/test/manifest.test.mts",
          "tooling/brain-factory/test/parallelism-contract.test.mts",
          "tooling/brain-factory/test/review-aggregate-refs.test.mts",
          "tooling/brain-factory/test/terminal-contract-reproof-cli.test.mts",
          "tooling/brain-factory/test/terminal-contract-reproof-launch.test.mts",
          "tooling/brain-factory/test/terminal-contract-reproof-recovery.test.mts",
          "tooling/brain-factory/test/terminal-contract-reproof-resume.test.mts",
          "tooling/brain-factory/test/terminal-contract-reproof-safety.test.mts",
          "tooling/brain-factory/test/transient-confect-codegen.test.mts",
          "tooling/brain-factory/test/workflow-prompt-contract.test.mts",
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    "authority_repair_archive",
    "control_common_dir",
    "control_root",
    "evidence_dir",
    "host_test_max_load_1m",
    "resume_expected_commit",
  ])("rejects compiled %s drift", (key) => {
    const current = fixture();
    expect(() =>
      buildTerminalContractReproofResume({
        ...current,
        inspectedRun: {
          ...current.inspectedRun,
          inputs: { ...current.inspectedRun.inputs, [key]: "drift" },
        },
      }),
    ).toThrow("compiled request launch identity drift");
  });

  it("records a deterministic created run before start and promotion", () => {
    const order: string[] = [];
    const discoverOrCreate = vi.fn(() => {
      order.push("create");
      return "01KY7000000000000000000000";
    });
    const recordCreated = vi.fn(() => order.push("record"));
    const start = vi.fn(() => order.push("start"));
    const promote = vi.fn(() => order.push("promote"));

    expect(
      runTerminalContractReproofResume({
        discoverOrCreate,
        promote,
        recordCreated,
        start,
      }),
    ).toBe("01KY7000000000000000000000");
    expect(order).toEqual(["create", "record", "start", "promote"]);
  });

  it("does not replace terminal ownership when creation cannot be reconciled", () => {
    const recordCreated = vi.fn();
    expect(() =>
      runTerminalContractReproofResume({
        discoverOrCreate: () => {
          throw new Error("unknown creation state");
        },
        promote: vi.fn(),
        recordCreated,
        start: vi.fn(),
      }),
    ).toThrow("unknown creation state");
    expect(recordCreated).not.toHaveBeenCalled();
  });
});
