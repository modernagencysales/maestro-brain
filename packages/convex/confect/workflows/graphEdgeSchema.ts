import * as S from "effect/Schema";

export const WorkflowCondition = S.Struct({
  expression: S.String,
});

export const WorkflowEdge = S.Struct({
  id: S.String,
  sourceNodeId: S.String,
  targetNodeId: S.String,
  condition: S.optional(WorkflowCondition),
});

export type WorkflowEdge = S.Schema.Type<typeof WorkflowEdge>;
