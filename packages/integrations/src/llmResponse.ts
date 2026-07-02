import * as Schema from "effect/Schema";
import type { ProviderMode } from "./index";
import type { LlmSpendEstimate } from "./spend";

export const LlmFinishReason = Schema.Literal(
  "stop",
  "length",
  "tool_call",
  "content_filter",
);

export type LlmFinishReason = Schema.Schema.Type<typeof LlmFinishReason>;

export type LlmCompletionReceipt = {
  readonly workspaceSlug: string;
  readonly idempotencyKey?: string;
  readonly generatedAt: string;
};

export type LlmCompletion = {
  readonly provider: "openrouter";
  readonly mode: ProviderMode;
  readonly model: string;
  readonly text: string;
  readonly finishReason: LlmFinishReason;
  readonly usage: LlmSpendEstimate;
  readonly receipt: LlmCompletionReceipt;
};

export type LlmCompletionInput = {
  readonly mode: ProviderMode;
  readonly model: string;
  readonly workspaceSlug: string;
  readonly text: string;
  readonly usage: LlmSpendEstimate;
  readonly generatedAt: string;
  readonly idempotencyKey?: string;
};

export const makeLlmCompletion = (input: LlmCompletionInput): LlmCompletion => {
  const receipt: LlmCompletionReceipt = input.idempotencyKey
    ? {
        workspaceSlug: input.workspaceSlug,
        idempotencyKey: input.idempotencyKey,
        generatedAt: input.generatedAt,
      }
    : {
        workspaceSlug: input.workspaceSlug,
        generatedAt: input.generatedAt,
      };

  return {
    provider: "openrouter",
    mode: input.mode,
    model: input.model,
    text: input.text,
    finishReason: "stop",
    usage: input.usage,
    receipt,
  };
};

export const makeFakeLlmCompletionText = (workspaceSlug: string): string =>
  `Deterministic fake completion for ${workspaceSlug}. Replace this through the guarded LLM gateway before live use.`;
