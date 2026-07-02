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
    "Maestro Template is the starting point for every client-specific AI app we build. Instead of beginning an engagement from a blank repository, we begin from a working product: a company Brain, workflows, agents, integrations, and safety rails that have already been built, tested, and deployed once.",
  diagram: overviewDiagram,
  sections: [
    {
      heading: "What an investor should see",
      body: [
        "This is leverage. Every engagement reuses the same delivery assets: a hosted app, a type-checked backend, workflow and approval machinery, provider integrations, API and docs surfaces, and an automated release pipeline.",
        "It also lowers execution risk. A new client app starts from code that already runs in production — with tests, documentation, and deployment in place — instead of an empty editor and a hundred unmade decisions.",
      ],
    },
    {
      heading: "What a GTM operator should see",
      body: [
        "This is how customer knowledge becomes useful AI behavior. The Brain organizes what the business knows. Workflows describe what should happen, and in what order. Capabilities do the actual work. Agents choose the next step — always inside clear guardrails.",
        "The sidebar walks that path in order: Brain, Workflows, Capabilities, Agents, then the surfaces and safeguards built around them.",
      ],
    },
    {
      heading: "Technical proof",
      body: [
        `This demo tracks ${stats.length} live health signals covering the backend, provider readiness, workflow gates, and grounded context.`,
        "Everything client-specific is deliberately left out: the machinery is reusable, the business logic is yours.",
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
      "The Brain is where a client's knowledge — sales calls, website pages, positioning notes, documents — is organized into context an AI system can safely use. Nothing the AI says has to come from thin air; it comes from here.",
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
      "A workflow is a recipe the business can repeat: research an account, qualify a lead, draft an update, route a request for approval. It spells out the steps; AI does the heavy lifting inside them.",
    diagram: {
      label: "Workflow graph template",
      graph: durableWorkflowGraph,
    },
    sections: [
      {
        heading: "How to explain it",
        body: [
          "Think of it as a standard operating procedure with AI inside. The workflow states what information is needed, which steps run automatically, where a human must approve, and what gets produced at the end.",
          "The visual canvas above is the point: clients can see, question, and eventually edit their own processes without reading code.",
        ],
      },
      {
        heading: "Technical proof",
        body: [
          "The sample flow gathers approved sources, packages them into context, lets an agent plan, records a human approval, and finishes with a trust receipt — a permanent record of what was done and on what evidence.",
          "The diagram is a view of the process, not the process itself. The real workflow lives in the backend with type-checked steps, so what runs is always exactly what was approved.",
        ],
      },
      {
        heading: "Try it without live credentials",
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
      "A capability is one concrete thing the app knows how to do: search approved context, draft a message, create a trust receipt, update a record. Big outcomes are composed from small, safe actions.",
    sections: [
      {
        heading: "Why this matters",
        body: [
          "When a client needs something new, we add one capability — we do not rewrite the application.",
          "It also keeps AI safe. Agents never get vague, unlimited power: they request specific capabilities, each with defined inputs, outputs, permissions, and an audit trail.",
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
          "Every capability answers with either a typed result or a typed failure, so the app responds deliberately to success, permission denials, provider outages, and bad input — nothing surfaces as a mystery error.",
          "Capabilities sketched at runtime can be promoted into reviewed, generated source code once they prove out — gaining compile-time guarantees.",
        ],
      },
    ],
  },
  {
    id: "agents",
    eyebrow: "Actor layer",
    title: "Agents make choices, but only inside boundaries",
    intro:
      "An agent is the part of the system that reasons: it looks at a request, picks the right workflow or capability, and composes the next step. The template treats agents as valuable but bounded — they act inside explicit permissions, never around them.",
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
              `**${agent.name}** is allowed exactly this, and nothing else: ${agent.grants}.`,
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
      "Build a business operation once and it shows up everywhere it is needed: the web app, the external API, the command line, AI tool integrations (MCP), and always-current API documentation. Nothing is rebuilt five times, so nothing drifts out of sync.",
    diagram: surfaceDiagram,
    sections: [
      {
        heading: "Why this matters",
        body: [
          "For investors: one well-defined operation becomes five product surfaces. That is delivery leverage.",
          "For GTM teams: the same workflow a person runs in the app can be triggered by an integration through the API, by an operator from the command line, or by an AI assistant through MCP — same rules, same audit trail.",
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
      "The step-by-step checklist for turning this template into a specific client's app — from first workspace to a working, branded implementation.",
    sections: onboardingSections,
  },
  {
    id: "integrations",
    eyebrow: "Provider layer",
    title: "Integrations are swappable instead of tangled into the app",
    intro:
      "Client work always touches other systems: identity, analytics, email, billing, storage, AI models. The template keeps every provider behind a clean adapter, so each client can use the right tools — and swap them later — without touching the core product.",
    sections: [
      {
        heading: "Why this matters",
        body: [
          "The app runs fully in demo mode with no live credentials, so evaluations and diligence never require client secrets.",
          "When an engagement goes live, providers are switched on one at a time — each a deliberate, reviewed step instead of a tangle to unpick later.",
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
          "Anything a provider sends back is scrubbed of sensitive detail before it can reach logs or screens.",
          "Swapping the demo version of a provider for the live one is a contained change — the rest of the app does not know the difference.",
        ],
      },
    ],
  },
  {
    id: "settings",
    eyebrow: "Workspace operations",
    title: "Settings make the fork operational without live secrets",
    intro:
      "Settings give the implementation team one honest view of the workspace: who is in it, which providers are live versus demo, whether notifications and billing are ready, and how close the app is to deployable.",
    sections: providerSetupSections,
  },
  {
    id: "billing",
    eyebrow: "Commercial layer",
    title: "Billing starts fake and becomes live after signoff",
    intro:
      "Demos and evaluations never require a live payment provider. Billing starts in a predictable demo mode and switches to the real provider (Dodo) only after checkout, webhooks, and refund runbooks have been signed off.",
    sections: [
      {
        heading: "Dodo posture",
        body: [
          "**Dodo** starts in billing fake first mode, so demos and tests never touch real payment credentials.",
          "The live connection is enabled only after sandbox checkout, webhook handling, credit accounting, and the support/refund playbook have each been verified.",
        ],
      },
      {
        heading: "Credits and spend",
        body: [
          "Admins can see credits, model spend, and provider caps before any paid workflow is allowed to run.",
          "If a provider fails, users see a clear, plain-language error — never a raw payment or API detail.",
        ],
      },
      {
        heading: "Launch proof",
        body: [
          "A client fork keeps the demo receipts for testing and adds live payment evidence before anything is promoted to production.",
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
      "This template is built for real client work, so it assumes from day one that tenant boundaries, secrets, prompt injection, audit trails, and disciplined releases all matter. Safety is part of the product, not a hardening phase bolted on later.",
    sections: [
      {
        heading: "Why this matters",
        body: [
          "For investors: this is not a UI prototype. It is a delivery framework with risk controls built in.",
          "For operators: the system can always explain itself — what ran, which sources were used, which policy applied, and where a human said yes.",
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
  {
    id: "runs",
    eyebrow: "Execution history",
    title: "Runs are the audit trail of every workflow execution",
    intro:
      "Every time a workflow executes, the system keeps the receipts. A client can always answer: what ran, who started it, which rules applied, and what evidence backs the output.",
    sections: [
      {
        heading: "How to explain it",
        body: [
          "A run is one execution of a workflow recipe. It records which version of the process ran, the exact steps that executed, and when it started and finished.",
          "Duplicate triggers and retries can never run the same business process twice — every run carries a key that makes repeats harmless.",
        ],
      },
      {
        heading: "Technical proof",
        body: [
          "Every run, every stage, and every event is stored permanently and belongs to exactly one customer workspace.",
          "The Workflows page streams the demo runs live from the deployed backend — the same records this page describes.",
          `Completed runs link to Trust Receipts like \`${sampleRunReceipt.trustReceiptId}\` for source-backed proof.`,
        ],
      },
    ],
  },
  {
    id: "documents",
    eyebrow: "Working surface",
    title: "Documents are versioned, annotated, and co-edited safely",
    intro:
      "Client teams work in documents: briefs, drafts, research notes. The template treats every document as a versioned record — with review notes attached to specific versions and safe simultaneous editing — never as a file that silently changes underneath you.",
    sections: [
      {
        heading: "Why this matters",
        body: [
          "AI-assisted drafts need history. Which version did the human approve? What exactly did the AI change since then?",
          "Review notes attach to the exact version they were written on, so feedback never drifts away from what it referred to.",
        ],
      },
      {
        heading: "Technical proof",
        body: [
          "Every document keeps its full version history, and simultaneous edits are coordinated instead of overwriting each other.",
          "Document changes pass through the same permission checks and audit trail as every other change in the system.",
        ],
      },
    ],
  },
  {
    id: "sources",
    eyebrow: "Context layer",
    title: "Sources keep AI output anchored to real evidence",
    intro:
      "Sources are the raw truth the Brain organizes: call transcripts, web pages, notes, uploads. Every claim the AI makes should trace back to one of them.",
    sections: [
      {
        heading: "How to explain it",
        body: [
          "A source set is a hand-picked bundle of sources approved for a task. The AI works from those — never from the open internet.",
          "Citations record which source backed which claim, so 'where did this come from?' always has an answer.",
        ],
      },
      {
        heading: "Technical proof",
        body: [
          "Every claim is pinned to the source that backs it, and stale context is flagged before it can mislead anyone.",
          "The drafting capability refuses to write without an approved set of sources. There is no 'just make something up' path.",
        ],
      },
    ],
  },
  {
    id: "data-map",
    eyebrow: "Data governance",
    title: "The Data Map shows what the system stores and why",
    intro:
      "Client diligence always asks the same questions: what data does this system hold, how sensitive is it, and who can see it? The Data Map is the standing answer.",
    sections: [
      {
        heading: "Why this matters",
        body: [
          "Every workspace is explicitly labeled public, internal, or confidential, and rules can key off that label.",
          "Anything a provider sends back is scrubbed before it reaches logs, so operational records never become a shadow copy of client data.",
        ],
      },
      {
        heading: "Technical proof",
        body: [
          "Every record belongs to exactly one customer workspace, and the system is built so a query physically cannot read across customers.",
          "Every software license in the product is inventoried automatically, and secret-scanning blocks credentials from ever being committed.",
        ],
      },
    ],
  },
  {
    id: "notifications",
    eyebrow: "Communication layer",
    title: "Notifications start recorded, then become delivered",
    intro:
      "Invites, lifecycle notices, and workflow alerts route through one notifications seam. In demo mode every send is recorded instead of delivered, so flows are testable without a live email provider.",
    sections: [
      {
        heading: "How to explain it",
        body: [
          "In demo mode, nothing is actually sent — the system records exactly what would have gone out, to whom, and why, so every flow is testable.",
          "A client fork switches to live email delivery only after the sending domain is verified and approved.",
        ],
      },
      {
        heading: "Technical proof",
        body: [
          "Recorded-only is the default; going live is an explicit configuration decision, not an accident.",
          "A recorded invitation is proof the entire membership flow works end to end — invite, accept, and role assignment.",
        ],
      },
    ],
  },
  {
    id: "analytics",
    eyebrow: "Product telemetry",
    title: "Analytics is a seam, not a surveillance default",
    intro:
      "Product analytics answers whether the client's team actually uses what was built. The template ships the seam wired and disabled, so turning it on is a decision, not a discovery.",
    sections: [
      {
        heading: "How to explain it",
        body: [
          "Every tracked event is defined up front in a list the client approves before anything is collected.",
          "Local, demo, and evaluation modes never send real events anywhere.",
        ],
      },
      {
        heading: "Technical proof",
        body: [
          "The analytics connection (PostHog) ships wired but switched off, and an automated check keeps it that way until a client turns it on deliberately.",
          "Renaming or removing a tracked event is a visible code change the build catches — never a silent gap in the data.",
        ],
      },
    ],
  },
  {
    id: "legal",
    eyebrow: "Compliance posture",
    title: "Legal surfaces ship with the template, not after the incident",
    intro:
      "Terms, privacy, and data-processing posture are part of the delivery checklist. The template keeps the legal surface present from day one so client review starts from a draft, not a blank page.",
    sections: [
      {
        heading: "Why this matters",
        body: [
          "B2B buyers ask for data-processing terms and a data inventory before rollout. Starting from drafts beats starting from nothing.",
          "License exposure is inventoried automatically, so 'is anything in here we can't ship?' is a report, not a week-long audit.",
        ],
      },
      {
        heading: "Technical proof",
        body: [
          "The app ships with a dedicated legal page, so terms and privacy always have a home in the product itself.",
          "Every dependency's license is checked on every release, and unvetted license types stop the build.",
        ],
      },
    ],
  },
  {
    id: "admin",
    eyebrow: "Operator surface",
    title: "Admin is where humans govern the machine",
    intro:
      "Someone has to invite members, change roles, approve risky actions, and transfer ownership. Admin is that surface, and every action it exposes is a typed, audited capability.",
    sections: [
      {
        heading: "How to explain it",
        body: [
          "Membership has a real lifecycle — invite, accept, change role, remove, transfer ownership — with every step validated, not a pile of ad-hoc updates.",
          "Risky AI actions wait in an approval queue. Approving one grants narrow, time-limited permission for that action only.",
        ],
      },
      {
        heading: "Technical proof",
        body: [
          "Every action that changes data declares who is allowed to take it — a change without a permission check cannot even be built.",
          "Every approval records the reviewer, the scope, and an expiry, and the whole flow is covered by automated tests.",
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
  ["runs", "runs"],
  ["documents", "documents"],
  ["sources", "sources"],
  ["api", "headless"],
  ["onboarding", "onboarding"],
  ["dataMap", "data-map"],
  ["notifications", "notifications"],
  ["integrations", "integrations"],
  ["settings", "settings"],
  ["legal", "legal"],
  ["billing", "billing"],
  ["analytics", "analytics"],
  ["health", "safety"],
  ["admin", "admin"],
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
