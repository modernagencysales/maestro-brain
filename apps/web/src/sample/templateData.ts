import {
  createSampleWorkflowRunReceipt,
  templateRegistry,
} from "@maestro-template/template-core";
import { buildOpenApiDocument } from "@maestro-template/workflow-tooling";
import type { DurableWorkflowGraphForCanvas } from "@maestro-template/workflow-ui";

export const navItems = [
  { id: "overview", label: "Overview", icon: "O", active: true },
  { id: "brain", label: "Brain", icon: "B" },
  { id: "workflows", label: "Workflows", icon: "W" },
  { id: "capabilities", label: "Capabilities", icon: "C" },
  { id: "agents", label: "Agents", icon: "A" },
  { id: "headless", label: "API / CLI / MCP", icon: "/" },
  { id: "integrations", label: "Integrations", icon: "I" },
  { id: "safety", label: "Safety", icon: "S" },
] as const;

export const stats = templateRegistry.stats;
export const workflowNodes = templateRegistry.workflow.nodes;
export const workflowEdges = templateRegistry.workflow.edges;
export const durableWorkflowGraph: DurableWorkflowGraphForCanvas = {
  id: "workflow_source_grounded_plan",
  version: 1,
  startNodeId: "source",
  nodes: templateRegistry.workflow.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    kind: node.kind,
    ...(node.id === "source" ? { capability: "resolveSourceSet" } : {}),
    ...(node.id === "context" ? { capability: "buildContextPack" } : {}),
    ...(node.id === "agent" ? { agent: "Planner Agent" } : {}),
    ...(node.id === "output" ? { capability: "createTrustReceipt" } : {}),
    retry: { maxAttempts: 1, backoffMs: 0 },
  })),
  edges: templateRegistry.workflow.edges.map((edge) => ({
    id: edge.id,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    ...(edge.label === "agent choice"
      ? { condition: { expression: "result.status == 'ready'" } }
      : {}),
  })),
  joins: [],
};
export const brainSources = templateRegistry.brainSources;
export const contextPacks = templateRegistry.contextPacks;
export const capabilities = templateRegistry.capabilities;
export const agents = templateRegistry.agents;
export const headlessSurfaces = templateRegistry.headlessSurfaces;
export const providerAdapters = templateRegistry.providerAdapters;
export const safetyChecklist = templateRegistry.safetyChecklist;
export const sampleRunReceipt =
  createSampleWorkflowRunReceipt(templateRegistry);
export const openApiDocument = buildOpenApiDocument(templateRegistry);
export const openApiSummary = {
  version: openApiDocument.openapi,
  operationCount: Object.keys(openApiDocument.paths).length,
  docsRoute:
    templateRegistry.headlessSurfaces.find(
      (surface) => surface.name === "Scalar API",
    )?.route ?? "/api/docs",
  typedErrors:
    openApiDocument.paths["/api/createTrustReceipt"]?.post[
      "x-maestro-typed-errors"
    ] ?? [],
  authScope:
    openApiDocument.paths["/api/createTrustReceipt"]?.post[
      "x-maestro-auth-scope"
    ] ?? "unknown",
} as const;
