import * as S from "effect/Schema";
import {
  normalizeSourceGroundedBriefInput,
  runFakeSourceGroundedBrief,
  type SourceGroundedBriefInput,
} from "../capabilities/sourceGroundedBrief.domain";
import type { AgentPolicy } from "../policy/kinds/agent";
import type { ModelTool, ToolPresentation } from "./defineTools";

export namespace AgentRuntimeError {
  export class ToolNotFound extends S.TaggedError<ToolNotFound>()(
    "ToolNotFound",
    {
      toolName: S.String,
    },
  ) {}

  export class ToolGrantDenied extends S.TaggedError<ToolGrantDenied>()(
    "ToolGrantDenied",
    {
      toolName: S.String,
      grantId: S.String,
    },
  ) {}

  export class ToolCallLimitExceeded extends S.TaggedError<ToolCallLimitExceeded>()(
    "ToolCallLimitExceeded",
    {
      maxToolCalls: S.Number,
    },
  ) {}

  export class ToolInputInvalid extends S.TaggedError<ToolInputInvalid>()(
    "ToolInputInvalid",
    {
      toolName: S.String,
      message: S.String,
    },
  ) {}

  export const Schema = S.Union(
    ToolNotFound,
    ToolGrantDenied,
    ToolCallLimitExceeded,
    ToolInputInvalid,
  );
}

export type AgentRuntimeError = S.Schema.Type<typeof AgentRuntimeError.Schema>;

export type AgentRuntime = {
  readonly workspaceId: string;
  readonly policy: AgentPolicy;
  readonly tools: readonly ModelTool[];
  usedToolCalls: number;
  readonly idempotencyCache: Map<string, AgentToolCall>;
};

export type AgentToolCall = {
  readonly toolName: string;
  readonly grantId: string;
  readonly idempotencyKey: string;
  readonly status: "completed" | "denied" | "failed";
  readonly reused: boolean;
  readonly presentation?: ToolPresentation;
  readonly error?: AgentRuntimeError;
};

export type ContinueAgentTurnInput = {
  readonly threadId: string;
  readonly userMessage: string;
  readonly requestedToolName: string;
  readonly toolArgs: unknown;
};

export type AgentTurnResult = {
  readonly threadId: string;
  readonly assistantMessage: string;
  readonly modelRef: string;
  readonly toolCalls: readonly AgentToolCall[];
};

export const createAgentRuntime = (input: {
  readonly workspaceId: string;
  readonly policy: AgentPolicy;
  readonly tools: readonly ModelTool[];
}): AgentRuntime => ({
  workspaceId: input.workspaceId,
  policy: input.policy,
  tools: input.tools,
  usedToolCalls: 0,
  idempotencyCache: new Map(),
});

export const continueAgentTurn = async (
  runtime: AgentRuntime,
  input: ContinueAgentTurnInput,
): Promise<AgentTurnResult> => {
  const tool = runtime.tools.find((candidate) => {
    return candidate.name === input.requestedToolName;
  });

  if (!tool) {
    return withFailedCall(runtime, input, {
      error: new AgentRuntimeError.ToolNotFound({
        toolName: input.requestedToolName,
      }),
      assistantMessage: `I cannot find ${input.requestedToolName}.`,
    });
  }

  if (!runtime.policy.allowedToolGrantIds.includes(tool.grantId)) {
    return {
      threadId: input.threadId,
      assistantMessage: `I cannot use ${tool.name} without a grant.`,
      modelRef: runtime.policy.modelRef,
      toolCalls: [
        {
          toolName: tool.name,
          grantId: tool.grantId,
          idempotencyKey: idempotencyKeyFromUnknown(input.toolArgs),
          status: "denied",
          reused: false,
          error: new AgentRuntimeError.ToolGrantDenied({
            toolName: tool.name,
            grantId: tool.grantId,
          }),
        },
      ],
    };
  }

  if (runtime.usedToolCalls >= runtime.policy.maxToolCalls) {
    return withFailedCall(runtime, input, {
      tool,
      error: new AgentRuntimeError.ToolCallLimitExceeded({
        maxToolCalls: runtime.policy.maxToolCalls,
      }),
      assistantMessage: "I stopped before exceeding the configured tool limit.",
    });
  }

  const decoded = decodeToolArgs(tool, input.toolArgs);

  if (decoded instanceof AgentRuntimeError.ToolInputInvalid) {
    return withFailedCall(runtime, input, {
      tool,
      error: decoded,
      assistantMessage: `I could not call ${tool.name} because the input was invalid.`,
    });
  }

  const idempotencyKey = decoded.idempotencyKey;
  const cached = runtime.idempotencyCache.get(idempotencyKey);

  if (cached) {
    return {
      threadId: input.threadId,
      assistantMessage: `I reused the existing ${tool.name} result.`,
      modelRef: runtime.policy.modelRef,
      toolCalls: [{ ...cached, reused: true }],
    };
  }

  runtime.usedToolCalls += 1;

  const result = runFakeSourceGroundedBrief({
    input: normalizeSourceGroundedBriefInput(decoded),
    sources: decoded.sourceIds.map((sourceId) => ({
      id: sourceId,
      title: `Source ${sourceId}`,
      markdown: "Synthetic source content for fake-mode agent tool run.",
    })),
    policySnapshotId: `policy_snapshot_${decoded.idempotencyKey}`,
    modelReceiptId: `model_receipt_${decoded.idempotencyKey}`,
  });
  const toolCall: AgentToolCall = {
    toolName: tool.name,
    grantId: tool.grantId,
    idempotencyKey,
    status: "completed",
    reused: false,
    presentation: tool.present(result),
  };

  runtime.idempotencyCache.set(idempotencyKey, toolCall);

  return {
    threadId: input.threadId,
    assistantMessage: `I created a source-grounded brief using ${tool.name}.`,
    modelRef: runtime.policy.modelRef,
    toolCalls: [toolCall],
  };
};

const decodeToolArgs = (
  tool: ModelTool,
  value: unknown,
): SourceGroundedBriefInput | AgentRuntimeError.ToolInputInvalid => {
  try {
    return S.decodeUnknownSync(tool.inputSchema)(value);
  } catch (error) {
    return new AgentRuntimeError.ToolInputInvalid({
      toolName: tool.name,
      message: error instanceof Error ? error.message : "Invalid tool input.",
    });
  }
};

const withFailedCall = (
  runtime: AgentRuntime,
  input: ContinueAgentTurnInput,
  options: {
    readonly tool?: ModelTool;
    readonly error: AgentRuntimeError;
    readonly assistantMessage: string;
  },
): AgentTurnResult => ({
  threadId: input.threadId,
  assistantMessage: options.assistantMessage,
  modelRef: runtime.policy.modelRef,
  toolCalls: [
    {
      toolName: options.tool?.name ?? input.requestedToolName,
      grantId: options.tool?.grantId ?? "unknown",
      idempotencyKey: idempotencyKeyFromUnknown(input.toolArgs),
      status: "failed",
      reused: false,
      error: options.error,
    },
  ],
});

const idempotencyKeyFromUnknown = (value: unknown): string => {
  if (
    typeof value === "object" &&
    value !== null &&
    "idempotencyKey" in value
  ) {
    const key = (value as { readonly idempotencyKey?: unknown }).idempotencyKey;

    return typeof key === "string" ? key : "missing";
  }

  return "missing";
};
