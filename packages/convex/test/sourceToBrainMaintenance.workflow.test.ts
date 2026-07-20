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

  it("runs the generated source-to-output graph", async () => {
    const step: RunDurableGraphStep = {
      runQuery: async () => {
        throw new Error(
          "Generated source/output graph should not run queries.",
        );
      },
      runMutation: async () => {
        throw new Error(
          "Generated source/output graph should not run mutations.",
        );
      },
      runAction: async () => {
        throw new Error(
          "Generated source/output graph should not run actions.",
        );
      },
      sleep: async () => {},
      awaitEvent: async () => {
        throw new Error(
          "Generated source/output graph should not await events.",
        );
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
      capabilityRegistry: {},
    });

    expect(result).toEqual({
      inputs,
      context: {
        start: inputs,
      },
      policySnapshot,
    });
  });
});
