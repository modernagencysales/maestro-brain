import { describe, expect, it } from "vitest";
import sourceToBrainMaintenanceSpec from "../confect/workflowContracts/sourceToBrainMaintenance.spec";
import { sourceToBrainMaintenanceGraph } from "../confect/workflows/sourceToBrainMaintenance.graph";
import {
  runDurableGraphWorkflow,
  type RunDurableGraphStep,
} from "../confect/workflows/_kit/graphRunner";

describe("sourceToBrainMaintenance durable workflow scaffold", () => {
  it("registers the workflow runner as a plain Convex internal mutation", () => {
    const runSpec = sourceToBrainMaintenanceSpec.functions.run;

    expect(runSpec).toBeDefined();
    expect(runSpec).toMatchObject({
      functionVisibility: "internal",
      name: "run",
      runtimeAndFunctionType: {
        functionType: "mutation",
        runtime: "Convex",
      },
    });
    expect(runSpec?.functionProvenance._tag).toBe("Convex");
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
