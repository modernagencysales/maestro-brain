import {
  Activity,
  Brain,
  Braces,
  Cable,
  CheckCircle2,
  Command,
  DatabaseZap,
  KeyRound,
  Mail,
  Play,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import {
  AppFrame,
  IconButton,
  PageHeader,
  StatGrid,
  StatusPill,
  SurfaceCard,
} from "@maestro-template/ui";
import { WorkflowCanvas } from "@maestro-template/workflow-ui";
import {
  agents,
  brainSources,
  capabilities,
  contextPacks,
  headlessSurfaces,
  navItems,
  providerAdapters,
  safetyChecklist,
  stats,
  workflowEdges,
  workflowNodes,
} from "./templateData";

const surfaces = [
  {
    title: "Living Brain",
    icon: Brain,
    status: "core",
    copy: "Markdown, links, source sets, evidence views, context packs, freshness, and trust receipts without defaulting every app into vector search.",
  },
  {
    title: "Workflow Runtime",
    icon: Activity,
    status: "core",
    copy: "Workflows compose capabilities. Agents are nondeterministic actors that receive grants, policy snapshots, and audit ledgers.",
  },
  {
    title: "Headless Surfaces",
    icon: Braces,
    status: "core",
    copy: "API, CLI, MCP, and Scalar projections call the same typed capability and workflow registry as the web app.",
  },
  {
    title: "Integrations",
    icon: Cable,
    status: "adapters",
    copy: "WorkOS, PostHog, Dodo, MailerSend, storage, and OpenRouter-compatible LLM providers sit behind Effect services with fake/test/live layers.",
  },
] as const;

export function App() {
  return (
    <AppFrame
      title="Maestro Template"
      subtitle="Private AI app factory"
      navItems={navItems}
    >
      <PageHeader
        eyebrow="Generic AI operations framework"
        title="Custom Brain, workflow, and agent apps without rebuilding the platform"
        description="This reference app shows the reusable primitives: Confect/Effect contracts, source-grounded Brain context, visual workflow composition, capabilities, agents, headless APIs, integrations, and safety gates."
        actions={
          <>
            <IconButton label="Run sample workflow">
              <Play size={18} />
            </IconButton>
            <IconButton label="Open command palette">
              <Command size={18} />
            </IconButton>
          </>
        }
      />

      <StatGrid stats={stats} />

      <section className="main-grid" id="overview">
        <SurfaceCard title="Reference Workflow" meta="React Flow primitive">
          <div id="workflows">
            <WorkflowCanvas nodes={workflowNodes} edges={workflowEdges} />
          </div>
        </SurfaceCard>

        <SurfaceCard title="Template Contract" meta="current slice">
          <ul className="check-list">
            <li>
              <CheckCircle2 size={16} />
              Confect tables, specs, impls, generated refs
            </li>
            <li>
              <CheckCircle2 size={16} />
              Effect schemas and declared expected failures
            </li>
            <li>
              <CheckCircle2 size={16} />
              Plain Convex Workpool bridge through Confect
            </li>
            <li>
              <CheckCircle2 size={16} />
              CI gates for compatibility and contract drift
            </li>
          </ul>
        </SurfaceCard>
      </section>

      <section className="surface-grid" aria-label="Template primitives">
        {surfaces.map((surface) => {
          const Icon = surface.icon;
          return (
            <SurfaceCard key={surface.title} title={surface.title}>
              <div className="surface-title-row">
                <Icon size={20} />
                <StatusPill
                  tone={surface.status === "core" ? "good" : "neutral"}
                >
                  {surface.status}
                </StatusPill>
              </div>
              <p>{surface.copy}</p>
            </SurfaceCard>
          );
        })}
      </section>

      <section className="detail-grid" id="brain">
        <SurfaceCard title="Brain Sources" meta="markdown + links">
          <div className="record-list">
            {brainSources.map((source) => (
              <div className="record-row" key={source.title}>
                <div>
                  <strong>{source.title}</strong>
                  <span>{source.kind}</span>
                </div>
                <StatusPill
                  tone={source.freshness === "fresh" ? "good" : "warn"}
                >
                  {source.freshness}
                </StatusPill>
                <small>{source.evidence}</small>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Context Pack" meta="no default RAG">
          <ol className="number-list">
            {contextPacks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </SurfaceCard>
      </section>

      <section className="detail-grid" id="capabilities">
        <SurfaceCard title="Capabilities" meta="typed units of work">
          <div className="record-list">
            {capabilities.map((capability) => (
              <div className="capability-row" key={capability.name}>
                <div>
                  <strong>{capability.name}</strong>
                  <p>{capability.description}</p>
                </div>
                <span>{capability.exposure}</span>
                <StatusPill>{capability.policy}</StatusPill>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Agents" meta="nondeterministic actors">
          <div className="agent-grid" id="agents">
            {agents.map((agent) => (
              <div className="agent-card" key={agent.name}>
                <UserRoundCog size={18} />
                <strong>{agent.name}</strong>
                <span>{agent.grants}</span>
                <small>{agent.guardrail}</small>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </section>

      <section className="detail-grid" id="headless">
        <SurfaceCard
          title="Headless Registry"
          meta="one backend, many surfaces"
        >
          <div className="record-list">
            {headlessSurfaces.map((surface) => (
              <div className="headless-row" key={surface.name}>
                <Braces size={17} />
                <div>
                  <strong>{surface.name}</strong>
                  <span>{surface.route}</span>
                </div>
                <small>{surface.contract}</small>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Provider Adapters" meta="fake/test/live layers">
          <div className="adapter-grid" id="integrations">
            {providerAdapters.map((adapter) => (
              <div className="adapter-card" key={adapter.name}>
                <DatabaseZap size={17} />
                <strong>{adapter.name}</strong>
                <span>{adapter.mode}</span>
                <StatusPill
                  tone={adapter.status === "guarded" ? "good" : "neutral"}
                >
                  {adapter.status}
                </StatusPill>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </section>

      <section className="two-column" id="safety">
        <SurfaceCard title="Default Provider Posture" meta="fake first">
          <div className="integration-list">
            <span>
              <ShieldCheck size={16} /> WorkOS/AuthKit
            </span>
            <span>
              <Activity size={16} /> PostHog
            </span>
            <span>
              <KeyRound size={16} /> Dodo billing
            </span>
            <span>
              <Mail size={16} /> MailerSend email
            </span>
          </div>
        </SurfaceCard>

        <SurfaceCard title="Safety Model" meta="reviewer visible">
          <ul className="check-list">
            {safetyChecklist.map((item) => (
              <li key={item}>
                <CheckCircle2 size={16} />
                {item}
              </li>
            ))}
          </ul>
        </SurfaceCard>
      </section>
    </AppFrame>
  );
}
