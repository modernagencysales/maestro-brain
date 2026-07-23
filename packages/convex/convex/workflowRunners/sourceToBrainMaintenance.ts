import { defineWorkflow } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { runDurableGraphWorkflow } from "../../confect/workflows/_kit/graphRunner";
import {
  buildMaintainBrainPageArgs,
  sourceToBrainMaintenanceGraph,
} from "../../confect/workflows/sourceToBrainMaintenance.graph";

type MaintainBrainPageArgs = ReturnType<typeof buildMaintainBrainPageArgs>;
type MaintainBrainPageReturns = {
  readonly proposalKey: string;
  readonly status: string;
  readonly citationKeys: readonly string[];
  readonly revisionEffect: unknown;
};
const maintainBrainPageRef = makeFunctionReference<
  "mutation",
  MaintainBrainPageArgs,
  MaintainBrainPageReturns
>(
  "capabilities/maintainBrainPage:maintainBrainPage",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  MaintainBrainPageArgs,
  MaintainBrainPageReturns
>;

export const run = defineWorkflow(components.workflow, {
  args: {
    workspaceId: v.string(),
    idempotencyKey: v.string(),
  },
  returns: v.any(),
}).handler(
  async (step, args) =>
    await runDurableGraphWorkflow(step, {
      graph: sourceToBrainMaintenanceGraph,
      inputs: args,
      policySnapshot: { mode: "internal", idempotencyKey: args.idempotencyKey },
      capabilityRegistry: {
        "capabilities.maintainBrainPage": {
          kind: "mutation",
          ref: maintainBrainPageRef,
          buildArgs: buildMaintainBrainPageArgs,
        },
      },
    }),
);
