import {
  defineWorkflow,
  getStatus,
  start,
  type WorkflowComponent,
  type WorkflowCtx,
  type WorkflowId,
} from "@convex-dev/workflow";
import type {
  FunctionReference,
  GenericDataModel,
  GenericMutationCtx,
} from "convex/server";
import { v } from "convex/values";

declare const component: WorkflowComponent;
declare const mutationCtx: GenericMutationCtx<GenericDataModel>;
declare const workflowRef: FunctionReference<
  "mutation",
  "internal",
  { args: { readonly id: string } },
  WorkflowId
>;

export const proofWorkflow = defineWorkflow(component, {
  args: { id: v.string() },
  returns: v.object({ id: v.string() }),
}).handler(async (step: WorkflowCtx, args) => {
  await step.sleep(1, { name: "proofDelay" });
  await step.awaitEvent({ name: `proof.${args.id}.approved` });
  return { id: args.id };
});

void start(mutationCtx, workflowRef, { id: "proof" });
void getStatus(mutationCtx, component, "workflow_proof" as WorkflowId);
