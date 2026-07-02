import * as Schema from "effect/Schema";
import type { PolicyKindDefinition } from "./types";

export const PromptOverridePolicy = Schema.Struct({
  promptRef: Schema.String,
  locale: Schema.optional(Schema.String),
  reason: Schema.String,
});

export type PromptOverridePolicy = Schema.Schema.Type<
  typeof PromptOverridePolicy
>;

export const promptOverridePolicyKind: PolicyKindDefinition<PromptOverridePolicy> =
  {
    kind: "prompt.override",
    schema: PromptOverridePolicy,
    evalRequired: true,
    merge: (base, override) => ({
      ...base,
      ...override,
    }),
  };
