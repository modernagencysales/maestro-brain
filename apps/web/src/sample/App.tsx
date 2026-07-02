import { useEffect, useState } from "react";
import {
  NotionDocumentPage,
  TemplateLiveRegion,
  TemplateNetworkBanner,
  TemplateSkipLink,
  TemplateToastProvider,
  TemplateWorkspaceShell,
  type NotionDocumentPageModel,
} from "@maestro-template/ui";
import {
  WorkflowCanvas,
  WorkflowGraphCanvas,
} from "@maestro-template/workflow-ui";
import type {
  DurableWorkflowGraphForCanvas,
  WorkflowTemplateEdge,
  WorkflowTemplateNode,
} from "@maestro-template/workflow-ui";
import { TEMPLATE_NAV_CATEGORIES } from "../navigation/workspace";
import {
  buildBrainDocumentSections,
  createBrainContextPackPreview,
} from "../features/brain/brain-surface";
import {
  buildOnboardingDocumentSections,
  buildProviderSetupDocumentSections,
} from "../features/setup/setup-surface";
import { LiveWorkflowRunsPanel } from "../features/workflows/live-runs-panel";
import {
  buildWorkflowRunDocumentSections,
  reduceFakeWorkflowRunCommand,
} from "../features/workflows/workflow-surface";
import {
  agents,
  brainSources,
  capabilities,
  contextPacks,
  durableWorkflowGraph,
  headlessSurfaces,
  navItems,
  openApiSummary,
  providerAdapters,
  sampleRunReceipt,
  safetyChecklist,
  stats,
} from "./templateData";

type Diagram = {
  readonly label: string;
  readonly nodes?: readonly WorkflowTemplateNode[];
  readonly edges?: readonly WorkflowTemplateEdge[];
  readonly graph?: DurableWorkflowGraphForCanvas;
};

type DocumentPage = {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly intro: string;
  readonly diagram?: Diagram;
  readonly sections: readonly {
    readonly heading: string;
    readonly body: readonly string[];
  }[];
};

type RenderedDocumentPage = Omit<DocumentPage, "diagram"> &
  Pick<NotionDocumentPageModel, "diagram" | "diagramLabel">;

const overviewDiagram: Diagram = {
  label: "Template operating model",
  nodes: [
    {
      id: "customer-context",
      label: "Customer knowledge",
      kind: "source",
      x: 0,
      y: 70,
    },
    {
      id: "brain-context",
      label: "Reusable Brain",
      kind: "capability",
      x: 230,
      y: 70,
    },
    {
      id: "workflow-plan",
      label: "Workflow",
      kind: "approval",
      x: 460,
      y: 70,
    },
    {
      id: "agent-work",
      label: "Agent + capabilities",
      kind: "agent",
      x: 690,
      y: 70,
    },
    {
      id: "business-output",
      label: "Useful business output",
      kind: "output",
      x: 920,
      y: 70,
    },
  ],
  edges: [
    {
      id: "context-to-brain",
      source: "customer-context",
      target: "brain-context",
    },
    {
      id: "brain-to-workflow",
      source: "brain-context",
      target: "workflow-plan",
    },
    { id: "workflow-to-agent", source: "workflow-plan", target: "agent-work" },
    { id: "agent-to-output", source: "agent-work", target: "business-output" },
  ],
};

const brainDiagram: Diagram = {
  label: "Brain context path",
  nodes: [
    {
      id: "raw-sources",
      label: "Links, notes, docs",
      kind: "source",
      x: 0,
      y: 80,
    },
    {
      id: "source-set",
      label: "Approved source set",
      kind: "approval",
      x: 250,
      y: 80,
    },
    {
      id: "context-pack",
      label: "Context pack",
      kind: "capability",
      x: 500,
      y: 80,
    },
    {
      id: "agent-ready",
      label: "Agent-ready brief",
      kind: "output",
      x: 750,
      y: 80,
    },
  ],
  edges: [
    { id: "raw-to-set", source: "raw-sources", target: "source-set" },
    { id: "set-to-pack", source: "source-set", target: "context-pack" },
    { id: "pack-to-brief", source: "context-pack", target: "agent-ready" },
  ],
};

