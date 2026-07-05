import { describe, expect, it } from "vitest";
import {
  AgentRuntimeError,
  continueAgentTurn,
  createAgentRuntime,
} from "../confect/agents/runtime";
import { sourceGroundedBriefTool } from "../confect/agents/defineTools";
import type { AgentPolicy } from "../confect/policy/kinds/agent";

const policy: AgentPolicy = {
  allowedToolGrantIds: ["capability.run"],
  maxToolCalls: 2,
  modelRef: "openrouter:fake/local-demo",
};

const prompt = "Create a source-grounded implementation brief.";

const toolArgs = {
  workspaceId: "workspace_123",
  sourceIds: ["source_1"],
  briefGoal: "Create a source-grounded implementation brief.",
  idempotencyKey: "brief-001",
};

describe("bounded agent runtime", () => {
  it("allows a granted tool call and returns a fake model response", async () => {
    const runtime = createAgentRuntime({
      workspaceId: "workspace_123",
      policy,
      tools: [sourceGroundedBriefTool],
    });

    await expect(
      continueAgentTurn(runtime, {
        threadId: "thread_123",
        userMessage: prompt,
        requestedToolName: "sourceGroundedBrief",
        toolArgs,
      }),
    ).resolves.toMatchObject({
      threadId: "thread_123",
      assistantMessage:
        "I created a source-grounded brief using sourceGroundedBrief.",
      modelRef: "openrouter:fake/local-demo",
      toolCalls: [
        {
          toolName: "sourceGroundedBrief",
          grantId: "capability.run",
          idempotencyKey: "brief-001",
          status: "completed",
          presentation: {
            trustClaim: "source-backed-no-default-rag",
          },
        },
      ],
    });
  });

  it("denies tool calls without an explicit grant", async () => {
    const runtime = createAgentRuntime({
      workspaceId: "workspace_123",
      policy: { ...policy, allowedToolGrantIds: [] },
      tools: [sourceGroundedBriefTool],
    });

    await expect(
      continueAgentTurn(runtime, {
        threadId: "thread_123",
        userMessage: prompt,
        requestedToolName: "sourceGroundedBrief",
        toolArgs,
      }),
    ).resolves.toMatchObject({
      assistantMessage: "I cannot use sourceGroundedBrief without a grant.",
      toolCalls: [
        {
          toolName: "sourceGroundedBrief",
          status: "denied",
          error: { _tag: "ToolGrantDenied" },
        },
      ],
    });
  });

  it("reuses idempotent tool results without spending another tool call", async () => {
    const runtime = createAgentRuntime({
      workspaceId: "workspace_123",
      policy,
      tools: [sourceGroundedBriefTool],
    });

    const first = await continueAgentTurn(runtime, {
      threadId: "thread_123",
      userMessage: prompt,
      requestedToolName: "sourceGroundedBrief",
      toolArgs,
    });
    const second = await continueAgentTurn(runtime, {
      threadId: "thread_123",
      userMessage: prompt,
      requestedToolName: "sourceGroundedBrief",
      toolArgs,
    });

    expect(first.toolCalls[0]?.reused).toBe(false);
    expect(second.toolCalls[0]).toMatchObject({
      status: "completed",
      reused: true,
      idempotencyKey: "brief-001",
    });
    expect(runtime.usedToolCalls).toBe(1);
  });

  it("maps validation failures to typed runtime errors", async () => {
    const runtime = createAgentRuntime({
      workspaceId: "workspace_123",
      policy,
      tools: [sourceGroundedBriefTool],
    });

    await expect(
      continueAgentTurn(runtime, {
        threadId: "thread_123",
        userMessage: prompt,
        requestedToolName: "sourceGroundedBrief",
        toolArgs: { ...toolArgs, sourceIds: [] },
      }),
    ).resolves.toMatchObject({
      toolCalls: [
        {
          status: "failed",
          idempotencyKey: "brief-001",
          error: { _tag: "ToolInputInvalid" },
        },
      ],
    });
  });

  it("does not preserve malformed caller idempotency keys on failed tool calls", async () => {
    const runtime = createAgentRuntime({
      workspaceId: "workspace_123",
      policy,
      tools: [sourceGroundedBriefTool],
    });

    await expect(
      continueAgentTurn(runtime, {
        threadId: "thread_123",
        userMessage: prompt,
        requestedToolName: "sourceGroundedBrief",
        toolArgs: { ...toolArgs, idempotencyKey: " brief-001 " },
      }),
    ).resolves.toMatchObject({
      toolCalls: [
        {
          status: "failed",
          idempotencyKey: "invalid",
          error: {
            _tag: "ToolInputInvalid",
            message:
              "idempotencyKey must not have leading or trailing whitespace.",
          },
        },
      ],
    });
  });

  it("returns typed errors for missing tools and max tool calls", async () => {
    const runtime = createAgentRuntime({
      workspaceId: "workspace_123",
      policy: { ...policy, maxToolCalls: 0 },
      tools: [sourceGroundedBriefTool],
    });

    await expect(
      continueAgentTurn(runtime, {
        threadId: "thread_123",
        userMessage: prompt,
        requestedToolName: "sourceGroundedBrief",
        toolArgs,
      }),
    ).resolves.toMatchObject({
      toolCalls: [
        { status: "failed", error: { _tag: "ToolCallLimitExceeded" } },
      ],
    });

    expect(
      new AgentRuntimeError.ToolNotFound({
        toolName: "missing",
      }),
    ).toMatchObject({ _tag: "ToolNotFound", toolName: "missing" });
  });
});
