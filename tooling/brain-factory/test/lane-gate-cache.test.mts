import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { GateCommand } from "../src/gates.js";
import {
  canReusePreReviewGate,
  deduplicateGateCommands,
  gateCommandSetHash,
} from "../src/lane-gate-cache.js";

const typecheck = {
  program: "pnpm",
  args: ["--dir", "packages/convex", "typecheck"],
} satisfies GateCommand;
const focusedTest = {
  program: "host-test-slot",
  args: ["--class", "focused", "pnpm", "--dir", "packages/convex", "test"],
} satisfies GateCommand;

describe("brain lane gate command cache", () => {
  it("deduplicates focused and profile commands globally in first-seen order", () => {
    expect(
      deduplicateGateCommands([
        typecheck,
        focusedTest,
        { ...typecheck, args: [...typecheck.args] },
        { ...focusedTest, args: [...focusedTest.args] },
      ]),
    ).toEqual([typecheck, focusedTest]);
  });

  it("hashes the normalized ordered command set", () => {
    const original = gateCommandSetHash([typecheck, focusedTest]);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    expect(gateCommandSetHash([typecheck, focusedTest])).toBe(original);
    expect(gateCommandSetHash([focusedTest, typecheck])).not.toBe(original);
  });

  it("reuses only a passing pre-review report for the exact head, tree, and commands", () => {
    const identity = {
      commandSetHash: "commands",
      currentHeadSha: "head",
      currentTreeSha: "tree",
      planSha256: "plan",
      reviewVerdict: "pass" as const,
      taskBlockHash: "task",
    };
    const report = {
      schemaVersion: "maestro-brain-lane-gate/v1",
      commandSetHash: "commands",
      currentHeadSha: "head",
      currentTreeSha: "tree",
      planSha256: "plan",
      stage: "pre-review",
      status: "passed",
      taskBlockHash: "task",
    };
    expect(canReusePreReviewGate(report, identity)).toBe(true);
    expect(
      canReusePreReviewGate(report, {
        ...identity,
        currentHeadSha: "new-head",
      }),
    ).toBe(false);
    expect(
      canReusePreReviewGate(report, {
        ...identity,
        currentTreeSha: "new-tree",
      }),
    ).toBe(false);
    expect(
      canReusePreReviewGate(report, {
        ...identity,
        commandSetHash: "new-commands",
      }),
    ).toBe(false);
    expect(
      canReusePreReviewGate(report, {
        ...identity,
        planSha256: "new-plan",
      }),
    ).toBe(false);
    expect(
      canReusePreReviewGate(report, {
        ...identity,
        taskBlockHash: "new-task",
      }),
    ).toBe(false);
    expect(
      canReusePreReviewGate(report, {
        ...identity,
        reviewVerdict: "rework",
      }),
    ).toBe(false);
    expect(canReusePreReviewGate({ ...report, stage: "final" }, identity)).toBe(
      false,
    );
    expect(
      canReusePreReviewGate({ ...report, status: "failed" }, identity),
    ).toBe(false);
  });

  it("enables reuse only on the build workflow final gate", () => {
    const workflow = readFileSync(
      new URL(
        "../../../.fabro/workflows/brain-build-task/workflow.fabro",
        import.meta.url,
      ),
      "utf8",
    );
    const preReview = workflow
      .split("\n")
      .find((line) => line.trimStart().startsWith("gates ["));
    const final = workflow
      .split("\n")
      .find((line) => line.trimStart().startsWith("final_gates ["));
    expect(preReview).not.toContain("--reuse-pre-review");
    expect(final).toContain("--stage final --reuse-pre-review");
    const review = workflow
      .split("\n")
      .find((line) => line.trimStart().startsWith("review ["));
    const implement = workflow
      .split("\n")
      .find((line) => line.trimStart().startsWith("implement ["));
    expect(implement).toContain("maestro-brain-ci-proof/v1");
    expect(implement).toContain("planSha256");
    expect(implement).toContain("taskBlockHash");
    expect(implement).toContain("Do not use native apply_patch");
    expect(implement).not.toContain("apply_patch fails once");
    expect(review).toContain("Read-Only Contract Review");
    expect(review).toContain("exact current planSha256/taskBlockHash");
    expect(review).toContain(
      "Never edit, amend, or commit product/worktree files",
    );
    expect(review).not.toContain("Fix narrow defects directly");
  });
});
