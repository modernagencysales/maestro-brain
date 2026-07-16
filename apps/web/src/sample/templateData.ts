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

export type StarterReadinessStatus = {
  readonly label: string;
  readonly state: "ready" | "generated" | "client-specific";
  readonly detail: string;
};

export type StarterProofPoint = {
  readonly label: string;
  readonly detail: string;
};

const starterStatus = (
  label: string,
  state: StarterReadinessStatus["state"],
  detail: string,
): StarterReadinessStatus => ({ label, state, detail });

const starterProofPoint = (
  label: string,
  detail: string,
): StarterProofPoint => ({ label, detail });

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
  docsRoute: string,
): OpenApiSummary => {
  const primaryOperation = Object.values(document.paths)
    .flatMap((pathItem) =>
      openApiOperationMethods.map((method) => pathItem[method]),
    )
    .find((operation) => operation !== undefined);
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
  scalarApiDocsRoute,
);

export const starterReadiness = {
  statuses: [
    starterStatus(
      "Hosted reference app",
      "ready",
      "The Cloudflare Pages reference app and local static build smoke prove the shell can be hosted.",
    ),
    starterStatus(
      "Fake provider mode",
      "ready",
      "WorkOS, PostHog, Dodo, email, LLM, and storage start in fake, console, or local mode.",
    ),
    starterStatus(
      "Generated headless surfaces",
      "ready",
      "OpenAPI, Scalar docs, CLI commands, and MCP tools project from the generated Confect manifest.",
    ),
    starterStatus(
      "Client fork packet",
      "generated",
      "The quickstart command writes the instance manifest, implementation brief, provider checklist, demo seed, and handoff packet.",
    ),
    starterStatus(
      "Live provider setup",
      "client-specific",
      "Live credentials, legal posture, retention, and production smoke belong to the client fork.",
    ),
  ] satisfies readonly StarterReadinessStatus[],
  dayZeroCommands: [
    'pnpm template:quickstart -- --blueprint source-grounded-gtm-brain --name "Client Brain" --write',
    "pnpm template:doctor -- --mode fake",
    "pnpm template:seed-demo -- --blueprint source-grounded-gtm-brain --write",
    "pnpm template:add-client-domain -- --name customerContext --write",
    "pnpm template:handoff -- --mode fake --write",
  ],
  proofPoints: [
    starterProofPoint(
      "Brain and source context",
      "Synthetic markdown, links, notes, and context packs show how client knowledge enters the app.",
    ),
    starterProofPoint(
      "Workflow graph and receipt",
      "The durable workflow graph and trust receipt show how source-backed work is executed and audited.",
    ),
    starterProofPoint(
      "API / CLI / MCP registry",
      "The same typed operation appears in API docs, CLI commands, MCP tools, and web routes.",
    ),
    starterProofPoint(
      "Provider posture",
      "Fake/test/live-ready provider adapters make demos safe before live secrets are approved.",
    ),
    starterProofPoint(
      "Security and CI gates",
      "Secret scanning, layer boundaries, Confect contracts, generated-file checks, and hosted smoke keep forks honest.",
    ),
  ] satisfies readonly StarterProofPoint[],
} as const;
