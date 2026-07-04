import type { FunctionReference } from "convex/server";

import { type DurableWorkflowGraph, type WorkflowNode } from "../graph";
import {
  readStartNode,
  runGraphExecution,
  validateGraphOrThrow,
} from "./graphRunnerExecution";
import { preflightCapabilityRegistry } from "./graphRunnerNodes";
import { type ObservedWorkflowStageRefs } from "./observedStage";

export type DurableGraphStepKind = "query" | "mutation" | "action";

export type DurableGraphStepRef<
  Kind extends DurableGraphStepKind = DurableGraphStepKind,
> = FunctionReference<Kind, "internal">;

export type DurableGraphCapabilityEnvelope = {
  readonly inputs: unknown;
  readonly context: Readonly<Record<string, unknown>>;
  readonly node: WorkflowNode;
  readonly policySnapshot: unknown;
};

export type DurableGraphCapabilityEntry<
  Kind extends DurableGraphStepKind = DurableGraphStepKind,
> = {
  readonly kind: Kind;
  readonly ref: DurableGraphStepRef<Kind>;
  readonly agentSeat?: true;
  readonly buildArgs?: (
    envelope: DurableGraphCapabilityEnvelope,
  ) => Record<string, unknown>;
};

export type RunDurableGraphInput = {
  readonly graph: DurableWorkflowGraph;
  readonly inputs: unknown;
  readonly policySnapshot: unknown;
  readonly capabilityRegistry: Readonly<
    Record<string, DurableGraphCapabilityEntry>
  >;
  readonly projectOutput?: (
    envelope: DurableGraphCapabilityEnvelope,
  ) => Record<string, unknown>;
  readonly observability?: ObservedWorkflowStageRefs & {
    readonly workflowRunId?: string;
    readonly componentWorkflowId?: string;
  };
};

export type RunDurableGraphStep = {
  readonly runQuery: (
    ref: DurableGraphStepRef<"query">,
    args: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly runMutation: (
    ref: DurableGraphStepRef<"mutation">,
    args: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly runAction: (
    ref: DurableGraphStepRef<"action">,
    args: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly sleep: (
    delayMs: number,
    options?: { readonly name?: string },
  ) => Promise<void>;
  readonly awaitEvent: <Result = unknown>(event: {
    readonly name: string;
  }) => Promise<Result>;
};

export const runDurableGraphWorkflow = async (
  step: RunDurableGraphStep,
  input: RunDurableGraphInput,
): Promise<Readonly<Record<string, unknown>>> => {
  validateGraphOrThrow(input.graph);
  const startNode = readStartNode(input.graph);
  preflightCapabilityRegistry(input.graph, input.capabilityRegistry);
  return runGraphExecution(step, input, startNode);
};
