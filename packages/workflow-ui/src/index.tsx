import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

export type WorkflowTemplateNode = {
  readonly id: string;
  readonly label: string;
  readonly kind: "source" | "capability" | "agent" | "approval" | "output";
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
