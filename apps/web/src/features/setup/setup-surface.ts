import type { ProviderAdapter } from "@maestro-template/template-core";

export type SetupDocumentSection = {
  readonly heading: string;
  readonly body: readonly string[];
};

export const buildProviderSetupDocumentSections = (
  adapters: readonly ProviderAdapter[],
): readonly SetupDocumentSection[] => {
  const adapterLine = (name: string): string => {
    const adapter = adapters.find((candidate) => candidate.name === name);

    if (!adapter) {
      return `**${name}** is not configured yet.`;
    }

    return `**${adapter.name}** stays behind the ${adapter.mode} adapter and is currently ${adapter.status}.`;
  };

  return [
    {
      heading: "Workspace setup",
      body: [
        "Every client fork starts by creating a workspace, selecting fake/local providers, and confirming tenant identity is server-derived.",
        "The template should work in diligence and demo mode without live customer secrets.",
      ],
    },
    {
      heading: "Provider posture",
      body: [
        adapterLine("WorkOS/AuthKit"),
        adapterLine("PostHog"),
        adapterLine("Storage"),
        adapterLine("OpenRouter"),
      ],
    },
    {
      heading: "Billing and credits",
      body: [
        "**Dodo** starts in billing fake first mode so demos and tests do not need live payment secrets.",
        "Client forks can replace deterministic checkout and credit receipts with live Dodo calls after sandbox signoff.",
      ],
    },
    {
      heading: "Email and notifications",
      body: [
        "**MailerSend** starts in console + live mode so notification flows can be reviewed before deliverability is enabled.",
        "Notifications should use typed templates, explicit recipients, and redacted provider errors.",
      ],
    },
    {
      heading: "Deploy readiness",
      body: [
        "Run local tests, hosted browser smoke, Confect contract checks, provider readiness checks, and secret scans before client handoff.",
        "Production promotion should stay manual until the client fork has live provider signoff.",
      ],
    },
  ];
};

export const buildOnboardingDocumentSections =
  (): readonly SetupDocumentSection[] => [
    {
      heading: "Workspace",
      body: [
        "- Create or confirm the client workspace.",
        "- Decide whether this is a demo, diligence, pilot, or production fork.",
        "- Keep tenant identity server-derived from the beginning.",
      ],
    },
    {
      heading: "Brain",
      body: [
        "- Import markdown, links, notes, and approved source lists.",
        "- Mark source content as data, not instructions.",
        "- Build the first context pack before adding optional RAG.",
      ],
    },
    {
      heading: "Capabilities and workflows",
      body: [
        "- Add the first capability with typed args, typed returns, typed failures, and policy.",
        "- Compose it into a workflow with explicit approval and evidence points.",
        "- Keep React Flow as the inspection/authoring layer, not the durable source of truth.",
      ],
    },
    {
      heading: "Launch checks",
      body: [
        "- Run browser smoke, app tests, Confect contract checks, and deploy readiness checks before handoff.",
        "- Confirm WorkOS, PostHog, Dodo, MailerSend, storage, and model provider posture.",
        "- Save a Trust Receipt for the first meaningful workflow run.",
      ],
    },
  ];
