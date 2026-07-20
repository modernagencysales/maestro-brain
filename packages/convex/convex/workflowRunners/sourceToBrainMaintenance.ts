import { defineWorkflow } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components } from "../_generated/api";
import {
  runDurableGraphWorkflow,
  type RunDurableGraphStep,
} from "../../confect/workflows/_kit/graphRunner";
import { sourceToBrainMaintenanceGraph } from "../../confect/workflows/sourceToBrainMaintenance.graph";

import type { DurableGraphCapabilityEntry } from "../../confect/workflows/_kit/graphRunner";

type InternalWorkflowCapabilityRegistry = Readonly<
  Record<string, DurableGraphCapabilityEntry>
>;

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
    capabilityRegistry: {} satisfies InternalWorkflowCapabilityRegistry,
  }),
);
