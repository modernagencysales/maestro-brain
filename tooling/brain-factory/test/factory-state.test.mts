import { describe, expect, it } from "vitest";
import {
  completedTaskIdsForControlHead,
  integrationIdForWave,
  nextIntegrationId,
  type LaneCompletionResult,
} from "../src/factory-state.js";

describe("brain factory control state", () => {
  it("counts integrated evidence only when its head is on control HEAD", () => {
    const results = new Map<string, LaneCompletionResult>([
      [
        "S00-T02",
        {
          status: "integrated",
          integrationHeadSha: "integration-head",
        },
      ],
      [
        "S02-T01",
        {
          status: "accepted",
          integrationHeadSha: "accepted-head",
        },
      ],
      ["S01-T01", { status: "lane_green" }],
    ]);

    expect(
      completedTaskIdsForControlHead({
        controlHead: "control-head",
        isAncestor: (ancestor, descendant) =>
          ["integration-head", "accepted-head"].includes(ancestor) &&
          descendant === "control-head",
        resultFor: (taskId) => results.get(taskId),
        taskIds: ["S00-T02", "S01-T01", "S02-T01"],
      }),
    ).toEqual(new Set(["S00-T02", "S02-T01"]));
  });

  it("rejects completed evidence without an integration head", () => {
    expect(() =>
      completedTaskIdsForControlHead({
        controlHead: "control-head",
        isAncestor: () => true,
        resultFor: () => ({ status: "accepted" }),
        taskIds: ["S01-T01"],
      }),
    ).toThrow(
      "S01-T01: accepted evidence has no integrationHeadSha; refusing to launch dependents",
    );
  });

  it("rejects completed evidence not merged into control HEAD", () => {
    expect(() =>
      completedTaskIdsForControlHead({
        controlHead: "control-head",
        isAncestor: () => false,
        resultFor: () => ({
          status: "integrated",
          integrationHeadSha: "unmerged-head",
        }),
        taskIds: ["S08-T01"],
      }),
    ).toThrow(
      "S08-T01: integration head unmerged-head is not an ancestor of control HEAD control-head; merge the integration before dispatch",
    );
  });

  it("uses the manifest tranche for wave one and versions later waves", () => {
    expect(integrationIdForWave("D2-domain-bodies", 1)).toBe(
      "D2-domain-bodies",
    );
    expect(integrationIdForWave("D2-domain-bodies", 2)).toBe(
      "D2-domain-bodies-w2",
    );
  });

  it("selects the first wave when no integration state exists", () => {
    expect(
      nextIntegrationId({
        controlHead: "control-head",
        isAncestor: () => true,
        manifestTranche: "F0-foundation",
        stateFor: () => ({ existingArtifacts: [] }),
      }),
    ).toBe("F0-foundation");
  });

  it("advances deterministically through passed merged waves", () => {
    expect(
      nextIntegrationId({
        controlHead: "control-head",
        isAncestor: (ancestor) =>
          new Set(["wave-one-head", "wave-two-head"]).has(ancestor),
        manifestTranche: "C1-contract-spine",
        stateFor: (integrationId) =>
          integrationId === "C1-contract-spine"
            ? {
                existingArtifacts: ["wave one evidence"],
                headSha: "wave-one-head",
                status: "passed",
              }
            : integrationId === "C1-contract-spine-w2"
              ? {
                  existingArtifacts: ["wave two evidence"],
                  headSha: "wave-two-head",
                  status: "passed",
                }
              : { existingArtifacts: [] },
      }),
    ).toBe("C1-contract-spine-w3");
  });

  it("rejects an active or otherwise unresolved latest wave", () => {
    expect(() =>
      nextIntegrationId({
        controlHead: "control-head",
        isAncestor: () => true,
        manifestTranche: "C1-contract-spine",
        stateFor: () => ({
          existingArtifacts: ["run record", "worktree"],
          status: "ready_for_review",
        }),
      }),
    ).toThrow(
      "C1-contract-spine: latest integration attempt is unresolved (status ready_for_review); existing state: run record, worktree",
    );
  });

  it("rejects a passed wave without a recorded head", () => {
    expect(() =>
      nextIntegrationId({
        controlHead: "control-head",
        isAncestor: () => true,
        manifestTranche: "C1-contract-spine",
        stateFor: () => ({
          existingArtifacts: ["evidence"],
          status: "passed",
        }),
      }),
    ).toThrow("C1-contract-spine: passed integration evidence has no headSha");
  });

  it("rejects a passed wave that is not merged into control HEAD", () => {
    expect(() =>
      nextIntegrationId({
        controlHead: "control-head",
        isAncestor: () => false,
        manifestTranche: "F0-foundation",
        stateFor: () => ({
          existingArtifacts: ["evidence"],
          headSha: "unmerged-head",
          status: "passed",
        }),
      }),
    ).toThrow(
      "F0-foundation: passed integration head unmerged-head is not an ancestor of control HEAD control-head; merge it before starting another wave",
    );
  });
});
