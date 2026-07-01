import {
  templateRegistry,
  validateTemplateRegistry,
  type CapabilityDefinition,
  type HeadlessSurface,
  type TemplateRegistry,
} from "@maestro-template/template-core";

export type HeadlessOperation = {
  readonly id: string;
  readonly surface: HeadlessSurface["name"];
  readonly capability: CapabilityDefinition["name"];
  readonly route: string;
  readonly authScope: string;
  readonly typedErrors: readonly string[];
};

export type ApiCatalogEntry = {
  readonly operationId: string;
  readonly method: "POST";
  readonly path: string;
  readonly authScope: string;
  readonly typedErrors: readonly string[];
};

export type McpToolEntry = {
  readonly name: string;
  readonly description: string;
  readonly typedErrors: readonly string[];
};

export const buildHeadlessOperations = (
  registry: TemplateRegistry = templateRegistry,
): readonly HeadlessOperation[] =>
  registry.headlessSurfaces.flatMap((surface) =>
    registry.capabilities.map((capability) => ({
      id: `${surface.name}:${capability.name}`,
      surface: surface.name,
      capability: capability.name,
      route: surface.route,
      authScope: capability.policy,
      typedErrors: capability.typedErrors,
    })),
  );

export const describeWorkflowTemplate = (
  registry: TemplateRegistry = templateRegistry,
) => {
  const validationErrors = validateTemplateRegistry(registry);

  return {
    valid: validationErrors.length === 0,
    validationErrors,
    nodeCount: registry.workflow.nodes.length,
    edgeCount: registry.workflow.edges.length,
    capabilityCount: registry.capabilities.length,
    agentCount: registry.agents.length,
    headlessOperationCount: buildHeadlessOperations(registry).length,
  };
};

export const getHeadlessOperation = (
  id: string,
  registry: TemplateRegistry = templateRegistry,
): HeadlessOperation | undefined =>
  buildHeadlessOperations(registry).find((operation) => operation.id === id);

export const buildApiCatalog = (
  registry: TemplateRegistry = templateRegistry,
): readonly ApiCatalogEntry[] =>
  buildHeadlessOperations(registry)
    .filter((operation) => operation.surface === "Scalar API")
    .map((operation) => ({
      operationId: operation.capability,
      method: "POST",
      path: `/api/${operation.capability}`,
      authScope: operation.authScope,
      typedErrors: operation.typedErrors,
    }));

export const buildMcpTools = (
  registry: TemplateRegistry = templateRegistry,
): readonly McpToolEntry[] =>
  buildHeadlessOperations(registry)
    .filter((operation) => operation.surface === "MCP")
    .map((operation) => ({
      name: `template.${operation.capability}`,
      description: `Invoke ${operation.capability} through the shared template registry.`,
      typedErrors: operation.typedErrors,
    }));
