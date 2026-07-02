import * as S from "effect/Schema";

export const WorkflowNodeKind = S.Literal(
  "source",
  "capability",
  "agent",
  "approval",
  "output",
);

export type WorkflowNodeKind = S.Schema.Type<typeof WorkflowNodeKind>;

export const WorkflowRetryConfig = S.Struct({
  maxAttempts: S.Number,
  backoffMs: S.Number,
});

export const WorkflowCondition = S.Struct({
  expression: S.String,
});

export const WorkflowNode = S.Struct({
  id: S.String,
  kind: WorkflowNodeKind,
  label: S.String,
  capability: S.optional(S.String),
  agent: S.optional(S.String),
  retry: WorkflowRetryConfig,
});

export const WorkflowEdge = S.Struct({
  id: S.String,
  sourceNodeId: S.String,
  targetNodeId: S.String,
  condition: S.optional(WorkflowCondition),
});

export const WorkflowJoin = S.Struct({
  nodeId: S.String,
  strategy: S.Literal("all-successful", "any-successful"),
  sourceNodeIds: S.Array(S.String),
});

export const DurableWorkflowGraph = S.Struct({
  id: S.String,
  version: S.Number,
  startNodeId: S.String,
  nodes: S.Array(WorkflowNode).pipe(S.minItems(1)),
  edges: S.Array(WorkflowEdge),
  joins: S.Array(WorkflowJoin),
});

export type DurableWorkflowGraph = S.Schema.Type<typeof DurableWorkflowGraph>;

export type WorkflowNode = S.Schema.Type<typeof WorkflowNode>;
export type WorkflowEdge = S.Schema.Type<typeof WorkflowEdge>;
export type WorkflowJoin = S.Schema.Type<typeof WorkflowJoin>;

export namespace WorkflowGraphValidationError {
  export class MissingStartNode extends S.TaggedError<MissingStartNode>()(
    "MissingStartNode",
    {
      startNodeId: S.String,
    },
  ) {}

  export class DuplicateNodeId extends S.TaggedError<DuplicateNodeId>()(
    "DuplicateNodeId",
    {
      nodeId: S.String,
    },
  ) {}

  export class DanglingEdge extends S.TaggedError<DanglingEdge>()(
    "DanglingEdge",
    {
      edgeId: S.String,
      nodeId: S.String,
    },
  ) {}

  export class InvalidRetryConfig extends S.TaggedError<InvalidRetryConfig>()(
    "InvalidRetryConfig",
    {
      nodeId: S.String,
      field: S.Literal("maxAttempts", "backoffMs"),
    },
  ) {}

  export class InvalidJoin extends S.TaggedError<InvalidJoin>()("InvalidJoin", {
    nodeId: S.String,
    reason: S.String,
  }) {}

  export class InvalidConditionExpression extends S.TaggedError<InvalidConditionExpression>()(
    "InvalidConditionExpression",
    {
      edgeId: S.String,
    },
  ) {}

  export const Schema = S.Union(
    MissingStartNode,
    DuplicateNodeId,
    DanglingEdge,
    InvalidRetryConfig,
    InvalidJoin,
    InvalidConditionExpression,
  );
}

export type WorkflowGraphValidationError = S.Schema.Type<
  typeof WorkflowGraphValidationError.Schema
>;

export const validateWorkflowGraph = (
  graph: DurableWorkflowGraph,
): readonly WorkflowGraphValidationError[] => {
  const errors: WorkflowGraphValidationError[] = [];
  const nodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      duplicateNodeIds.add(node.id);
    }
    nodeIds.add(node.id);

    if (node.retry.maxAttempts < 1) {
      errors.push(
        new WorkflowGraphValidationError.InvalidRetryConfig({
          nodeId: node.id,
          field: "maxAttempts",
        }),
      );
    }

    if (node.retry.backoffMs < 0) {
      errors.push(
        new WorkflowGraphValidationError.InvalidRetryConfig({
          nodeId: node.id,
          field: "backoffMs",
        }),
      );
    }
  }

  for (const nodeId of duplicateNodeIds) {
    errors.push(new WorkflowGraphValidationError.DuplicateNodeId({ nodeId }));
  }

  if (!nodeIds.has(graph.startNodeId)) {
    errors.push(
      new WorkflowGraphValidationError.MissingStartNode({
        startNodeId: graph.startNodeId,
      }),
    );
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.sourceNodeId)) {
      errors.push(
        new WorkflowGraphValidationError.DanglingEdge({
          edgeId: edge.id,
          nodeId: edge.sourceNodeId,
        }),
      );
    }

    if (!nodeIds.has(edge.targetNodeId)) {
      errors.push(
        new WorkflowGraphValidationError.DanglingEdge({
          edgeId: edge.id,
          nodeId: edge.targetNodeId,
        }),
      );
    }

    if (
      edge.condition &&
      !isSafeConditionExpression(edge.condition.expression)
    ) {
      errors.push(
        new WorkflowGraphValidationError.InvalidConditionExpression({
          edgeId: edge.id,
        }),
      );
    }
  }

  for (const join of graph.joins) {
    if (!nodeIds.has(join.nodeId)) {
      errors.push(
        new WorkflowGraphValidationError.InvalidJoin({
          nodeId: join.nodeId,
          reason: "join node is not in graph",
        }),
      );
    }

    for (const sourceNodeId of join.sourceNodeIds) {
      if (!nodeIds.has(sourceNodeId)) {
        errors.push(
          new WorkflowGraphValidationError.InvalidJoin({
            nodeId: sourceNodeId,
            reason: "join source node is not in graph",
          }),
        );
      }
    }
  }

  return errors;
};

const safeConditionPattern =
  /^result\.[A-Za-z0-9_.-]+\s*(==|!=)\s*('[^']*'|"[^"]*"|true|false|[0-9]+)$/;

export const isSafeConditionExpression = (expression: string): boolean =>
  safeConditionPattern.test(expression.trim());
