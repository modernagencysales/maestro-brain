import { useState } from "react";
import { AppFrame } from "@maestro-template/ui";
import { WorkflowCanvas } from "@maestro-template/workflow-ui";
import {
  brainSources,
  capabilities,
  contextPacks,
  headlessSurfaces,
  navItems,
  openApiSummary,
  providerAdapters,
  sampleRunReceipt,
  safetyChecklist,
  stats,
  workflowEdges,
  workflowNodes,
} from "./templateData";

type DocumentPage = {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly {
    readonly heading: string;
    readonly body: readonly string[];
  }[];
};

const overviewPage: DocumentPage = {
  id: "overview",
  eyebrow: "Private AI app factory",
  title: "A calm template for custom Brain, workflow, and agent apps",
  intro:
    "Maestro Template is the reusable application substrate we can clone for client-specific AI implementation work. It keeps the useful platform primitives from Maestro while removing Maestro-specific business logic.",
  sections: [
    {
      heading: "What this proves",
      body: [
        "The repo has a hosted reference app, a typed backend direction, reusable workflow and capability primitives, headless API/CLI/MCP surfaces, provider adapter boundaries, and CI gates.",
        `The current sample tracks ${stats.length} high-level health signals: typed functions, provider posture, workflow gates, and the decision not to default every app into RAG.`,
      ],
    },
    {
      heading: "How to read the template",
      body: [
        "Start with the Brain page to understand how customer context becomes a source-grounded workspace.",
        "Then read Workflows, Capabilities, and Agents in order. Those pages describe the layered model: workflows compose capabilities, and agents request capabilities through grants.",
        "Finish with API / CLI / MCP, Integrations, and Safety to see how the same model is exposed and protected.",
      ],
    },
  ],
};

