import { defineWorkflow } from "@convex-dev/workflow";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { components } from "../_generated/api";
import {
  runDurableGraphWorkflow,
  type DurableGraphCapabilityEntry,
  type RunDurableGraphStep,
} from "../../confect/workflows/_kit/graphRunner";
import {
  buildMaintainBrainPageArgs,
  sourceToBrainMaintenanceGraph,
} from "../../confect/workflows/sourceToBrainMaintenance.graph";

const mutationRef = makeFunctionReference(
  "capabilities/maintainBrainPage:maintainBrainPage",
) as unknown as DurableGraphCapabilityEntry<"mutation">["ref"];

const capabilityRegistry = {
  "capabilities.maintainBrainPage": {
    kind: "mutation",
    ref: mutationRef,
    buildArgs: buildMaintainBrainPageArgs,
  },
} satisfies Readonly<Record<string, DurableGraphCapabilityEntry>>;

export const run = defineWorkflow(components.workflow, {
  args: {
    workspaceId: v.string(),
    idempotencyKey: v.string(),
  },
  returns: v.any(),
}).handler((step, args) =>
  runDurableGraphWorkflow(step as RunDurableGraphStep, {
    graph: sourceToBrainMaintenanceGraph,
    inputs: args,
    policySnapshot: {},
    capabilityRegistry,
  }),
);
