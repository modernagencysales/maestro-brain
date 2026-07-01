import {
  createSampleWorkflowRunReceipt,
  templateRegistry,
} from "@maestro-template/template-core";

export const navItems = [
  { id: "overview", label: "Overview", active: true },
  { id: "brain", label: "Brain" },
  { id: "workflows", label: "Workflows" },
  { id: "capabilities", label: "Capabilities" },
  { id: "agents", label: "Agents" },
  { id: "headless", label: "API / CLI / MCP" },
  { id: "integrations", label: "Integrations" },
  { id: "safety", label: "Safety" },
] as const;

export const stats = templateRegistry.stats;
export const workflowNodes = templateRegistry.workflow.nodes;
export const workflowEdges = templateRegistry.workflow.edges;
export const brainSources = templateRegistry.brainSources;
export const contextPacks = templateRegistry.contextPacks;
export const capabilities = templateRegistry.capabilities;
export const agents = templateRegistry.agents;
export const headlessSurfaces = templateRegistry.headlessSurfaces;
export const providerAdapters = templateRegistry.providerAdapters;
export const safetyChecklist = templateRegistry.safetyChecklist;
export const sampleRunReceipt =
  createSampleWorkflowRunReceipt(templateRegistry);
