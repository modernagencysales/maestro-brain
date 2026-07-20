import { describe, expect, it } from "vitest";
import { manifest } from "../confect/workflowContracts/sourceToBrainMaintenance.spec";
import { sourceToBrainMaintenanceGraph } from "../confect/workflows/sourceToBrainMaintenance.graph";
import {
  runDurableGraphWorkflow,
  type RunDurableGraphStep,
} from "../confect/workflows/_kit/graphRunner";

describe("sourceToBrainMaintenance durable workflow scaffold", () => {
  it("keeps generated workflow controls internal-only", () => {
    expect(manifest.map((entry) => entry.operationId)).toEqual([
      "workflows.sourceToBrainMaintenance.start",
      "workflows.sourceToBrainMaintenance.status",
      "workflows.sourceToBrainMaintenance.approve",
    ]);
    expect(manifest.every((entry) => entry.surfaces.length === 0)).toBe(true);
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
          buildArgs: ({ inputs }) => ({ inputs }),
        },
      },
    });

    expect(calls).toEqual([{ inputs }]);
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
