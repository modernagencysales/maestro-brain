import * as S from "effect/Schema";

export const WorkflowNodeKind = S.Literal(
  "source",
  "capability",
  "agent",
  "delay",
  "approval",
  "output",
);

export type WorkflowNodeKind = S.Schema.Type<typeof WorkflowNodeKind>;

export const WorkflowRetryConfig = S.Struct({
  maxAttempts: S.Number,
  backoffMs: S.Number,
});

export const WorkflowNode = S.Struct({
  id: S.String,
  kind: WorkflowNodeKind,
  label: S.String,
  capability: S.optional(S.String),
  agent: S.optional(S.String),
  delayMs: S.optional(S.Number),
  retry: WorkflowRetryConfig,
});

export type WorkflowNode = S.Schema.Type<typeof WorkflowNode>;
