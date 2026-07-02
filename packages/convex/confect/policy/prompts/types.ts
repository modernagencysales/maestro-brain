export type PromptStatus = "draft" | "active" | "retired";

export type PromptRef = `prompt:${string}:v${number}`;

export type PromptDefinition = {
  readonly ref: PromptRef;
  readonly family: string;
  readonly version: number;
  readonly status: PromptStatus;
  readonly modelRef: string;
  readonly body: string;
  readonly createdAt: number;
};

export type ModelRequestFromPrompt = {
  readonly promptRef: PromptRef;
  readonly modelRef: string;
  readonly userPromptXml: string;
};
