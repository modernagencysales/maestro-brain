import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { mockModel } from "@convex-dev/agent";
import { generateText } from "ai";

type AssistantModelInput = {
  mode: "fake" | "test" | "live";
  env: Readonly<{
    OPENROUTER_API_KEY?: string | undefined;
    OPENROUTER_BASE_URL?: string | undefined;
    LLM_FREE_MODEL?: string | undefined;
  }>;
};

export const createAssistantLanguageModel = (
  input: AssistantModelInput,
): LanguageModelV4 => {
  if (input.mode !== "live") {
    return mockModel({
      provider: "maestro-fake",
      modelId: "maestro-assistant-fake",
      content: [
        {
          type: "text",
          text: "I can help turn your workspace context into a clear next step.",
        },
      ],
    });
  }
  const apiKey = input.env.OPENROUTER_API_KEY?.trim();
  const model = input.env.LLM_FREE_MODEL?.trim();
  if (!apiKey || !model) {
    throw new Error("Live assistant provider configuration is missing.");
  }
  return createOpenAICompatible({
    name: "openrouter",
    baseURL:
      input.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    apiKey,
  }).chatModel(model);
};

export const generateAssistantText = async (
  input: AssistantModelInput & {
    prompt: string;
    maxOutputTokens: number;
    maxRetries: number;
    timeout: number;
  },
): Promise<{ readonly text: string }> => {
  const result = await generateText({
    model: createAssistantLanguageModel(input),
    prompt: input.prompt,
    maxOutputTokens: input.maxOutputTokens,
    maxRetries: input.maxRetries,
    timeout: input.timeout,
  });
  return { text: result.text };
};