const surfaceDiagram: Diagram = {
  label: "One operation registry, many surfaces",
  nodes: [
    {
      id: "registry",
      label: "Typed operation registry",
      kind: "capability",
      x: 280,
      y: 20,
    },
    { id: "web", label: "Web app", kind: "output", x: 0, y: 160 },
    { id: "api", label: "API + Scalar docs", kind: "output", x: 220, y: 160 },
    { id: "cli", label: "CLI", kind: "output", x: 440, y: 160 },
    { id: "mcp", label: "MCP tools", kind: "output", x: 660, y: 160 },
  ],
  edges: [
    { id: "registry-web", source: "registry", target: "web" },
    { id: "registry-api", source: "registry", target: "api" },
    { id: "registry-cli", source: "registry", target: "cli" },
    { id: "registry-mcp", source: "registry", target: "mcp" },
  ],
};

const overviewPage: DocumentPage = {
  id: "overview",
  eyebrow: "Private AI app factory",
  title: "A reusable foundation for custom AI implementation work",
  intro:
    "Maestro Template is the internal starting point for client-specific AI apps. It lets us start from a proven Brain, workflow, agent, integration, and safety model instead of rebuilding the same platform scaffolding for every engagement.",
  diagram: overviewDiagram,
  sections: [
    {
      heading: "What an investor should see",
      body: [
        "This is leverage. The repo packages repeatable delivery assets: a hosted app shell, typed backend contracts, workflow and capability primitives, provider adapters, API/CLI/MCP surfaces, and release gates.",
        "It also lowers execution risk. A new client app can begin from working code, tests, docs, and deployment paths rather than a blank editor and a pile of one-off decisions.",
      ],
    },
    {
      heading: "What a GTM operator should see",
      body: [
        "This is a way to turn customer context into useful AI behavior. The Brain organizes what the business knows, workflows describe what should happen, capabilities do the work, and agents choose or compose the next step inside clear guardrails.",
        "The pages in the sidebar walk through that path in order: Brain, Workflows, Capabilities, Agents, API / CLI / MCP, Integrations, and Safety.",
      ],
    },
    {
      heading: "Technical proof",
      body: [
        `The sample tracks ${stats.length} health signals across typed functions, provider posture, workflow gates, and grounded context.`,
        "The template is intentionally generic: it keeps the reusable machinery while leaving client-specific business logic out.",
      ],
    },
  ],
};

const brainContextPack = createBrainContextPackPreview(contextPacks);
const workflowRunSections = buildWorkflowRunDocumentSections(sampleRunReceipt);
const fakeWorkflowRun = reduceFakeWorkflowRunCommand({
  type: "trigger_fake_workflow_run",
  workspaceSlug: sampleRunReceipt.workspaceSlug,
  workflowId: sampleRunReceipt.workflowId,
  requestedBy: "operator@example.test",
});
const providerSetupSections =
  buildProviderSetupDocumentSections(providerAdapters);
const onboardingSections = buildOnboardingDocumentSections();

