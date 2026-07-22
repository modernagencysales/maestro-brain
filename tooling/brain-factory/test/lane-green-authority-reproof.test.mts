import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  admitLaneGreenAuthorityReproof,
  type LaneGreenAuthorityReproofInput,
} from "../src/lane-green-authority-reproof.js";
import { taskBlockHashFromPlan } from "../src/manifest.js";

const sha = (value: string, length = 40): string => value.repeat(length);
const taskId = "S05-T01";
const sourceBaseSha = sha("1");
const sourceHeadSha = sha("2");
const sourceTreeSha = sha("3");
const oldPlanSha256 = sha("4", 64);
const oldTaskBlockHash = sha("5", 64);
const currentPlanSha256 = sha("6", 64);
const currentTaskBlockHash = sha("7", 64);
const ownedFile = "packages/convex/confect/tables/sourceLedger.ts";

const validInput = (): LaneGreenAuthorityReproofInput => ({
  controlHeadSha: sha("8"),
  currentTask: {
    authorityAuthorized: true,
    codeStartAfter: ["S04-T02"],
    fileLocks: [ownedFile],
    planSha256: currentPlanSha256,
    sourceSliceBudget: 300,
    sourceSliceLimit: 4,
    taskBlockHash: currentTaskBlockHash,
    taskId,
  },
  finalGate: {
    schemaVersion: "maestro-brain-lane-gate/v1",
    taskId,
    stage: "final",
    status: "passed",
    headSha: sourceHeadSha,
    currentHeadSha: sourceHeadSha,
    currentTreeSha: sourceTreeSha,
    planSha256: oldPlanSha256,
    taskBlockHash: oldTaskBlockHash,
  },
  history: [
    {
      commit: sourceHeadSha,
      files: [ownedFile],
      parentCount: 1,
      sourceLines: 20,
    },
  ],
  integratedTaskIds: ["S04-T02"],
  lane: {
    schemaVersion: "maestro-brain-lane-result/v1",
    taskId,
    status: "lane_green",
    headSha: sourceHeadSha,
    treeSha: sourceTreeSha,
  },
  oldPlanSha256,
  oldTaskBlockHash,
  proof: {
    schemaVersion: "maestro-brain-ci-proof/v1",
    taskId,
    planSha256: oldPlanSha256,
    taskBlockHash: oldTaskBlockHash,
    baseSha: sourceBaseSha,
    headSha: sourceHeadSha,
    changedFiles: [ownedFile],
    reviewVerdict: "pass",
    reviewHeadSha: sourceHeadSha,
    reviewFindings: [],
  },
  sourceChangedFiles: [ownedFile],
  sourceTreeSha,
});

const validHistory = (): LaneGreenAuthorityReproofInput["history"][number] => {
  const history = validInput().history[0];
  if (!history) throw new Error("test history fixture is missing");
  return history;
};

describe("lane-green authority reproof admission", () => {
  it("derives the old task hash independently from its historical plan", () => {
    const body = "### S05-T01 — Source ledger\n\n- **Files:** `owned.ts`\n\n";
    const plan = `${body}## Appendix A\n`;
    expect(taskBlockHashFromPlan(plan, taskId)).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
    expect(() => taskBlockHashFromPlan(plan, "S05-T02")).toThrow(
      "S05-T02: historical task block is missing",
    );
  });

  it("admits the exact owned green lane under changed current authority", () => {
    expect(admitLaneGreenAuthorityReproof(validInput())).toEqual({
      mode: "lane-green-authority-reproof",
      oldPlanSha256,
      oldTaskBlockHash,
      sourceBaseSha,
      sourceCommits: [sourceHeadSha],
      sourceHeadSha,
      sourceTreeSha,
    });
  });

  it("admits plan-only drift when the independently proven task block is unchanged", () => {
    const input = validInput();
    expect(
      admitLaneGreenAuthorityReproof({
        ...input,
        currentTask: {
          ...input.currentTask,
          taskBlockHash: oldTaskBlockHash,
        },
      }).oldTaskBlockHash,
    ).toBe(oldTaskBlockHash);
  });

  it("limits the exceptional authority path to S05-T01", () => {
    const input = validInput();
    expect(() =>
      admitLaneGreenAuthorityReproof({
        ...input,
        currentTask: { ...input.currentTask, taskId: "S05-T02" },
      }),
    ).toThrow("authority reproof is authorized only for S05-T01");
  });

  it("rejects stale lane head or tree bindings", () => {
    expect(() =>
      admitLaneGreenAuthorityReproof({
        ...validInput(),
        sourceTreeSha: sha("9"),
      }),
    ).toThrow("lane result treeSha does not match current tree");
    expect(() =>
      admitLaneGreenAuthorityReproof({
        ...validInput(),
        lane: { ...validInput().lane, headSha: sha("9") },
      }),
    ).toThrow("final proof head does not match");
  });

  it("rejects an old proof not bound to the historical task block", () => {
    expect(() =>
      admitLaneGreenAuthorityReproof({
        ...validInput(),
        oldTaskBlockHash: sha("9", 64),
      }),
    ).toThrow("historical task block hash mismatch");
  });

  it("rejects changed paths outside current locks", () => {
    const unowned = "packages/convex/confect/tables/unowned.ts";
    expect(() =>
      admitLaneGreenAuthorityReproof({
        ...validInput(),
        history: [
          {
            ...validHistory(),
            files: [ownedFile, unowned],
          },
        ],
        proof: {
          ...validInput().proof,
          changedFiles: [ownedFile, unowned],
        },
        sourceChangedFiles: [ownedFile, unowned],
      }),
    ).toThrow("not declared in current manifest fileLocks");
  });

  it("rejects nonlinear or drifted commit chains", () => {
    expect(() =>
      admitLaneGreenAuthorityReproof({
        ...validInput(),
        history: [{ ...validHistory(), parentCount: 2 }],
      }),
    ).toThrow("task slice commits must be linear");
    expect(() =>
      admitLaneGreenAuthorityReproof({
        ...validInput(),
        history: [{ ...validHistory(), commit: sha("9") }],
      }),
    ).toThrow("source history does not end at lane HEAD");
  });

  it("rejects an unsatisfied current dependency", () => {
    expect(() =>
      admitLaneGreenAuthorityReproof({
        ...validInput(),
        integratedTaskIds: [],
      }),
    ).toThrow("current prerequisite is not integrated: S04-T02");
  });

  it("rejects live and unknown owners", () => {
    for (const ownerDisposition of ["live", "unknown"] as const) {
      expect(() =>
        admitLaneGreenAuthorityReproof({
          ...validInput(),
          ownerDisposition,
        }),
      ).toThrow(`current task owner is ${ownerDisposition}`);
    }
  });
});
