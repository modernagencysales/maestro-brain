import { defineWorkflow } from "@convex-dev/workflow";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { components } from "../_generated/api";
import {
  runDurableGraphWorkflow,
  type DurableGraphCapabilityEntry,
  type RunDurableGraphStep,
} from "../../confect/workflows/_kit/graphRunner";
import {
  buildGatherMaintenanceContextArgs,
  buildMaintainBrainPageArgs,
  buildMineCallTranscriptArgs,
  sourceToBrainMaintenanceGraph,
} from "../../confect/workflows/sourceToBrainMaintenance.graph";

const ref = <Kind extends "query" | "mutation" | "action">(path: string) =>
  makeFunctionReference(
    path,
  ) as unknown as DurableGraphCapabilityEntry<Kind>["ref"];

const capabilityRegistry = {
  "capabilities.gatherMaintenanceContext": {
    kind: "query",
    ref: ref<"query">(
      "capabilities/gatherMaintenanceContext:gatherMaintenanceContext",
    ),
    buildArgs: buildGatherMaintenanceContextArgs,
  },
  "capabilities.mineCallTranscript": {
    kind: "action",
    ref: ref<"action">("capabilities/mineCallTranscript:mineCallTranscript"),
    buildArgs: buildMineCallTranscriptArgs,
  },
  "capabilities.maintainBrainPage": {
    kind: "mutation",
    ref: ref<"mutation">("capabilities/maintainBrainPage:maintainBrainPage"),
    buildArgs: buildMaintainBrainPageArgs,
  },
} satisfies Readonly<Record<string, DurableGraphCapabilityEntry>>;

export const run = defineWorkflow(components.workflow, {
  args: {
    workspaceId: v.string(),
    idempotencyKey: v.string(),
    unitRevisionKey: v.string(),
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