const pages: readonly DocumentPage[] = [
  overviewPage,
  {
    id: "brain",
    eyebrow: "Context layer",
    title: "The Brain turns company knowledge into usable AI context",
    intro:
      "For a client, the Brain is the place where sales calls, website pages, positioning notes, links, markdown, and operating knowledge become organized context that an AI system can safely use.",
    diagram: brainDiagram,
    sections: buildBrainDocumentSections({
      sources: brainSources,
      contextPack: brainContextPack,
    }),
  },
  {
    id: "workflows",
    eyebrow: "Composition layer",
    title: "Workflows turn AI ideas into repeatable business processes",
    intro:
      "A workflow is the recipe for getting from customer context to a useful outcome: research, qualification, drafting, routing, enrichment, approval, follow-up, or anything else the client needs to repeat.",
    diagram: {
      label: "Workflow graph template",
      graph: durableWorkflowGraph,
    },
    sections: [
      {
        heading: "How to explain it",
        body: [
          "A non-technical stakeholder can think of this as an operating procedure with AI inside it. The workflow says what information is needed, which steps can be automated, where approval is required, and what output should be produced.",
          "This is why the React Flow implementation matters. It gives clients a visual way to understand and eventually author the process without reading code.",
        ],
      },
      {
        heading: "Technical proof",
        body: [
          "The sample flow resolves a source set, builds a context pack, grants an agent narrow access, records approval, and produces a trust receipt.",
          "Durable workflow behavior should stay in typed workflow metadata and Confect/Effect contracts. React Flow is the authoring and inspection layer, not the only source of truth.",
        ],
      },
      {
        heading: "Fake/local run trigger",
        body: [
          `Run command: \`${fakeWorkflowRun.commandLine}\`.`,
          `Mode: ${fakeWorkflowRun.mode}.`,
          `Audit trail: ${fakeWorkflowRun.auditLine}.`,
        ],
      },
      ...workflowRunSections,
    ],
  },
  {
    id: "capabilities",
    eyebrow: "Execution units",
    title: "Capabilities are the safe actions the system can perform",
    intro:
      "A capability is one thing the app knows how to do: create a trust receipt, search approved context, draft a message, call a provider, enrich a record, or trigger a downstream process.",
    sections: [
      {
        heading: "Why this matters",
        body: [
          "This keeps custom apps modular. When a client needs a new business action, we add a capability instead of rewriting the whole application.",
          "It also makes AI safer. Agents do not get vague, unlimited power. They request specific capabilities with clear inputs, outputs, policies, and audit trails.",
        ],
      },
      {
        heading: "Sample capabilities",
        body: capabilities.map(
          (capability) =>
            `**${capability.name}**: ${capability.description} It is available through ${capability.exposure} and protected by ${capability.policy}.`,
        ),
      },
      {
        heading: "Technical proof",
        body: [
          "Reviewed runtime-authored capabilities can be promoted into generated Confect source when compile-time guarantees matter.",
          "Each capability should return typed results or typed failures so the app can handle success, policy denial, provider errors, and validation errors deliberately.",
        ],
      },
    ],
  },
  {
    id: "agents",
    eyebrow: "Actor layer",
    title: "Agents make choices, but only inside boundaries",
    intro:
      "An agent is the part of the system that can reason, choose a next step, and compose workflows or capabilities. The template treats agents as useful but bounded actors, not unchecked automation.",
    sections: [
      {
        heading: "What this means in practice",
        body: [
          "A planner agent can decide which workflow fits a request.",
          "A research agent can read approved Brain sources and produce a grounded brief.",
          "An operator agent can inspect runs and draft notifications, while approvals remain required before external side effects.",
        ],
      },
      {
        heading: "Technical proof",
        body: [
          ...agents.map(
            (agent) =>
              `**${agent.name}** receives these grants: ${agent.grants}.`,
          ),
          "Source content is data, not instructions.",
          "Agent grants are explicit.",
          "Capability calls are auditable.",
        ],
      },
    ],
  },
  {
    id: "headless",
    eyebrow: "Surface layer",
    title: "One operation can show up in the app, API, CLI, MCP, and docs",
    intro:
      "The same business operation should not be rebuilt five times. The template keeps a shared registry that can power the web app, external API, internal CLI, MCP tools for agents, and Scalar API documentation.",
    diagram: surfaceDiagram,
    sections: [
      {
        heading: "Why this matters",
        body: [
          "For investors, this is delivery leverage: one well-typed operation can become several useful product surfaces.",
          "For GTM teams, this means the same customer workflow can be used by humans in the app, by operators in the CLI, by integrations through the API, and by AI tools through MCP.",
        ],
      },
      {
        heading: "Available surfaces",
        body: headlessSurfaces.map(
          (surface) =>
            `**${surface.name}** is available at \`${surface.route}\` and uses ${surface.contract}.`,
        ),
      },
      {
        heading: "Technical proof",
        body: [
          `The sample OpenAPI document is ${openApiSummary.version}.`,
          `It exposes ${openApiSummary.operationCount} generated operations and documents typed errors: ${openApiSummary.typedErrors.join(", ")}.`,
          `Scalar docs are mounted at \`${openApiSummary.docsRoute}\`.`,
        ],
      },
    ],
  },
  {
    id: "onboarding",
    eyebrow: "Client quickstart",
    title: "Onboarding turns the template into a client app",
    intro:
      "This is the operator checklist for turning the internal factory into a useful AI/GTM implementation for a specific B2B company.",
    sections: onboardingSections,
  },
  {
    id: "integrations",
    eyebrow: "Provider layer",
    title: "Integrations are swappable instead of tangled into the app",
    intro:
      "Client work almost always needs identity, analytics, email, billing, data storage, model providers, or third-party systems. The template keeps those providers behind adapters so each client can use the right tools without changing the core architecture.",
    sections: [
      {
        heading: "Why this matters",
        body: [
          "The app can run in demo, diligence, and test modes without live client secrets.",
          "When a client implementation begins, fake layers can be replaced with live SDK-backed layers one provider at a time.",
        ],
      },
      {
        heading: "Current provider map",
        body: providerAdapters.map(
          (adapter) =>
            `**${adapter.name}** uses ${adapter.mode} mode and is currently marked ${adapter.status}.`,
        ),
      },
      {
        heading: "Technical proof",
        body: [
          "Provider payloads should be redacted before crossing public boundaries.",
          "Client forks replace deterministic receipts with SDK-backed calls when live setup begins.",
        ],
      },
    ],
  },
  {
    id: "settings",
    eyebrow: "Workspace operations",
    title: "Settings make the fork operational without live secrets",
    intro:
      "Settings should give the implementation team a clear view of workspace identity, members, provider posture, notification readiness, billing posture, and deploy readiness.",
    sections: providerSetupSections,
  },
  {
    id: "billing",
    eyebrow: "Commercial layer",
    title: "Billing starts fake and becomes live after signoff",
    intro:
      "Client demos and diligence should not need live payment secrets. The template starts with deterministic billing posture, then swaps in Dodo when sandbox and production setup are approved.",
    sections: [
      {
        heading: "Dodo posture",
        body: [
          "**Dodo** starts in billing fake first mode so demos and tests do not need live payment secrets.",
          "The live adapter should only be enabled after sandbox checkout, webhook, credit accounting, and support/refund runbooks are signed off.",
        ],
      },
      {
        heading: "Credits and spend",
        body: [
          "Credits, model spend, and provider caps should be visible to admins before any paid workflow can run.",
          "Provider failures should produce redacted typed errors rather than leaking billing or API details to users.",
        ],
      },
      {
        heading: "Launch proof",
        body: [
          "A client fork should preserve fake receipts for tests and add live Dodo smoke evidence before production promotion.",
          `The sample workflow already produces \`${sampleRunReceipt.trustReceiptId}\` so billing and workflow proof can be inspected separately.`,
        ],
      },
    ],
  },
  {
    id: "safety",
    eyebrow: "Safety layer",
    title: "Safety is built into the delivery model",
    intro:
      "The template is meant for real client work, not a toy demo. It assumes tenant boundaries, provider secrets, prompt injection, auditability, approvals, and production release discipline matter from the beginning.",
    sections: [
      {
        heading: "Why this matters",
        body: [
          "Investors should see that this is not just a UI prototype. It is a delivery framework with risk controls.",
          "GTM operators should see that the system can explain what happened, what sources were used, which policy applied, and where human approval was required.",
        ],
      },
      {
        heading: "Default rules",
        body: safetyChecklist.map((item) => `- ${item}`),
      },
      {
        heading: "Technical proof",
        body: [
          `The sample run \`${sampleRunReceipt.workflowRunId}\` mirrors the persisted workflow run shape and produces \`${sampleRunReceipt.trustReceiptId}\`.`,
          `Its Trust Receipt pins \`${sampleRunReceipt.trustReceipt.policySnapshotId}\`, \`${sampleRunReceipt.trustReceipt.modelReceiptId}\`, and the \`${sampleRunReceipt.trustReceipt.trustClaim}\` posture.`,
          sampleRunReceipt.trustReceipt.claim,
        ],
      },
    ],
  },
] as const;

