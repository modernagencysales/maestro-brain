import type {
  DurableWorkflowGraphForCanvas,
  WorkflowTemplateEdge,
  WorkflowTemplateNode,
} from "@maestro-template/workflow-ui";
import {
  buildBrainDocumentSections,
  createBrainContextPackPreview,
} from "../features/brain/brain-surface";
import {
  buildOnboardingDocumentSections,
  buildProviderSetupDocumentSections,
} from "../features/setup/setup-surface";
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
  openApiSummary,
  providerAdapters,
  sampleRunReceipt,
  safetyChecklist,
  starterReadiness,
  templateStats,
} from "./templateData";

export type Diagram = {
  readonly label: string;
  readonly nodes?: readonly WorkflowTemplateNode[];
  readonly edges?: readonly WorkflowTemplateEdge[];
  readonly graph?: DurableWorkflowGraphForCanvas;
};

export type DocumentPage = {
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

type DiagramNodeSpec = readonly [
  id: string,
  label: string,
  kind: WorkflowTemplateNode["kind"],
  x: number,
  y: number,
];
type DiagramEdgeSpec = readonly [id: string, source: string, target: string];
type DiagramSpec = readonly [
  label: string,
  nodes: readonly DiagramNodeSpec[],
  edges: readonly DiagramEdgeSpec[],
];
type LinearDiagramNodeSpec = readonly [
  id: string,
  label: string,
  kind: WorkflowTemplateNode["kind"],
  x: number,
];

const buildDiagram = ([label, nodes, edges]: DiagramSpec): Diagram => ({
  label,
  nodes: nodes.map(([id, label, kind, x, y]) => ({ id, label, kind, x, y })),
  edges: edges.map(([id, source, target]) => ({ id, source, target })),
});

const linearDiagram = ({
  label,
  nodeY,
  nodes,
  edgeIds,
}: {
  readonly label: string;
  readonly nodeY: number;
  readonly nodes: readonly LinearDiagramNodeSpec[];
  readonly edgeIds: readonly string[];
}): Diagram =>
  buildDiagram([
    label,
    nodes.map(([id, label, kind, x]) => [id, label, kind, x, nodeY]),
    edgeIds.map((id, index) => {
      const source = nodes[index]?.[0];
      const target = nodes[index + 1]?.[0];

      if (source === undefined || target === undefined) {
        throw new Error(`Diagram "${label}" has an edge without two nodes.`);
      }

      return [id, source, target];
    }),
  ]);

const hubDiagram = ({
  label,
  hub,
  targets,
}: {
  readonly label: string;
  readonly hub: DiagramNodeSpec;
  readonly targets: readonly DiagramNodeSpec[];
}): Diagram =>
  buildDiagram([
    label,
    [hub, ...targets],
    targets.map(([target]) => [`${hub[0]}-${target}`, hub[0], target]),
  ]);

const overviewDiagram = linearDiagram({
  label: "Template operating model",
  nodeY: 70,
  nodes: [
    ["customer-context", "Customer knowledge", "source", 0],
    ["brain-context", "Reusable Brain", "capability", 230],
    ["workflow-plan", "Workflow", "approval", 460],
    ["agent-work", "Agent + capabilities", "agent", 690],
    ["business-output", "Useful business output", "output", 920],
  ],
  edgeIds: [
    "context-to-brain",
    "brain-to-workflow",
    "workflow-to-agent",
    "agent-to-output",
  ],
});

const brainDiagram = linearDiagram({
  label: "Brain context path",
  nodeY: 80,
  nodes: [
    ["raw-sources", "Links, notes, docs", "source", 0],
    ["source-set", "Approved source set", "approval", 250],
    ["context-pack", "Context pack", "capability", 500],
    ["agent-ready", "Agent-ready brief", "output", 750],
  ],
  edgeIds: ["raw-to-set", "set-to-pack", "pack-to-brief"],
});

const surfaceDiagram = hubDiagram({
  label: "One operation registry, many surfaces",
  hub: ["registry", "Typed operation registry", "capability", 280, 20],
  targets: [
    ["web", "Web app", "output", 0, 160],
    ["api", "API + Scalar docs", "output", 220, 160],
    ["cli", "CLI", "output", 440, 160],
    ["mcp", "MCP tools", "output", 660, 160],
  ],
});

const starterStatusLines = starterReadiness.statuses.map(
  (status) => `**${status.label}** (${status.state}): ${status.detail}`,
);
const starterCommandLines = starterReadiness.dayZeroCommands.map(
  (command) => `\`${command}\``,
);
const starterProofLines = starterReadiness.proofPoints.map(
  (point) => `**${point.label}**: ${point.detail}`,
);

export const overviewPage: DocumentPage = {
  id: "overview",
  eyebrow: "Private AI app factory",
  title: "A reusable foundation for custom AI implementation work",
  intro:
    "Maestro Template is the starting point for every client-specific AI app we build. Instead of beginning an engagement from a blank repository, we begin from a working product: a company Brain, workflows, agents, integrations, and safety rails that have already been built, tested, and deployed once.",
  diagram: overviewDiagram,
  sections: [
    {
      heading: "Starter console",
      body: [
        "This is the Day-0 control panel for a client SaaS fork: what is ready, what is generated, what is intentionally fake, and what must be client-specific before production.",
        ...starterStatusLines,
      ],
    },
    {
      heading: "Day-0 command loop",
      body: [
        "Run these commands in order. The first command uses `--write` because `template:doctor` checks the generated `template-instance.json` file.",
        ...starterCommandLines,
      ],
    },
    {
      heading: "Starter proof points",
      body: starterProofLines,
    },
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
        `This demo tracks ${templateStats.length} live health signals covering the backend, provider readiness, workflow gates, and grounded context.`,
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

export const pages: readonly DocumentPage[] = [
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
