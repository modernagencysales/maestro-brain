import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  manifest,
  workflowTypedErrors,
} from "../confect/workflowContracts/sourceToBrainMaintenance.spec";
import {
  buildMaintainBrainPageArgs,
  sourceToBrainMaintenanceGraph,
} from "../confect/workflows/sourceToBrainMaintenance.graph";
import {
  runDurableGraphWorkflow,
  type RunDurableGraphStep,
} from "../confect/workflows/_kit/graphRunner";

describe("sourceToBrainMaintenance durable workflow scaffold", () => {
  it("keeps generated workflow controls internal-only", () => {
    expect(manifest.map((entry) => entry.operationId)).toEqual([
      "workflows.sourceToBrainMaintenance.start",
      "workflows.sourceToBrainMaintenance.status",
    ]);
    expect(manifest.every((entry) => entry.surfaces.length === 0)).toBe(true);
  });

  it("declares maintenance policy failures at the workflow contract boundary", () => {
    expect(workflowTypedErrors).toEqual(
      expect.arrayContaining([
        "CitationRequired",
        "CitationNotInManifest",
        "RevisionBudgetExceeded",
        "AutopilotNotEligible",
        "StaleRevision",
        "LifecycleRevoked",
      ]),
    );
  });

  it("keeps the generated durable runner path used by workflow start", async () => {
    await expect(
      access(
        new URL(
          "../convex/workflowRunners/sourceToBrainMaintenance.ts",
          import.meta.url,
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("runs routed evidence through the maintenance capability", async () => {
    const calls: Record<string, unknown>[] = [];
    const step: RunDurableGraphStep = {
      runQuery: async () => {
        throw new Error("Maintenance graph should not run queries.");
      },
      runMutation: async (_ref, args) => {
        calls.push(args);
        return {
          proposalKey: "proposal_1",
          status: "awaiting_review",
          citationKeys: ["cite_1"],
          revisionEffect: null,
        };
      },
      runAction: async () => {
        throw new Error("Maintenance graph should not run actions.");
      },
      sleep: async () => {},
      awaitEvent: async () => {
        throw new Error("Maintenance graph should not await events.");
      },
    };

    const inputs = {
      workspaceId: "workspace_123",
      idempotencyKey: "workflow-test-1",
    };
    const policySnapshot = { mode: "test" };

    const result = await runDurableGraphWorkflow(step, {
      graph: sourceToBrainMaintenanceGraph,
      inputs,
      policySnapshot,
      capabilityRegistry: {
        "capabilities.maintainBrainPage": {
          kind: "mutation",
          ref: {} as never,
          buildArgs: buildMaintainBrainPageArgs,
        },
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        workspaceSlug: "workspace_123",
        contextPackId: "workflow-test-1",
        context: expect.objectContaining({ workspaceId: "workspace_123" }),
        modelOutput: expect.objectContaining({
          kind: "revision",
          citationKeys: ["cite_1"],
        }),
      }),
    ]);
    expect(result).toEqual({
      inputs,
      context: {
        start: inputs,
        maintainBrainPage: {
          proposalKey: "proposal_1",
          status: "awaiting_review",
          citationKeys: ["cite_1"],
          revisionEffect: null,
        },
      },
      policySnapshot,
    });
  });
});