const pageById = new Map(pages.map((page) => [page.id, page]));
const samplePageKeyByRouteKey = new Map<string, string>([
  ["home", "overview"],
  ["brain", "brain"],
  ["workflows", "workflows"],
  ["capabilities", "capabilities"],
  ["agents", "agents"],
  ["api", "headless"],
  ["onboarding", "onboarding"],
  ["integrations", "integrations"],
  ["settings", "settings"],
  ["billing", "billing"],
  ["health", "safety"],
  ["admin", "safety"],
]);
const sampleRouteKeyByPageId = new Map(
  [...samplePageKeyByRouteKey.entries()].map(([key, value]) => [value, key]),
);
const sampleNavigation = TEMPLATE_NAV_CATEGORIES.map((category) => ({
  ...category,
  items: category.items.map((item) => ({
    key: item.key,
    label: item.key === "health" ? "Safety" : item.label,
    icon: item.icon,
    href: `#${samplePageKeyByRouteKey.get(item.key) ?? item.key}`,
    ...(item.key === "api" ? { hint: "Scalar" } : {}),
  })),
}));
const samplePageIdFromHash = () => {
  if (typeof window === "undefined") {
    return navItems[0]?.id ?? "overview";
  }

  const hash = window.location.hash.replace(/^#/, "");

  return pageById.has(hash) ? hash : (navItems[0]?.id ?? "overview");
};

const renderPage = (page: DocumentPage): RenderedDocumentPage => {
  const { diagram, ...documentPage } = page;

  if (!diagram) {
    return documentPage;
  }

  return {
    ...documentPage,
    diagramLabel: diagram.label,
    diagram: diagram.graph ? (
      <WorkflowGraphCanvas graph={diagram.graph} />
    ) : (
      <WorkflowCanvas nodes={diagram.nodes ?? []} edges={diagram.edges ?? []} />
    ),
  };
};

export function App() {
  const [activeNavId, setActiveNavId] = useState<string>(samplePageIdFromHash);
  const activePage = pageById.get(activeNavId) ?? overviewPage;
  const activeRouteKey = sampleRouteKeyByPageId.get(activePage.id) ?? "home";

  useEffect(() => {
    const handleHashChange = () => {
      setActiveNavId(samplePageIdFromHash());
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return (
    <>
      <TemplateSkipLink />
      <TemplateLiveRegion
        message={`Viewing ${activePage.id === "overview" ? "Overview" : activePage.title}`}
      />
      <TemplateNetworkBanner state="online" />
      <TemplateToastProvider>
        <TemplateWorkspaceShell
          title="Maestro Template"
          subtitle="Private AI app factory"
          navigation={sampleNavigation}
          activeKey={activeRouteKey}
          topbarTitle={activePage.title}
          onNavigate={(key) => {
            const pageId = samplePageKeyByRouteKey.get(key) ?? "overview";

            setActiveNavId(pageId);
          }}
        >
          <NotionDocumentPage page={renderPage(activePage)} />
          {/* Sibling of .notion-page on purpose: the visual baseline
              screenshots the document element, and live data must never
              shift a pinned screenshot. */}
          {activePage.id === "workflows" ? <LiveWorkflowRunsPanel /> : null}
        </TemplateWorkspaceShell>
      </TemplateToastProvider>
    </>
  );
}
