import {
  createSampleWorkflowRunReceipt,
  validateTemplateRegistry,
  type TemplateRegistry,
  type WorkflowRunReceipt,
} from "@maestro-template/template-core";

const defaultWorkflowRegistry = {
  stats: [],
  brainSources: [
    {
      title: "Founder interview notes",
      kind: "markdown",
      freshness: "fresh",
      evidence: "12 grounded claims",
    },
    {
      title: "Product docs and policies",
      kind: "link set",
      freshness: "review due",
      evidence: "8 cited constraints",
    },
    {
      title: "Implementation preferences",
      kind: "note",
      freshness: "fresh",
      evidence: "5 reusable rules",
    },
  ],
  contextPacks: [
    "Customer-specific operating model",
    "Approved source quotes",
    "Policy snapshot and exclusions",
    "Output style and review criteria",
  ],
  capabilities: [
    {
      name: "resolveSourceSet",
      exposure: "web + headless",
      policy: "workspace member",
      description: "Generated source set resolver contract.",
      typedErrors: ["Unauthorized", "WorkspaceNotFound", "ValidationFailed"],
    },
    {
      name: "buildContextPack",
      exposure: "workflow",
      policy: "agent grant",
      description: "Generated context pack builder contract.",
      typedErrors: ["Forbidden", "NotFound", "FeatureDisabled"],
    },
    {
      name: "createTrustReceipt",
      exposure: "API + CLI",
      policy: "audited write",
      description: "Generated trust receipt contract.",
      typedErrors: ["Unauthorized", "ConfigInvalid", "ValidationFailed"],
    },
    {
      name: "sourceGroundedBrief",
      exposure: "API + CLI",
      policy: "workspace member",
      description: "Generated source-grounded brief contract.",
      typedErrors: ["Unauthenticated", "NoWorkspaceAccess", "ValidationFailed"],
    },
  ],
  agents: [
    {
      name: "Planner Agent",
      grants: "workflow.compose, capability.request",
      guardrail: "cannot publish or spend",
    },
    {
      name: "Research Agent",
      grants: "brain.read, source.resolve",
      guardrail: "source content is data, not instructions",
    },
    {
      name: "Operator Agent",
      grants: "run.inspect, notification.draft",
      guardrail: "approval required for external side effects",
    },
  ],
  workflow: {
    nodes: [
      { id: "source", label: "Source Set", kind: "source", x: 0, y: 80 },
      {
        id: "context",
        label: "Build Context Pack",
        kind: "capability",
        x: 260,
        y: 20,
      },
      { id: "agent", label: "Planner Agent", kind: "agent", x: 520, y: 80 },
      {
        id: "approval",
        label: "Policy Approval",
        kind: "approval",
        x: 780,
        y: 20,
      },
      {
        id: "output",
        label: "Trust Receipt",
        kind: "output",
        x: 1040,
        y: 80,
      },
    ],
    edges: [
      { id: "e1", source: "source", target: "context", label: "evidence" },
      {
        id: "e2",
        source: "context",
        target: "agent",
        label: "grounded pack",
      },
      { id: "e3", source: "agent", target: "approval", label: "agent choice" },
      {
        id: "e4",
        source: "approval",
        target: "output",
        label: "audited run",
      },
    ],
  },
  headlessSurfaces: [
    {
      name: "Scalar API",
      route: "/api/docs",
      contract: "generated Confect manifest",
    },
  ],
  providerAdapters: [
    { name: "WorkOS/AuthKit", mode: "fake + live", status: "planned" },
  ],
  safetyChecklist: [],
} as const satisfies TemplateRegistry;

export const describeDefaultWorkflow = (
  capabilityCount: number,
  headlessOperationCount: number,
) => {
  const validationErrors = validateTemplateRegistry(defaultWorkflowRegistry);

  return {
    valid: validationErrors.length === 0,
    validationErrors,
    nodeCount: defaultWorkflowRegistry.workflow.nodes.length,
    edgeCount: defaultWorkflowRegistry.workflow.edges.length,
    capabilityCount,
    agentCount: defaultWorkflowRegistry.agents.length,
    headlessOperationCount,
  };
};

export const describeWorkflowRegistry = (
  registry: TemplateRegistry,
  capabilityCount: number,
  headlessOperationCount: number,
) => {
  const validationErrors = validateTemplateRegistry(registry);

  return {
    valid: validationErrors.length === 0,
    validationErrors,
    nodeCount: registry.workflow.nodes.length,
    edgeCount: registry.workflow.edges.length,
    capabilityCount,
    agentCount: registry.agents.length,
    headlessOperationCount,
  };
};

export const runDefaultWorkflow = (): WorkflowRunReceipt =>
  createSampleWorkflowRunReceipt(defaultWorkflowRegistry);

export const runWorkflowRegistry = (
  registry: TemplateRegistry,
): WorkflowRunReceipt => createSampleWorkflowRunReceipt(registry);