const pages: readonly DocumentPage[] = [
  overviewPage,
  {
    id: "brain",
    eyebrow: "Context layer",
    title: "The Brain is simple, source-grounded, and intentionally flexible",
    intro:
      "The template treats the Brain as structured customer context: markdown, links, notes, source sets, evidence views, context packs, and trust receipts. It can support RAG later, but it does not make RAG the default answer to every problem.",
    sections: [
      {
        heading: "Source types",
        body: brainSources.map(
          (source) =>
            `**${source.title}** is represented as ${source.kind} content with ${source.evidence}.`,
        ),
      },
      {
        heading: "Context packs",
        body: [
          "A context pack is the safe bundle an agent or workflow receives before it acts.",
          ...contextPacks.map((item) => `- ${item}`),
        ],
      },
    ],
  },
  {
    id: "workflows",
    eyebrow: "Composition layer",
    title: "Workflows compose capabilities into auditable runs",
    intro:
      "The workflow primitive is deliberately generic. It can represent source intake, approval, agent choice, output generation, and trust receipt creation without hard-coding one client's process.",
    sections: [
      {
        heading: "How the sample flow works",
        body: [
          "A source set is resolved, a context pack is built, an agent receives a narrow grant, a policy approval is recorded, and the output is wrapped in a trust receipt.",
          "React Flow is used for authoring and inspection. Durable workflow logic should stay in typed workflow metadata and Confect/Effect contracts.",
        ],
      },
    ],
  },
  {
    id: "capabilities",
    eyebrow: "Execution units",
    title: "Capabilities are typed units of work",
    intro:
      "Capabilities are the reusable actions workflows and agents can call. They authenticate, validate, delegate to the correct service, and return typed results or typed failures.",
    sections: [
      {
        heading: "Sample capabilities",
        body: capabilities.map(
          (capability) =>
            `**${capability.name}**: ${capability.description} It is exposed through ${capability.exposure} and guarded by ${capability.policy}.`,
        ),
      },
      {
        heading: "Why this matters",
        body: [
          "Client apps can add domain-specific capabilities without changing the platform model.",
          "Reviewed runtime-authored capabilities can be promoted into generated Confect source when compile-time guarantees matter.",
        ],
      },
    ],
  },
  {
    id: "agents",
    eyebrow: "Actor layer",
    title: "Agents are nondeterministic actors with explicit grants",
    intro:
      "Agents do not get broad access to the system. They receive narrow tool grants and compose capabilities or workflow kickoffs through typed boundaries.",
    sections: [
      {
        heading: "What agents can do",
        body: [
          "A planner can compose a workflow.",
          "A research agent can read approved Brain sources.",
          "An operator agent can inspect runs and draft notifications, but approvals are required before external side effects.",
        ],
      },
      {
        heading: "Guardrails",
        body: [
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
    title: "The same registry powers API, CLI, MCP, and Scalar docs",
    intro:
      "The template has one headless registry that can project operations into multiple surfaces. A client app should not have separate business logic for web, API, CLI, and MCP.",
    sections: [
      {
        heading: "Available surfaces",
        body: headlessSurfaces.map(
          (surface) =>
            `**${surface.name}** is available at \`${surface.route}\` and uses ${surface.contract}.`,
        ),
      },
      {
        heading: "OpenAPI",
        body: [
          `The sample OpenAPI document is ${openApiSummary.version}.`,
          `It exposes ${openApiSummary.operationCount} generated operations and documents typed errors: ${openApiSummary.typedErrors.join(", ")}.`,
          `Scalar docs are mounted at \`${openApiSummary.docsRoute}\`.`,
        ],
      },
    ],
  },
  {
    id: "integrations",
    eyebrow: "Provider layer",
    title: "Integrations sit behind Effect services",
    intro:
      "The template keeps provider SDKs behind adapters. Fake and test layers make the app safe to run during diligence, while live layers can be filled in for each client.",
    sections: [
      {
        heading: "Provider posture",
        body: providerAdapters.map(
          (adapter) =>
            `**${adapter.name}** uses ${adapter.mode} mode and is currently marked ${adapter.status}.`,
        ),
      },
      {
        heading: "Why fake first",
        body: [
          "The template should run without client secrets.",
          "Provider payloads should be redacted before crossing public boundaries.",
          "Client forks replace deterministic receipts with SDK-backed calls when live setup begins.",
        ],
      },
    ],
  },
  {
    id: "safety",
    eyebrow: "Safety layer",
    title: "Safety is part of the framework, not a checklist at the end",
    intro:
      "The template is designed for client work where tenant boundaries, provider secrets, prompt injection, and auditability matter. The sample app makes those rules visible.",
    sections: [
      {
        heading: "Default rules",
        body: safetyChecklist.map((item) => `- ${item}`),
      },
      {
        heading: "Trust receipt path",
        body: [
          `The sample run \`${sampleRunReceipt.runId}\` produces \`${sampleRunReceipt.trustReceipt.receiptId}\`.`,
          sampleRunReceipt.trustReceipt.claim,
        ],
      },
    ],
  },
] as const;

const pageById = new Map(pages.map((page) => [page.id, page]));

const renderInlineMarkdown = (text: string) => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return parts.map((part, index) => {
    const key = `${part}-${index}`;

    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }

    return <span key={key}>{part}</span>;
  });
};

const MarkdownLine = ({ text }: { readonly text: string }) => {
  if (text.startsWith("- ")) {
    return <li>{renderInlineMarkdown(text.slice(2))}</li>;
  }

  return <p>{renderInlineMarkdown(text)}</p>;
};

const NotionDocument = ({ page }: { readonly page: DocumentPage }) => (
  <article className="notion-page" id={page.id}>
    <p className="notion-eyebrow">{page.eyebrow}</p>
    <h1>{page.title}</h1>
    <p className="notion-intro">{page.intro}</p>

    {page.id === "workflows" ? (
      <section className="notion-section" aria-label="Workflow preview">
        <WorkflowCanvas nodes={workflowNodes} edges={workflowEdges} />
      </section>
    ) : null}

    {page.sections.map((section) => {
      const listItems = section.body.filter((line) => line.startsWith("- "));
      const paragraphs = section.body.filter((line) => !line.startsWith("- "));

      return (
        <section className="notion-section" key={section.heading}>
          <h2>{section.heading}</h2>
          {paragraphs.map((line) => (
            <MarkdownLine key={line} text={line} />
          ))}
          {listItems.length > 0 ? (
            <ul>
              {listItems.map((line) => (
                <MarkdownLine key={line} text={line} />
              ))}
            </ul>
          ) : null}
        </section>
      );
    })}
  </article>
);

export function App() {
  const [activeNavId, setActiveNavId] = useState<string>(
    navItems[0]?.id ?? "overview",
  );
  const activePage = pageById.get(activeNavId) ?? overviewPage;

  return (
    <AppFrame
      title="Maestro Template"
      subtitle="Private AI app factory"
      navItems={navItems}
      activeId={activePage.id}
      onNavigate={setActiveNavId}
    >
      <NotionDocument page={activePage} />
    </AppFrame>
  );
}
