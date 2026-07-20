import { defineWorkflow } from "@convex-dev/workflow";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import {
  runDurableGraphWorkflow,
  type DurableGraphCapabilityEntry,
  type RunDurableGraphStep,
} from "../../confect/workflows/_kit/graphRunner";
import { sourceClassificationGraph } from "../../confect/workflows/sourceClassification.graph";

type InternalMutationRef = FunctionReference<
  "mutation",
  "internal",
  Record<string, unknown>,
  unknown
>;
const mutationRef = (path: string) =>
  makeFunctionReference(path) as unknown as InternalMutationRef;
const caller = {
  kind: "system" as const,
  name: "sourceClassification",
  surface: "workflow" as const,
};

const capabilityRegistry = {
  "classification.model": {
    kind: "mutation",
    ref: mutationRef("capabilities/classifySourceUnit:classifySourceUnit"),
    buildArgs: ({ inputs }) => ({
      request: (inputs as { request: unknown }).request,
      caller,
    }),
  },
  "routes.commit": {
    kind: "mutation",
    ref: mutationRef("capabilities/commitSourceRoute:commitSourceRoute"),
    buildArgs: ({ inputs, context }) => ({
      workspaceId: (inputs as { workspaceId: string }).workspaceId,
      idempotencyKey: (inputs as { idempotencyKey: string }).idempotencyKey,
      proposal: context.classify,
      review: context.review,
      caller,
    }),
  },
} satisfies Readonly<Record<string, DurableGraphCapabilityEntry>>;

const message = v.object({
  sourceRevisionKey: v.string(),
  authorLabel: v.string(),
  providerTimestamp: v.string(),
  canonicalText: v.string(),
});
const target = v.object({
  brainKey: v.string(),
  displayName: v.string(),
  routingDescription: v.optional(v.string()),
});

export const run = defineWorkflow(components.workflow, {
  args: {
    workspaceId: v.string(),
    idempotencyKey: v.string(),
    request: v.object({
      sourceUnitRevisionKey: v.string(),
      sourceUnitHash: v.string(),
      messages: v.array(message),
      policyVersion: v.number(),
      allowedTargets: v.array(target),
    }),
  },
  returns: v.any(),
}).handler((step, args) =>
  runDurableGraphWorkflow(step as RunDurableGraphStep, {
    graph: sourceClassificationGraph,
    inputs: args,
    policySnapshot: { policyVersion: args.request.policyVersion },
    capabilityRegistry,
    projectOutput: ({ context }) => ({ result: context.commit }),
  }),
);
