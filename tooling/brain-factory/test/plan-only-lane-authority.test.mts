import { describe, expect, it } from "vitest";

import {
  admitPlanOnlyLaneAuthority,
  type PlanOnlyLaneAuthorityInput,
} from "../src/plan-only-lane-authority.js";

const sha40 = (value: string): string => value.repeat(40).slice(0, 40);
const sha64 = (value: string): string => value.repeat(64).slice(0, 64);

type DeepMutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? DeepMutable<Item>[]
    : T[Key] extends object
      ? DeepMutable<T[Key]>
      : T[Key];
};

const input = (): DeepMutable<PlanOnlyLaneAuthorityInput> => {
  const taskId = "S11-T02";
  const taskBlockHash = sha64("b");
  const sourceBaseSha = sha40("a");
  const sourceHeadSha = sha40("c");
  const sourceTreeSha = sha40("d");
  const sourceCommits = [sha40("1"), sourceHeadSha];
  return {
    controlHeadSha: sha40("e"),
    currentTask: {
      codeStartAfter: ["S01-T02", "S11-T01"],
      fileLocks: [
        "packages/example/owned.test.ts",
        "packages/example/owned.ts",
      ],
      planSha256: sha64("f"),
      sourceSliceBudget: 300,
      sourceSliceLimit: 4,
      taskBlockHash,
      taskId,
    },
    evidenceSha256s: {
      ciProofPacket: sha64("3"),
      laneGateReport: sha64("4"),
      laneResult: sha64("2"),
    },
    finalGate: {
      schemaVersion: "maestro-brain-lane-gate/v1",
      taskId,
      stage: "final",
      status: "passed",
      headSha: sourceHeadSha,
      currentHeadSha: sourceHeadSha,
      currentTreeSha: sourceTreeSha,
      planSha256: sha64("a"),
      taskBlockHash,
    },
    history: sourceCommits.map((commit) => ({
      commit,
      files: ["packages/example/owned.ts"],
      parentCount: 1,
      sourceLines: 100,
    })),
    integratedTaskIds: ["S01-T02", "S11-T01"],
    lane: {
      schemaVersion: "maestro-brain-lane-result/v1",
      taskId,
      status: "lane_green",
      headSha: sourceHeadSha,
      treeSha: sourceTreeSha,
    },
    ownerDisposition: "absent",
    proof: {
      schemaVersion: "maestro-brain-ci-proof/v1",
      planSha256: sha64("a"),
      taskBlockHash,
      taskId,
      baseSha: sourceBaseSha,
      headSha: sourceHeadSha,
      changedFiles: ["packages/example/owned.ts"],
      focusedCommands: ["rtk pnpm test owned"],
      testsAdded: ["packages/example/owned.test.ts"],
      reviewVerdict: "pass",
      reviewFindings: [],
      reviewHeadSha: sourceHeadSha,
    },
    sourceCommitPatchSha256s: [sha64("5"), sha64("6")],
    sourceRunId: "01KY0129952Y9Q549YA9FQH56B",
    sourceRunProvenance: {
      baseSha: sourceBaseSha,
      ciProofPacketSha256: sha64("3"),
      evidenceDirectory: "/state/evidence/lane-results/S11-T02",
      laneGateReportSha256: sha64("4"),
      laneHeadSha: sourceHeadSha,
      laneResultSha256: sha64("2"),
      laneTreeSha: sourceTreeSha,
      mode: "resume-review",
      planSha256: sha64("a"),
      runId: "01KY0129952Y9Q549YA9FQH56B",
      status: "succeeded",
      taskBlockHash,
      taskId,
    },
    sourceTreeSha,
    transition: {
      schemaVersion: "maestro-brain-plan-only-lane-authority/v1",
      fromPlanSha256: sha64("a"),
      taskBlockHash,
      sourceRunId: "01KY0129952Y9Q549YA9FQH56B",
      sourceBaseSha,
      sourceHeadSha,
      sourceTreeSha,
      sourceCommits,
      sourceCommitPatchSha256s: [sha64("5"), sha64("6")],
      laneResultSha256: sha64("2"),
      ciProofPacketSha256: sha64("3"),
      laneGateReportSha256: sha64("4"),
      requiredIntegratedTaskIds: ["S01-T02", "S11-T01"],
    },
  };
};

describe("plan-only lane authority admission", () => {
  it("admits an exact final-pass lane with unchanged task semantics", () => {
    expect(admitPlanOnlyLaneAuthority(input())).toEqual(
      expect.objectContaining({
        mode: "plan-only-lane-authority",
        taskId: "S11-T02",
        fromPlanSha256: sha64("a"),
        currentPlanSha256: sha64("f"),
        taskBlockHash: sha64("b"),
      }),
    );
  });

  it.each([
    [
      "same plan",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.currentTask.planSha256 = value.transition.fromPlanSha256;
      },
    ],
    [
      "changed task",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.currentTask.taskBlockHash = sha64("9");
      },
    ],
    [
      "findings",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.proof.reviewFindings = [{ id: "finding" }];
      },
    ],
    [
      "stale tree",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.lane.treeSha = sha40("9");
      },
    ],
    [
      "evidence bytes",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.evidenceSha256s.laneResult = sha64("9");
      },
    ],
    [
      "reordered history",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.history.reverse();
      },
    ],
    [
      "patch drift",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.sourceCommitPatchSha256s[0] = sha64("9");
      },
    ],
    [
      "unrelated source run",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.sourceRunId = "01KZZZZZZZZZZZZZZZZZZZZZZZ";
      },
    ],
    [
      "source run base",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.sourceRunProvenance.baseSha = sha40("9");
      },
    ],
    [
      "source run lane identity",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.sourceRunProvenance.laneHeadSha = sha40("9");
      },
    ],
    [
      "source run proof identity",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.sourceRunProvenance.ciProofPacketSha256 = sha64("9");
      },
    ],
    [
      "out of locks",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        const first = value.history[0];
        if (!first) throw new Error("history fixture is empty");
        first.files = ["packages/example/foreign.ts"];
      },
    ],
    [
      "merge commit",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        const first = value.history[0];
        if (!first) throw new Error("history fixture is empty");
        first.parentCount = 2;
      },
    ],
    [
      "slice overflow",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        const first = value.history[0];
        if (!first) throw new Error("history fixture is empty");
        first.sourceLines = 301;
      },
    ],
    [
      "live owner",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.ownerDisposition = "live";
      },
    ],
    [
      "missing prerequisite",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.integratedTaskIds = ["S01-T02"];
      },
    ],
    [
      "extra transition prerequisite",
      (value: DeepMutable<PlanOnlyLaneAuthorityInput>) => {
        value.transition.requiredIntegratedTaskIds = [
          ...value.transition.requiredIntegratedTaskIds,
          "S02-T02",
        ];
      },
    ],
  ])("rejects %s", (_label, mutate) => {
    const value = input();
    mutate(value);
    expect(() => admitPlanOnlyLaneAuthority(value)).toThrow();
  });
});
