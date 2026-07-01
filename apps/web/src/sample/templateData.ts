import type {
  WorkflowTemplateEdge,
  WorkflowTemplateNode,
} from "@maestro-template/workflow-ui";

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

export const stats = [
  { label: "Typed functions", value: "12", tone: "good" },
  { label: "Provider mode", value: "Fake/local", tone: "neutral" },
  { label: "Workflow gates", value: "Strict", tone: "good" },
  { label: "RAG default", value: "Off", tone: "warn" },
] as const;

export const workflowNodes: readonly WorkflowTemplateNode[] = [
  { id: "source", label: "Source Set", kind: "source", x: 0, y: 80 },
  {
    id: "context",
    label: "Build Context Pack",
    kind: "capability",
    x: 260,
    y: 20,
  },
  { id: "agent", label: "Planner Agent", kind: "agent", x: 520, y: 80 },
  { id: "approval", label: "Policy Approval", kind: "approval", x: 780, y: 20 },
  { id: "output", label: "Trust Receipt", kind: "output", x: 1040, y: 80 },
];

export const workflowEdges: readonly WorkflowTemplateEdge[] = [
  { id: "e1", source: "source", target: "context", label: "evidence" },
  { id: "e2", source: "context", target: "agent", label: "grounded pack" },
  { id: "e3", source: "agent", target: "approval", label: "agent choice" },
  { id: "e4", source: "approval", target: "output", label: "audited run" },
];

export const brainSources = [
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
] as const;

export const contextPacks = [
  "Customer-specific operating model",
  "Approved source quotes",
  "Policy snapshot and exclusions",
  "Output style and review criteria",
] as const;

export const capabilities = [
  {
    name: "resolveSourceSet",
    exposure: "web + headless",
    policy: "workspace member",
    description: "Turns markdown, links, and notes into a typed evidence view.",
  },
  {
    name: "buildContextPack",
    exposure: "workflow",
    policy: "agent grant",
    description:
      "Builds a bounded prompt context with citations and freshness.",
  },
  {
    name: "createTrustReceipt",
    exposure: "API + CLI",
    policy: "audited write",
    description: "Emits claim, source, model, policy, and workflow provenance.",
  },
] as const;

export const agents = [
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
] as const;

export const headlessSurfaces = [
  {
    name: "Scalar API",
    route: "/api/docs",
    contract: "Effect HTTP API with typed errors",
  },
  {
    name: "CLI",
    route: "maestro-template workflow run",
    contract: "@confect/js generated refs",
  },
  {
    name: "MCP",
    route: "template.workflow.describe",
    contract: "same headless registry as API",
  },
] as const;

export const providerAdapters = [
  { name: "WorkOS/AuthKit", mode: "fake + live", status: "planned" },
  { name: "PostHog", mode: "event contract", status: "guarded" },
  { name: "Dodo", mode: "billing fake first", status: "planned" },
  { name: "MailerSend", mode: "console + live", status: "planned" },
  { name: "OpenRouter", mode: "BYOK gateway", status: "planned" },
  { name: "Storage", mode: "signed URL policy", status: "guarded" },
] as const;

export const safetyChecklist = [
  "Tenant identity is server-derived, never caller-supplied.",
  "Runtime-authored capabilities are data, not arbitrary code.",
  "Provider/config errors are redacted before public boundaries.",
  "Generated Confect and Convex files are checked for drift.",
  "Source content cannot become agent instructions.",
  "Export/delete, support access, and billing changes are audited.",
] as const;
