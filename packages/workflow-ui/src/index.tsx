import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import {
  deriveWorkflowFlowModel,
  type DurableWorkflowGraphForCanvas,
  type WorkflowFlowEdge,
  type WorkflowFlowNode,
  type WorkflowValidationHint,
} from "./workflowCanvasState";

export {
  applyStatusOverlay,
  deriveWorkflowCanvasView,
  deriveWorkflowFlowModel,
  mapStageRunsToOverlay,
  mapWorkflowStageStatus,
  summarizeWorkflowValidationHints,
} from "./workflowCanvasState";

export type {
  DurableWorkflowGraphForCanvas,
  WorkflowCanvasView,
  WorkflowFlowEdge,
  WorkflowFlowEdgeData,
  WorkflowFlowModel,
  WorkflowFlowNode,
  WorkflowFlowNodeData,
  WorkflowFlowValidationHint,
  WorkflowNodeKind,
  WorkflowNodeStatus,
  WorkflowNodeStatusOverlay,
  WorkflowStageKeyMap,
  WorkflowStageRunForCanvas,
  WorkflowStageStatus,
  WorkflowValidationHint,
} from "./workflowCanvasState";

export type WorkflowTemplateNode = {
  readonly id: string;
  readonly label: string;
  readonly kind:
    "source" | "capability" | "agent" | "approval" | "delay" | "output";
  readonly x: number;
  readonly y: number;
};

export type WorkflowTemplateEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
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
  const flowNodes: Node[] = model.nodes.map(toReactFlowNode);
  const flowEdges: Edge[] = model.edges.map(toReactFlowEdge);

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

const toReactFlowNode = (node: WorkflowFlowNode): Node => ({
  id: node.id,
  position: node.position,
  data: { ...node.data },
  type: node.type,
});

const toReactFlowEdge = (edge: WorkflowFlowEdge): Edge => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  label: edge.label,
  animated: edge.animated,
  data: { ...edge.data },
});
