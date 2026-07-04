import { describe, expect, it } from "vitest";

import {
  isSafeConditionExpression,
  type DurableWorkflowGraph,
} from "../confect/workflows/graph";
import {
  runDurableGraphWorkflow,
  type DurableGraphStepRef,
  type RunDurableGraphStep,
} from "../confect/workflows/_kit/graphRunner";
import { projectWorkflowStatus } from "../confect/workflows/_kit/status";

const classifyRef =
  "internal.capabilities.classify" as unknown as DurableGraphStepRef<"query">;
const enrichRef =
  "internal.capabilities.enrich" as unknown as DurableGraphStepRef<"action">;
const agentRef =
  "internal.capabilities.agent" as unknown as DurableGraphStepRef<"action">;
const stageStartedRef =
  "internal.workflows.stageStarted" as unknown as DurableGraphStepRef<"mutation">;
const stageFinishedRef =
  "internal.workflows.stageFinished" as unknown as DurableGraphStepRef<"mutation">;

const graph = {
  id: "workflow_effect_spine",
  version: 1,
  startNodeId: "source",
  nodes: [
    {
      id: "source",
      kind: "source",
      label: "Source",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "classify",
      kind: "capability",
      label: "Classify",
      capability: "classifyLead",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "wait",
      kind: "delay",
      label: "Delay",
      delayMs: 25,
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "approval",
      kind: "approval",
      label: "Approval",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "enrich",
      kind: "capability",
      label: "Enrich",
      capability: "enrichLead",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "output",
      kind: "output",
      label: "Output",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
  ],
  edges: [
    {
      id: "source_classify",
      sourceNodeId: "source",
      targetNodeId: "classify",
    },
    {
      id: "classify_wait",
      sourceNodeId: "classify",
      targetNodeId: "wait",
      condition: {
        expression:
          "context.classify.route === 'approved' && policySnapshot.mode !== 'blocked'",
      },
    },
    {
      id: "wait_approval",
      sourceNodeId: "wait",
      targetNodeId: "approval",
    },
    {
      id: "approval_enrich",
      sourceNodeId: "approval",
      targetNodeId: "enrich",
    },
    {
      id: "enrich_output",
      sourceNodeId: "enrich",
      targetNodeId: "output",
    },
  ],
  joins: [],
} satisfies DurableWorkflowGraph;

const agentGraph = {
  id: "workflow_agent_spine",
  version: 1,
  startNodeId: "source",
  nodes: [
    {
      id: "source",
      kind: "source",
      label: "Source",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "agent",
      kind: "agent",
      label: "Agent",
      agent: "draftReply",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "output",
      kind: "output",
      label: "Output",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
  ],
  edges: [
    {
      id: "source_agent",
      sourceNodeId: "source",
      targetNodeId: "agent",
    },
    {
      id: "agent_output",
      sourceNodeId: "agent",
      targetNodeId: "output",
    },
  ],
  joins: [],
} satisfies DurableWorkflowGraph;

describe("workflow status projection", () => {
  it("projects component statuses and defaults unknown blobs safely", () => {
    expect(
      projectWorkflowStatus({
        type: "completed",
        result: { ok: true },
      }),
    ).toEqual({
      status: "completed",
      componentStatus: "completed",
      result: { ok: true },
    });
    expect(
      projectWorkflowStatus({
        type: "failed",
        error: "component exploded",
      }),
    ).toEqual({
      status: "failed",
      componentStatus: "failed",
      error: "component exploded",
    });
    expect(
      projectWorkflowStatus({ type: "paused" } as never, {
        status: "running",
      }),
    ).toEqual({ status: "running" });
    expect(projectWorkflowStatus({} as never)).toEqual({ status: "queued" });
  });

  it("lets timeout rows override a still-running component status", () => {
    expect(
      projectWorkflowStatus(
        {
          type: "inProgress",
          running: [{ name: "wait" }],
        } as never,
        {
          status: "timedOut",
          deadlineAt: 100,
          timedOutAt: 125,
          timeoutErrorCode: "WORKFLOW_TIMEOUT",
          timeoutSummary: "Approval deadline elapsed.",
        },
      ),
    ).toEqual({
      status: "timedOut",
      componentStatus: "inProgress",
      running: [{ name: "wait" }],
      timeout: {
        deadlineAt: 100,
        timedOutAt: 125,
        errorCode: "WORKFLOW_TIMEOUT",
        summary: "Approval deadline elapsed.",
      },
    });
  });
});

describe("workflow condition grammar", () => {
  it("accepts only the durable safe expression subset", () => {
    const allowed = [
      "inputs.kind === 'lead'",
      "context.classify.score !== 0",
      "policySnapshot.mode === 'dryRun' || context.review.status === 'ready'",
      "!(context.review.status === 'blocked')",
      "(inputs.score === 3 && policySnapshot.version !== 1)",
    ];

    for (const expression of allowed) {
      expect(isSafeConditionExpression(expression), expression).toBe(true);
    }
  });

  it("rejects globals, calls, writes, constructors, regex, import, and loose equality", () => {
    const rejected = [
      "globalThis.process.exit()",
      "inputs.kind == 'lead'",
      "inputs.kind = 'lead'",
      "context.review.status = 'ready'",
      "context.review.status() === 'ready'",
      "context.constructor.name === 'Object'",
      "/ready/.test(context.review.status)",
      "import('node:fs')",
    ];

    for (const expression of rejected) {
      expect(isSafeConditionExpression(expression), expression).toBe(false);
    }
  });
});

describe("durable graph runner", () => {
  it("dispatches through the registry, sleeps, awaits approval, and observes stages", async () => {
    const queryCalls: unknown[] = [];
    const actionCalls: unknown[] = [];
    const mutationCalls: Array<{
      readonly ref: DurableGraphStepRef<"mutation">;
      readonly args: Record<string, unknown>;
    }> = [];
    const sleeps: Array<{
      readonly delayMs: number;
      readonly name: string | undefined;
    }> = [];
    const events: string[] = [];

    const step: RunDurableGraphStep = {
      runQuery: async (ref, args) => {
        queryCalls.push({ ref, args });
        return { route: "approved", refDispatched: ref === classifyRef };
      },
      runAction: async (ref, args) => {
        actionCalls.push({ ref, args });
        return { enriched: true, refDispatched: ref === enrichRef };
      },
      runMutation: async (ref, args) => {
        mutationCalls.push({ ref, args });
        return null;
      },
      sleep: async (delayMs, options) => {
        sleeps.push({ delayMs, name: options?.name });
      },
      awaitEvent: async <Result>(event: { readonly name: string }) => {
        events.push(event.name);
        return { approvedBy: "user_123" } as Result;
      },
    };

    const result = await runDurableGraphWorkflow(step, {
      graph,
      inputs: { kind: "lead", email: "founder@example.test" },
      policySnapshot: { mode: "review", version: 2 },
      capabilityRegistry: {
        classifyLead: {
          kind: "query",
          ref: classifyRef,
        },
        enrichLead: {
          kind: "action",
          ref: enrichRef,
        },
      },
      observability: {
        workflowRunId: "run_123",
        componentWorkflowId: "workflow_component_123",
        recordStageStarted: stageStartedRef,
        recordStageFinished: stageFinishedRef,
      },
      projectOutput: ({ context }) => ({
        classify: context.classify,
        enrich: context.enrich,
        approval: context.approval,
        delay: context.wait,
      }),
    });

    expect(result).toEqual({
      classify: { route: "approved", refDispatched: true },
      enrich: { enriched: true, refDispatched: true },
      approval: { approvedBy: "user_123" },
      delay: { delayedMs: 25 },
    });
    expect(queryCalls).toHaveLength(1);
    expect(actionCalls).toHaveLength(1);
    expect(sleeps).toEqual([
      { delayMs: 25, name: "workflow_effect_spine.wait.delay" },
    ]);
    expect(events).toEqual(["workflow_effect_spine.approval.approved"]);
    expect(
      mutationCalls.filter((call) => call.ref === stageStartedRef),
    ).toHaveLength(graph.nodes.length);
    expect(
      mutationCalls.filter((call) => call.ref === stageFinishedRef),
    ).toHaveLength(graph.nodes.length);
  });

  it("skips false conditional branches and returns completed active context", async () => {
    const actionCalls: unknown[] = [];
    const sleeps: Array<{
      readonly delayMs: number;
      readonly name: string | undefined;
    }> = [];
    const events: string[] = [];
    const inputs = { kind: "lead", email: "founder@example.test" };
    const classifyResult = { route: "rejected", reason: "policy" };

    const step: RunDurableGraphStep = {
      runQuery: async () => classifyResult,
      runAction: async (ref, args) => {
        actionCalls.push({ ref, args });
        return { enriched: true };
      },
      runMutation: async () => null,
      sleep: async (delayMs, options) => {
        sleeps.push({ delayMs, name: options?.name });
      },
      awaitEvent: async <Result>(event: { readonly name: string }) => {
        events.push(event.name);
        return { approvedBy: "user_123" } as Result;
      },
    };

    await expect(
      runDurableGraphWorkflow(step, {
        graph,
        inputs,
        policySnapshot: { mode: "review", version: 2 },
        capabilityRegistry: {
          classifyLead: {
            kind: "query",
            ref: classifyRef,
          },
          enrichLead: {
            kind: "action",
            ref: enrichRef,
          },
        },
      }),
    ).resolves.toEqual({
      source: inputs,
      classify: classifyResult,
    });
    expect(actionCalls).toHaveLength(0);
    expect(sleeps).toEqual([]);
    expect(events).toEqual([]);
  });

  it("continues through mixed fan-in when one predecessor branch is skipped", async () => {
    const mixedFanInGraph = {
      id: "workflow_mixed_fan_in",
      version: 1,
      startNodeId: "source",
      nodes: [
        {
          id: "source",
          kind: "source",
          label: "Source",
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: "active",
          kind: "capability",
          label: "Active",
          capability: "activeBranch",
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: "skipped",
          kind: "capability",
          label: "Skipped",
          capability: "skippedBranch",
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: "merge",
          kind: "capability",
          label: "Merge",
          capability: "mergeBranch",
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: "output",
          kind: "output",
          label: "Output",
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
      ],
      edges: [
        {
          id: "source_active",
          sourceNodeId: "source",
          targetNodeId: "active",
        },
        {
          id: "source_skipped",
          sourceNodeId: "source",
          targetNodeId: "skipped",
          condition: { expression: "inputs.route === 'skipped'" },
        },
        {
          id: "active_merge",
          sourceNodeId: "active",
          targetNodeId: "merge",
        },
        {
          id: "skipped_merge",
          sourceNodeId: "skipped",
          targetNodeId: "merge",
        },
        {
          id: "merge_output",
          sourceNodeId: "merge",
          targetNodeId: "output",
        },
      ],
      joins: [],
    } satisfies DurableWorkflowGraph;
    const capabilityCalls: string[] = [];
    const step: RunDurableGraphStep = {
      runQuery: async (_ref, args) => {
        const node = args.node as { readonly id: string };
        capabilityCalls.push(node.id);
        if (node.id === "active") {
          return { selected: "active" };
        }
        if (node.id === "merge") {
          const context = args.context as {
            readonly active?: { readonly selected: string };
          };
          return { mergedFrom: context.active };
        }
        return { selected: "skipped" };
      },
      runAction: async () => null,
      runMutation: async () => null,
      sleep: async () => {},
      awaitEvent: async <Result>() => ({}) as Result,
    };

    await expect(
      runDurableGraphWorkflow(step, {
        graph: mixedFanInGraph,
        inputs: { route: "active" },
        policySnapshot: { mode: "review" },
        capabilityRegistry: {
          activeBranch: {
            kind: "query",
            ref: classifyRef,
          },
          skippedBranch: {
            kind: "query",
            ref: classifyRef,
          },
          mergeBranch: {
            kind: "query",
            ref: classifyRef,
          },
        },
        projectOutput: ({ context }) => ({
          result: context.merge,
        }),
      }),
    ).resolves.toEqual({
      result: { mergedFrom: { selected: "active" } },
    });
    expect(capabilityCalls).toEqual(["active", "merge"]);
  });

  it("dispatches agent nodes through registry entries tagged as agent seats", async () => {
    const actionCalls: unknown[] = [];
    const step: RunDurableGraphStep = {
      runQuery: async () => null,
      runAction: async (ref, args) => {
        actionCalls.push({ ref, args });
        return { drafted: true };
      },
      runMutation: async () => null,
      sleep: async () => {},
      awaitEvent: async <Result>() => ({}) as Result,
    };

    const result = await runDurableGraphWorkflow(step, {
      graph: agentGraph,
      inputs: { prompt: "hello" },
      policySnapshot: { mode: "review" },
      capabilityRegistry: {
        draftReply: {
          kind: "action",
          ref: agentRef,
          agentSeat: true,
        },
      },
      projectOutput: ({ context }) => ({ agent: context.agent }),
    });

    expect(result).toEqual({ agent: { drafted: true } });
    expect(actionCalls).toHaveLength(1);
    expect(actionCalls[0]).toMatchObject({ ref: agentRef });
  });

  it("rejects agent nodes backed by registry entries without agent seats", async () => {
    const step: RunDurableGraphStep = {
      runQuery: async () => null,
      runAction: async () => ({ drafted: true }),
      runMutation: async () => null,
      sleep: async () => {},
      awaitEvent: async <Result>() => ({}) as Result,
    };

    await expect(
      runDurableGraphWorkflow(step, {
        graph: agentGraph,
        inputs: { prompt: "hello" },
        policySnapshot: { mode: "review" },
        capabilityRegistry: {
          draftReply: {
            kind: "action",
            ref: agentRef,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: "Agent node is not tagged as an agent seat: draftReply",
    });
  });

  it("records non-JSON-safe node results as failed observed stages", async () => {
    const mutationCalls: Array<{
      readonly ref: DurableGraphStepRef<"mutation">;
      readonly args: Record<string, unknown>;
    }> = [];
    const badResultGraph = {
      id: "workflow_bad_result",
      version: 1,
      startNodeId: "source",
      nodes: [
        {
          id: "source",
          kind: "source",
          label: "Source",
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: "bad",
          kind: "capability",
          label: "Bad Result",
          capability: "badResult",
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: "output",
          kind: "output",
          label: "Output",
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
      ],
      edges: [
        {
          id: "source_bad",
          sourceNodeId: "source",
          targetNodeId: "bad",
        },
        {
          id: "bad_output",
          sourceNodeId: "bad",
          targetNodeId: "output",
        },
      ],
      joins: [],
    } satisfies DurableWorkflowGraph;
    const step: RunDurableGraphStep = {
      runQuery: async () => undefined,
      runAction: async () => null,
      runMutation: async (ref, args) => {
        mutationCalls.push({ ref, args });
        return null;
      },
      sleep: async () => {},
      awaitEvent: async <Result>() => ({}) as Result,
    };

    await expect(
      runDurableGraphWorkflow(step, {
        graph: badResultGraph,
        inputs: { prompt: "hello" },
        policySnapshot: { mode: "review" },
        capabilityRegistry: {
          badResult: {
            kind: "query",
            ref: classifyRef,
          },
        },
        observability: {
          workflowRunId: "run_bad_result",
          componentWorkflowId: "workflow_component_bad_result",
          recordStageStarted: stageStartedRef,
          recordStageFinished: stageFinishedRef,
        },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: "Workflow node bad returned non-JSON output.",
    });

    const badStageFinishes = mutationCalls.filter(
      (call) => call.ref === stageFinishedRef && call.args.nodeId === "bad",
    );
    expect(badStageFinishes).toContainEqual(
      expect.objectContaining({
        args: expect.objectContaining({ status: "failed" }),
      }),
    );
    expect(badStageFinishes).not.toContainEqual(
      expect.objectContaining({
        args: expect.objectContaining({ status: "succeeded" }),
      }),
    );
  });

  it("rejects reachable cycles that prevent traversal progress", async () => {
    const cycleGraph = {
      id: "workflow_cycle",
      version: 1,
      startNodeId: "source",
      nodes: [
        {
          id: "source",
          kind: "source",
          label: "Source",
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: "cycle_a",
          kind: "capability",
          label: "Cycle A",
          capability: "cycleA",
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: "cycle_b",
          kind: "capability",
          label: "Cycle B",
          capability: "cycleB",
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
      ],
      edges: [
        {
          id: "source_cycle_a",
          sourceNodeId: "source",
          targetNodeId: "cycle_a",
        },
        {
          id: "cycle_a_cycle_b",
          sourceNodeId: "cycle_a",
          targetNodeId: "cycle_b",
        },
        {
          id: "cycle_b_cycle_a",
          sourceNodeId: "cycle_b",
          targetNodeId: "cycle_a",
        },
      ],
      joins: [],
    } satisfies DurableWorkflowGraph;
    const step: RunDurableGraphStep = {
      runQuery: async () => ({ ok: true }),
      runAction: async () => null,
      runMutation: async () => null,
      sleep: async () => {},
      awaitEvent: async <Result>() => ({}) as Result,
    };

    await expect(
      runDurableGraphWorkflow(step, {
        graph: cycleGraph,
        inputs: { prompt: "hello" },
        policySnapshot: { mode: "review" },
        capabilityRegistry: {
          cycleA: {
            kind: "query",
            ref: classifyRef,
          },
          cycleB: {
            kind: "query",
            ref: classifyRef,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message:
        "Workflow graph traversal made no progress before completing reachable nodes.",
      details: { nodeIds: "cycle_a,cycle_b" },
    });
  });
});
