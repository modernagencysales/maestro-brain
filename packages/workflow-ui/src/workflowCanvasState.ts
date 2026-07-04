export type WorkflowNodeKind =
  "source" | "capability" | "agent" | "approval" | "delay" | "output";

export type DurableWorkflowGraphForCanvas = {
  readonly id: string;
  readonly version: number;
  readonly startNodeId: string;
  readonly nodes: readonly {
    readonly id: string;
    readonly label: string;
    readonly kind: WorkflowNodeKind;
    readonly capability?: string;
    readonly agent?: string;
    readonly delayMs?: number;
    readonly retry: {
      readonly maxAttempts: number;
      readonly backoffMs: number;
    };
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly sourceNodeId: string;
    readonly targetNodeId: string;
    readonly condition?: {
      readonly expression: string;
    };
  }[];
  readonly joins: readonly {
    readonly nodeId: string;
    readonly strategy: "all-successful" | "any-successful";
    readonly sourceNodeIds: readonly string[];
  }[];
};

export type WorkflowValidationHint = {
  readonly target: "node" | "edge";
  readonly id: string;
  readonly severity: "warning" | "error";
  readonly message: string;
};

export type WorkflowFlowValidationHint = Omit<
  WorkflowValidationHint,
  "target" | "id"
>;

export type WorkflowNodeStatus = "pending" | "running" | "completed" | "failed";

export type WorkflowFlowNodeData = {
  readonly label: string;
  readonly kind: WorkflowNodeKind;
  readonly capability?: string;
  readonly agent?: string;
  readonly delayMs?: number;
  readonly validationHints: readonly WorkflowFlowValidationHint[];
  readonly status?: WorkflowNodeStatus;
  readonly runSummary?: string;
  readonly runErrorCode?: string;
};

export type WorkflowFlowEdgeData = {
  readonly validationHints: readonly WorkflowFlowValidationHint[];
};

export type WorkflowFlowNode = {
  readonly id: string;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly data: WorkflowFlowNodeData;
  readonly type: "default";
};

export type WorkflowFlowEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string | undefined;
  readonly animated: boolean;
  readonly data: WorkflowFlowEdgeData;
};

export type WorkflowFlowModel = {
  readonly nodes: readonly WorkflowFlowNode[];
  readonly edges: readonly WorkflowFlowEdge[];
};

export type WorkflowCanvasView =
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | { readonly status: "ready"; readonly model: WorkflowFlowModel };

export type WorkflowStageStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "completed"
  | "failed"
  | "canceled"
  | "skipped";

export type WorkflowStageRunForCanvas = {
  readonly stageKey: string;
  readonly status: WorkflowStageStatus;
  readonly attemptNumber: number;
  readonly summary?: string | null;
  readonly errorCode?: string | null;
};

export type WorkflowStageKeyMap = Readonly<Record<string, string>>;

export type WorkflowNodeStatusOverlay = {
  readonly nodeId: string;
  readonly status: WorkflowNodeStatus;
  readonly summary?: string;
  readonly errorCode?: string;
};

type WorkflowNodeOptionalData = Pick<
  WorkflowFlowNodeData,
  "capability" | "agent" | "delayMs"
>;

type UndefinedStripped<Value extends Record<string, unknown>> = {
  readonly [Key in keyof Value]?: Exclude<Value[Key], undefined>;
};

export {
  applyStatusOverlay,
  mapStageRunsToOverlay,
  mapWorkflowStageStatus,
} from "./workflowStatusOverlay";

const kindY: Record<WorkflowNodeKind, number> = {
  source: 80,
  capability: 20,
  agent: 80,
  approval: 20,
  delay: 80,
  output: 80,
};

const hintsFor = (
  hints: readonly WorkflowValidationHint[],
  target: WorkflowValidationHint["target"],
  id: string,
): readonly WorkflowFlowValidationHint[] =>
  hints
    .filter((hint) => hint.target === target && hint.id === id)
    .map(({ severity, message }) => ({ severity, message }));

const compactUndefined = <Value extends Record<string, unknown>>(
  value: Value,
): UndefinedStripped<Value> =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as UndefinedStripped<Value>;

const optionalNodeData = (
  data: WorkflowNodeOptionalData,
): Partial<WorkflowNodeOptionalData> =>
  compactUndefined({
    capability: data.capability,
    agent: data.agent,
    delayMs: data.delayMs,
  });

export const deriveWorkflowFlowModel = (
  graph: DurableWorkflowGraphForCanvas,
  validationHints: readonly WorkflowValidationHint[] = [],
): WorkflowFlowModel => ({
  nodes: graph.nodes.map((node, index) => ({
    id: node.id,
    position: { x: index * 260, y: kindY[node.kind] },
    data: {
      label: `${node.kind}: ${node.label}`,
      kind: node.kind,
      ...optionalNodeData(node),
      validationHints: hintsFor(validationHints, "node", node.id),
    },
    type: "default",
  })),
  edges: graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: edge.condition?.expression,
    animated: edge.condition !== undefined,
    data: {
      validationHints: hintsFor(validationHints, "edge", edge.id),
    },
  })),
});

export const deriveWorkflowCanvasView = (
  graph: DurableWorkflowGraphForCanvas | undefined,
  validationHints: readonly WorkflowValidationHint[] = [],
): WorkflowCanvasView => {
  if (graph === undefined) {
    return { status: "loading" };
  }
  if (graph.nodes.length === 0) {
    return { status: "empty" };
  }
  return {
    status: "ready",
    model: deriveWorkflowFlowModel(graph, validationHints),
  };
};

export const summarizeWorkflowValidationHints = (
  model: WorkflowFlowModel,
): { readonly errors: number; readonly warnings: number } => {
  const hints = [
    ...model.nodes.flatMap((node) => node.data.validationHints),
    ...model.edges.flatMap((edge) => edge.data.validationHints),
  ];

  return {
    errors: hints.filter((hint) => hint.severity === "error").length,
    warnings: hints.filter((hint) => hint.severity === "warning").length,
  };
};
