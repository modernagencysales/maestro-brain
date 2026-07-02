import type {
  ModelRequestFromPrompt,
  PromptDefinition,
  PromptRef,
  PromptStatus,
} from "./types";
export { escapeXml, xmlUserPrompt } from "./xmlUserPrompt";
export type {
  ModelRequestFromPrompt,
  PromptDefinition,
  PromptRef,
  PromptStatus,
} from "./types";

const promptVersions = new Map<PromptRef, string>();

export class PromptVersionImmutableError extends Error {
  readonly _tag = "PromptVersionImmutableError";

  constructor(readonly ref: PromptRef) {
    super(`Prompt version is immutable: ${ref}`);
    this.name = "PromptVersionImmutableError";
  }
}

export const promptRef = (family: string, version: number): PromptRef => {
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/.test(family)) {
    throw new Error(
      "Prompt family must be dot-separated lower camel segments.",
    );
  }

  if (!Number.isInteger(version) || version <= 0) {
    throw new Error("Prompt version must be a positive integer.");
  }

  return `prompt:${family}:v${version}`;
};

export const definePrompt = (input: {
  readonly family: string;
  readonly version: number;
  readonly status: PromptStatus;
  readonly modelRef: string;
  readonly body: string;
  readonly createdAt: number;
}): PromptDefinition => {
  const ref = promptRef(input.family, input.version);
  const existingBody = promptVersions.get(ref);

  if (existingBody !== undefined && existingBody !== input.body) {
    throw new PromptVersionImmutableError(ref);
  }

  promptVersions.set(ref, input.body);

  return {
    ref,
    family: input.family,
    version: input.version,
    status: input.status,
    modelRef: input.modelRef,
    body: input.body,
    createdAt: input.createdAt,
  };
};

export const modelRequestFromPrompt = (input: {
  readonly prompt: PromptDefinition;
  readonly userPromptXml: string;
}): ModelRequestFromPrompt => ({
  promptRef: input.prompt.ref,
  modelRef: input.prompt.modelRef,
  userPromptXml: input.userPromptXml,
});
