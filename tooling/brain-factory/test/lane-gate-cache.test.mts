import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { GateCommand } from "../src/gates.js";
import {
  canReusePreReviewGate,
  deduplicateGateCommands,
  gateCommandSetHash,
  reviewCycleMarker,
  reviewVerdictMatchesGateStage,
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
  it("reserves PASS for the independent final-review stage", () => {
    expect(reviewVerdictMatchesGateStage("pre-review", "pending")).toBe(true);
    expect(reviewVerdictMatchesGateStage("pre-review", "pass")).toBe(false);
    expect(reviewVerdictMatchesGateStage("pre-review", "rework")).toBe(false);
    expect(reviewVerdictMatchesGateStage("final", "pass")).toBe(true);
    expect(reviewVerdictMatchesGateStage("final", "pending")).toBe(false);
    expect(reviewVerdictMatchesGateStage("final", "rework")).toBe(false);
  });

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

  it("binds Fabro cycle detection to canonical independent-review state", () => {
    const proof = {
      headSha: "head-a",
      reviewFindings: [{ id: "REVIEW-002" }, { id: "REVIEW-001" }],
      reviewVerdict: "rework",
    };
    const marker = reviewCycleMarker(proof);

    expect(marker).toMatch(
      /^brain-review-state=[a-f0-9]{64} verdict=rework head=head-a /,
    );
    expect(marker).toContain("findings=REVIEW-001%2CREVIEW-002");
    expect(
      reviewCycleMarker({
        ...proof,
        reviewFindings: [
          { id: "REVIEW-001" },
          { id: "REVIEW-002" },
          { id: "REVIEW-001" },
        ],
      }),
    ).toBe(marker);
    expect(reviewCycleMarker({ ...proof, headSha: "head-b" })).not.toBe(marker);
    expect(
      reviewCycleMarker({
        ...proof,
        reviewFindings: [{ id: "REVIEW-003" }],
      }),
    ).not.toBe(marker);
    expect(reviewCycleMarker({ ...proof, reviewVerdict: "pass" })).not.toBe(
      marker,
    );
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
    expect(final).toContain("review-cycle-marker.mts");
    expect(final?.indexOf("review-cycle-marker.mts")).toBeLessThan(
      final?.indexOf("brain:factory:lane-gates") ?? -1,
    );
    const review = workflow
      .split("\n")
      .find((line) => line.trimStart().startsWith("review ["));
    expect(review).toContain("Read-Only Contract Review");
    expect(review).toContain("max_visits=4");
    expect(review).toContain(
      "Never edit, amend, or commit product/worktree files",
    );
    expect(review).not.toContain("Fix narrow defects directly");
  });
});
