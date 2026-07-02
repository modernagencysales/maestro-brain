import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

export type WorkflowNodeKind =
  "source" | "capability" | "agent" | "approval" | "output";

export type WorkflowTemplateNode = {
  readonly id: string;
  readonly label: string;
  readonly kind: WorkflowNodeKind;
  readonly x: number;
  readonly y: number;
};

export type WorkflowTemplateEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
};

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

export type WorkflowFlowNodeData = {
  readonly label: string;
  readonly kind: WorkflowNodeKind;
  readonly capability?: string;
  readonly agent?: string;
  readonly validationHints: readonly WorkflowFlowValidationHint[];
};

export type WorkflowFlowEdgeData = {
  readonly validationHints: readonly WorkflowFlowValidationHint[];
};

export type WorkflowFlowNode = Node<WorkflowFlowNodeData>;
export type WorkflowFlowEdge = Edge<WorkflowFlowEdgeData> & {
  readonly label: string | undefined;
  readonly animated: boolean;
};

export type WorkflowFlowModel = {
  readonly nodes: readonly WorkflowFlowNode[];
  readonly edges: readonly WorkflowFlowEdge[];
};

const kindY: Record<WorkflowNodeKind, number> = {
  source: 80,
  capability: 20,
  agent: 80,
  approval: 20,
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
      ...(node.capability !== undefined ? { capability: node.capability } : {}),
      ...(node.agent !== undefined ? { agent: node.agent } : {}),
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

export const summarizeWorkflowValidationHints = (
  model: WorkflowFlowModel,
): { readonly errors: number; readonly warnings: number } => {
  const hints = [
    ...model.nodes.flatMap((node) => node.data.validationHints),
    ...model.edges.flatMap((edge) => edge.data?.validationHints ?? []),
  ];

  return {
    errors: hints.filter((hint) => hint.severity === "error").length,
    warnings: hints.filter((hint) => hint.severity === "warning").length,
  };
};

export function WorkflowCanvas({
  nodes,
  edges,
}: {
  readonly nodes: readonly WorkflowTemplateNode[];
  readonly edges: readonly WorkflowTemplateEdge[];
}) {
  const flowNodes: Node[] = nodes.map((node) => ({
    id: node.id,
    position: { x: node.x, y: node.y },
    data: { label: `${node.kind}: ${node.label}` },
    type: "default",
  }));

  const flowEdges: Edge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: edge.label === "agent choice",
  }));

  return (
    <div className="workflow-canvas" aria-label="Workflow graph template">
      <ReactFlow fitView nodes={flowNodes} edges={flowEdges}>
        <Background />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function WorkflowGraphCanvas({
  graph,
  validationHints = [],
}: {
  readonly graph: DurableWorkflowGraphForCanvas;
  readonly validationHints?: readonly WorkflowValidationHint[];
}) {
  const model = deriveWorkflowFlowModel(graph, validationHints);

  return (
    <div className="workflow-canvas" aria-label="Workflow graph template">
      <ReactFlow fitView nodes={[...model.nodes]} edges={[...model.edges]}>
        <Background />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
