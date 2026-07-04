import * as S from "effect/Schema";

export const WorkflowJoin = S.Struct({
  nodeId: S.String,
  strategy: S.Literal("all-successful", "any-successful"),
  sourceNodeIds: S.Array(S.String),
});

export type WorkflowJoin = S.Schema.Type<typeof WorkflowJoin>;
