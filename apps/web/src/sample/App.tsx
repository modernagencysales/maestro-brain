import {
  Activity,
  Brain,
  Braces,
  Cable,
  CheckCircle2,
  Command,
  KeyRound,
  Mail,
  Play,
  ShieldCheck,
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

const navItems = [
  { id: "overview", label: "Overview", active: true },
  { id: "brain", label: "Brain" },
  { id: "workflows", label: "Workflows" },
  { id: "capabilities", label: "Capabilities" },
  { id: "agents", label: "Agents" },
  { id: "headless", label: "API / CLI / MCP" },
  { id: "integrations", label: "Integrations" },
  { id: "safety", label: "Safety" },
] as const;

const stats = [
  { label: "Typed functions", value: "8", tone: "good" },
  { label: "Provider mode", value: "Fake/local", tone: "neutral" },
  { label: "Workflow gates", value: "Strict", tone: "good" },
  { label: "RAG default", value: "Off", tone: "warn" },
] as const;

const workflowNodes = [
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
] as const;

const workflowEdges = [
  { id: "e1", source: "source", target: "context", label: "evidence" },
  { id: "e2", source: "context", target: "agent", label: "grounded pack" },
  { id: "e3", source: "agent", target: "approval", label: "agent choice" },
  { id: "e4", source: "approval", target: "output", label: "audited run" },
] as const;

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
          <WorkflowCanvas nodes={workflowNodes} edges={workflowEdges} />
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

      <section className="two-column">
        <SurfaceCard title="Default Provider Posture" meta="fake first">
          <div className="integration-list" id="integrations">
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
          <p id="safety">
            Tenant identity is server-derived, runtime-authored capabilities are
            data not arbitrary code, provider errors are redacted, and generated
            contracts are checked before merge.
          </p>
        </SurfaceCard>
      </section>
    </AppFrame>
  );
}
