import {
  createSampleWorkflowRunReceipt,
  templateRegistry,
} from "@maestro-template/template-core";
import {
  buildOpenApiDocument,
  openApiOperationMethods,
  type OpenApiDocument,
} from "@maestro-template/workflow-tooling";
import type { DurableWorkflowGraphForCanvas } from "@maestro-template/workflow-ui";

type OpenApiSummary = {
  readonly version: string;
  readonly operationCount: number;
  readonly docsRoute: string;
  readonly typedErrors: readonly string[];
  readonly authScope: string;
};

export const templateStats = templateRegistry.stats;
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

const buildOpenApiSummary = (
  document: OpenApiDocument,
  primaryOperationPath: string,
  docsRoute: string,
): OpenApiSummary => {
  const primaryOperation = document.paths[primaryOperationPath]?.post;
  const operationCount = Object.values(document.paths).reduce(
    (count, pathItem) =>
      count +
      openApiOperationMethods.filter((method) => pathItem[method] !== undefined)
        .length,
    0,
  );

  return {
    version: document.openapi,
    operationCount,
    docsRoute,
    typedErrors: primaryOperation?.["x-maestro-typed-errors"] ?? [],
    authScope: primaryOperation?.["x-maestro-auth-scope"] ?? "unknown",
  };
};

const scalarApiDocsRoute =
  headlessSurfaces.find((surface) => surface.name === "Scalar API")?.route ??
  "/api/docs";

export const openApiSummary = buildOpenApiSummary(
  openApiDocument,
  "/api/brain.pages.createMarkdown",
  scalarApiDocsRoute,
);
