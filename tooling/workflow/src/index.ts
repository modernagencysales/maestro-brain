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
