#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { gtmImplementationBlueprint } from "./blueprints/gtmImplementation";

export type ProviderMode = "fake" | "test" | "live";

export type BlueprintId = "source-grounded-gtm-brain" | "gtm-implementation";

export type TemplateBlueprint = {
  readonly id: BlueprintId;
  readonly label: string;
  readonly summary: string;
  readonly domainNouns: readonly string[];
  readonly sourceTypes: readonly string[];
  readonly defaultCapability: string;
  readonly defaultWorkflow: string;
  readonly defaultAgent: string;
  readonly providerPosture: "fake-first";
  readonly surfaces: readonly ["web", "api", "cli", "mcp"];
};

export type TemplateInstance = {
  readonly name: string;
  readonly slug: string;
  readonly packageScope: string;
  readonly workspaceName: string;
  readonly blueprint: BlueprintId;
  readonly providerMode: ProviderMode;
  readonly environments: readonly ["local", "preview", "production"];
  readonly deploymentTargets: readonly ["local", "cloudflare-pages", "convex"];
  readonly modules: readonly string[];
  readonly requiredSecretNames: readonly string[];
  readonly redactionStatus: "reviewer-safe-fake-data" | "requires-review";
  readonly sourcePosture: "synthetic-demo-data" | "client-data-review-required";
  readonly providers: {
    readonly convex: "fake" | "configured";
    readonly workos: "fake" | "configured";
    readonly posthog: "fake" | "configured";
    readonly dodo: "fake" | "configured";
    readonly email: "console" | "configured";
    readonly llm: "fake" | "configured";
    readonly storage: "local" | "configured";
  };
  readonly releaseState: {
    readonly stage: "local" | "preview" | "production";
    readonly promotedCommit: string | null;
    readonly lastHandoffAt: string | null;
  };
  readonly upgradeCompatibility: {
    readonly templateVersion: string;
    readonly lastCheckedTemplateVersion: string | null;
    readonly status: "not-checked" | "compatible" | "needs-review";
    readonly requiredChecks: readonly string[];
  };
  readonly privatePackages: {
    readonly enabled: boolean;
    readonly packages: readonly string[];
    readonly promotionPolicy: "contract-review-required";
  };
  readonly intake?: {
    readonly status: "draft" | "reviewed";
    readonly briefPath: string;
    readonly generatedAt: string;
    readonly blueprint: BlueprintId;
  };
  readonly generatedAt: string;
};

export type DoctorCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: "pass" | "warn" | "fail";
  readonly detail: string;
};

export type DoctorReport = {
  readonly ok: boolean;
  readonly mode: ProviderMode;
  readonly instancePath: string;
  readonly checks: readonly DoctorCheck[];
};

export type GeneratedFile = {
  readonly path: string;
  readonly content: string;
};

export type DemoSeedPlan = {
  readonly blueprint: BlueprintId;
  readonly workspaceSlug: string;
  readonly providerMode: ProviderMode;
  readonly sources: readonly {
    readonly id: string;
    readonly kind: "markdown" | "link" | "note";
    readonly title: string;
    readonly body: string;
  }[];
  readonly contextPack: {
    readonly id: string;
    readonly title: string;
    readonly sourceIds: readonly string[];
  };
  readonly workflowRun: {
    readonly workflow: string;
    readonly status: "ready";
    readonly firstCapability: string;
  };
  readonly trustReceipt: {
    readonly id: string;
    readonly evidenceCount: number;
    readonly posture: "source-backed-no-default-rag";
  };
};

export type HandoffPacket = {
  readonly blueprint: BlueprintId;
  readonly mode: ProviderMode;
  readonly sections: readonly {
    readonly id: string;
    readonly title: string;
  }[];
  readonly markdown: string;
};

export type TemplateQuickstart = {
  readonly blueprint: BlueprintId;
  readonly instance: TemplateInstance;
  readonly firstCapability: string;
  readonly firstWorkflow: string;
  readonly firstAgent: string;
  readonly files: readonly GeneratedFile[];
  readonly nextCommands: readonly string[];
};

export type ClientIntake = {
  readonly instance: TemplateInstance;
  readonly files: readonly GeneratedFile[];
};

export type CapabilityGeneratorOptions = {
  readonly name: string;
  readonly description?: string;
  readonly exposure?: "web" | "workflow" | "headless";
  readonly write?: boolean;
};

export type ClientDomainGeneratorOptions = {
  readonly name: string;
  readonly description?: string;
  readonly write?: boolean;
};

export type ClientDomainGeneratorResult = {
  readonly name: string;
  readonly pascalName: string;
  readonly files: readonly GeneratedFile[];
};

export type CapabilityGeneratorResult = {
  readonly name: string;
  readonly pascalName: string;
  readonly exposure: "web" | "workflow" | "headless";
  readonly files: readonly GeneratedFile[];
};

export type WorkflowGeneratorOptions = {
  readonly name: string;
  readonly description?: string;
  readonly write?: boolean;
};

export type WorkflowGeneratorResult = {
  readonly name: string;
  readonly pascalName: string;
  readonly files: readonly GeneratedFile[];
};

export type PromotionGeneratorOptions = {
  readonly name: string;
  readonly description?: string;
  readonly write?: boolean;
};

export type PromotionGeneratorResult = {
  readonly name: string;
  readonly pascalName: string;
  readonly target: "capability" | "workflow";
  readonly files: readonly GeneratedFile[];
  readonly followUp: readonly string[];
};

export type TemplateUpgradeReport = {
  readonly from: string;
  readonly to: string;
  readonly ok: boolean;
  readonly changedPackages: readonly string[];
  readonly envChanges: readonly string[];
  readonly migrations: readonly string[];
  readonly generatedContractDiffs: readonly string[];
  readonly privatePackageCompatibility: readonly string[];
  readonly manualReview: readonly string[];
  readonly commands: readonly string[];
};

export type PrivatePackagePlan = {
  readonly fixturePath: string;
  readonly mode: "dry-run" | "import";
  readonly ok: boolean;
  readonly packageName: string;
  readonly files: readonly GeneratedFile[];
  readonly checks: readonly DoctorCheck[];
};

const defaultModules = [
  "brain",
  "workflows",
  "capabilities",
  "agents",
  "api",
  "mcp",
  "integrations",
  "safety",
] as const;

const defaultEnvironments = ["local", "preview", "production"] as const;
const defaultDeploymentTargets = [
  "local",
  "cloudflare-pages",
  "convex",
] as const;
const requiredSecretNamesByProvider = {
  convex: ["CONVEX_DEPLOYMENT", "VITE_CONVEX_URL"],
  workos: ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_COOKIE_PASSWORD"],
  posthog: ["POSTHOG_KEY", "POSTHOG_HOST"],
  dodo: ["DODO_API_KEY", "DODO_WEBHOOK_SECRET"],
  email: ["MAILERSEND_API_KEY", "MAILERSEND_FROM_EMAIL"],
  llm: ["OPENROUTER_API_KEY"],
  storage: [
    "STORAGE_BUCKET",
    "STORAGE_ACCESS_KEY_ID",
    "STORAGE_SECRET_ACCESS_KEY",
  ],
} as const satisfies Record<
  keyof TemplateInstance["providers"],
  readonly string[]
>;
const defaultRequiredSecretNames = Object.values(
  requiredSecretNamesByProvider,
).flat();
const defaultUpgradeRequiredChecks = [
  "pnpm check:confect-contracts",
  "pnpm check:workflow-graph-boundary",
  "pnpm check:schema-migration-notes",
  "pnpm check:secret-canaries",
] as const;

const defaultBlueprintId: BlueprintId = "source-grounded-gtm-brain";
const plannedBlueprintIds = [
  "implementation-consulting-brain",
  "internal-ops-agent-workspace",
  "custom-domain-ai-app",
] as const;

export const buildBlueprintCatalog = (): readonly TemplateBlueprint[] => [
  {
    id: defaultBlueprintId,
    label: "Source-Grounded GTM Brain",
    summary:
      "A source-backed GTM brain for B2B teams: ingest trusted context, compose a context pack, run a policy-pinned workflow, and emit a Trust Receipt.",
    domainNouns: [
      "workspace",
      "source",
      "context pack",
      "capability",
      "workflow",
      "agent",
      "trust receipt",
    ],
    sourceTypes: ["markdown", "link", "note"],
    defaultCapability: "summarizeSource",
    defaultWorkflow: "sourceGroundedPlan",
    defaultAgent: "gtmBrainPlanner",
    providerPosture: "fake-first",
    surfaces: ["web", "api", "cli", "mcp"],
  },
  gtmImplementationBlueprint,
];

const findBlueprint = (blueprint: BlueprintId): TemplateBlueprint => {
  const match = buildBlueprintCatalog().find((entry) => entry.id === blueprint);

  if (!match) {
    throw new Error(`Unknown blueprint: ${blueprint}`);
  }

  return match;
};

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const pascalCase = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");

  return normalized || "GeneratedCapability";
};

const camelCase = (value: string): string => {
  const pascal = pascalCase(value);

  return `${pascal[0]?.toLowerCase() ?? "g"}${pascal.slice(1)}`;
};

const writeGeneratedFiles = (
  files: readonly GeneratedFile[],
  cwd: string,
): void => {
  for (const file of files) {
    const targetPath = resolve(cwd, file.path);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content);
  }
};

const readOptionalJson = <T>(path: string): T | undefined => {
  if (!existsSync(path)) {
    return undefined;
  }

  return JSON.parse(readFileSync(path, "utf8")) as T;
};

export const buildTemplateInstance = (options?: {
  readonly name?: string;
  readonly blueprint?: BlueprintId;
  readonly providerMode?: ProviderMode;
  readonly generatedAt?: string;
}): TemplateInstance => {
  const name = options?.name?.trim() || "Acme AI Operations";
  const blueprint = options?.blueprint ?? defaultBlueprintId;
  const providerMode = options?.providerMode ?? "fake";
  const fakeProviders = providerMode === "fake";
  const slug = slugify(name) || "acme-ai-operations";

  return {
    name,
    slug,
    packageScope: `@${slug}`,
    workspaceName: `${name} Workspace`,
    blueprint,
    providerMode,
    environments: defaultEnvironments,
    deploymentTargets: defaultDeploymentTargets,
    modules: defaultModules,
    requiredSecretNames: defaultRequiredSecretNames,
    redactionStatus:
      providerMode === "fake" ? "reviewer-safe-fake-data" : "requires-review",
    sourcePosture:
      providerMode === "fake"
        ? "synthetic-demo-data"
        : "client-data-review-required",
    providers: {
      convex: fakeProviders ? "fake" : "configured",
      workos: fakeProviders ? "fake" : "configured",
      posthog: fakeProviders ? "fake" : "configured",
      dodo: fakeProviders ? "fake" : "configured",
      email: fakeProviders ? "console" : "configured",
      llm: fakeProviders ? "fake" : "configured",
      storage: fakeProviders ? "local" : "configured",
    },
    releaseState: {
      stage: "local",
      promotedCommit: null,
      lastHandoffAt: null,
    },
    upgradeCompatibility: {
      templateVersion: "unreleased",
      lastCheckedTemplateVersion: null,
      status: "not-checked",
      requiredChecks: defaultUpgradeRequiredChecks,
    },
    privatePackages: {
      enabled: false,
      packages: [],
      promotionPolicy: "contract-review-required",
    },
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
  };
};

export const parseTemplateInstance = (raw: string): TemplateInstance => {
  const parsed = JSON.parse(raw) as Partial<TemplateInstance>;

  if (!parsed.name || !parsed.slug || !parsed.providerMode) {
    throw new Error(
      "template-instance.json is missing name, slug, or providerMode",
    );
  }

  if (!["fake", "test", "live"].includes(parsed.providerMode)) {
    throw new Error(`Unknown providerMode: ${parsed.providerMode}`);
  }

  return {
    ...parsed,
    packageScope: parsed.packageScope ?? `@${parsed.slug}`,
    blueprint: parsed.blueprint ?? defaultBlueprintId,
    environments: parsed.environments ?? defaultEnvironments,
    deploymentTargets: parsed.deploymentTargets ?? defaultDeploymentTargets,
    requiredSecretNames:
      parsed.requiredSecretNames ?? defaultRequiredSecretNames,
    redactionStatus:
      parsed.redactionStatus ??
      (parsed.providerMode === "fake"
        ? "reviewer-safe-fake-data"
        : "requires-review"),
    sourcePosture:
      parsed.sourcePosture ??
      (parsed.providerMode === "fake"
        ? "synthetic-demo-data"
        : "client-data-review-required"),
    releaseState: parsed.releaseState ?? {
      stage: "local",
      promotedCommit: null,
      lastHandoffAt: null,
    },
    upgradeCompatibility: parsed.upgradeCompatibility ?? {
      templateVersion: "unreleased",
      lastCheckedTemplateVersion: null,
      status: "not-checked",
      requiredChecks: defaultUpgradeRequiredChecks,
    },
    privatePackages: parsed.privatePackages ?? {
      enabled: false,
      packages: [],
      promotionPolicy: "contract-review-required",
    },
    ...(parsed.intake ? { intake: parsed.intake } : {}),
  } as TemplateInstance;
};

const providerChecks = (
  instance: TemplateInstance,
  mode: ProviderMode,
): readonly DoctorCheck[] => {
  const entries = Object.entries(instance.providers) as readonly [
    keyof TemplateInstance["providers"],
    TemplateInstance["providers"][keyof TemplateInstance["providers"]],
  ][];

  return entries.map(([provider, status]) => {
    const readyForFake =
      mode === "fake" && ["fake", "console", "local"].includes(status);
    const readyForLive = mode !== "fake" && status === "configured";

    return {
      id: `provider:${provider}`,
      label: `${provider} provider`,
      status: readyForFake || readyForLive ? "pass" : "warn",
      detail:
        readyForFake || readyForLive
          ? `${provider} is valid for ${mode} mode`
          : `${provider} should be configured before ${mode} handoff. Required secret names: ${requiredSecretNamesByProvider[provider].join(", ")}`,
    };
  });
};

export const doctorTemplateInstance = (
  instance: TemplateInstance,
  options?: {
    readonly mode?: ProviderMode;
    readonly instancePath?: string;
  },
): DoctorReport => {
  const mode = options?.mode ?? instance.providerMode;
  const requiredModules = ["brain", "workflows", "capabilities", "api", "mcp"];
  const checks: DoctorCheck[] = [
    {
      id: "instance:slug",
      label: "Instance slug",
      status: instance.slug === slugify(instance.name) ? "pass" : "warn",
      detail: `Slug is ${instance.slug}`,
    },
    {
      id: "modules:core",
      label: "Core modules",
      status: requiredModules.every((module) =>
        instance.modules.includes(module),
      )
        ? "pass"
        : "fail",
      detail: `Required modules: ${requiredModules.join(", ")}`,
    },
    ...providerChecks(instance, mode),
  ];

  return {
    ok: checks.every((check) => check.status !== "fail"),
    mode,
    instancePath: options?.instancePath ?? "template-instance.json",
    checks,
  };
};

export const buildDemoSeedPlan = (options?: {
  readonly blueprint?: BlueprintId;
  readonly workspaceSlug?: string;
  readonly providerMode?: ProviderMode;
}): DemoSeedPlan => {
  const blueprint = options?.blueprint ?? defaultBlueprintId;
  const blueprintConfig = findBlueprint(blueprint);
  const workspaceSlug = options?.workspaceSlug ?? "acme-ai-operations";
  const sources = [
    {
      id: "source_markdown_positioning",
      kind: "markdown" as const,
      title: "Positioning Notes",
      body: "Synthetic markdown describing the company, target customers, current offer, and proof points.",
    },
    {
      id: "source_link_homepage",
      kind: "link" as const,
      title: "Company Homepage",
      body: "https://example.com acts as a reviewer-safe link source in fake mode.",
    },
    {
      id: "source_note_discovery",
      kind: "note" as const,
      title: "Discovery Call Notes",
      body: "Synthetic notes capturing buyer pains, objections, sales motion, and implementation constraints.",
    },
  ];

  return {
    blueprint,
    workspaceSlug,
    providerMode: options?.providerMode ?? "fake",
    sources,
    contextPack: {
      id: "context_pack_gtm_foundation",
      title: "GTM Foundation Context Pack",
      sourceIds: sources.map((source) => source.id),
    },
    workflowRun: {
      workflow: blueprintConfig.defaultWorkflow,
      status: "ready",
      firstCapability: blueprintConfig.defaultCapability,
    },
    trustReceipt: {
      id: "trust_receipt_demo",
      evidenceCount: sources.length,
      posture: "source-backed-no-default-rag",
    },
  };
};

const buildImplementationBrief = (
  instance: TemplateInstance,
  blueprint: TemplateBlueprint,
): string => `# ${instance.name} Implementation Brief

This fork starts from the ${blueprint.label} blueprint: a source-backed GTM brain for a typical B2B company.

## What This Gives Us

- A fake-first app that can demonstrate value without provider setup.
- A source-backed Brain built from markdown, links, and notes.
- A first capability, \`${blueprint.defaultCapability}\`, that can be replaced with client-specific logic.
- A first workflow, \`${blueprint.defaultWorkflow}\`, that connects context to a Trust Receipt.
- A first agent, \`${blueprint.defaultAgent}\`, with explicit grants instead of arbitrary backend access.
- Web, API, CLI, and MCP surfaces that share the same capability/workflow contracts.

## Domain Starting Point

Use these nouns as the first client discovery map: ${blueprint.domainNouns.join(", ")}.

## Extension Path

1. Replace synthetic sources with reviewed client context.
2. Add client-specific source types only when they have an owner, retention policy, and redaction posture.
3. Promote reviewed runtime capabilities and workflows into Confect/Effect source.
4. Keep client-specific prompts, integrations, and business logic in generated modules or private packages until reviewed.
`;

const buildProviderSetupChecklist = (
  instance: TemplateInstance,
  blueprint: TemplateBlueprint,
): string => `# ${instance.name} Provider Setup Checklist

Status: generated fake-mode checklist.

Use this checklist with [env-manifest.md](../env-manifest.md). Keep fake mode
until the client has approved the provider family, data map, and production
owner.

## Current Posture

- Blueprint: \`${blueprint.id}\`
- Provider mode: \`${instance.providerMode}\`
- App slug: \`${instance.slug}\`
- Workspace: \`${instance.workspaceName}\`

## Fake Mode

- WorkOS: use fake AuthKit IDs until production auth is approved.
- PostHog: keep analytics disabled or test-only until event capture is approved.
- Dodo: keep billing in test/fake mode until pricing, webhooks, and ledger reconciliation are reviewed.
- MailerSend: keep email disabled or console-only until the sender domain is verified.
- OpenRouter-compatible LLM: use deterministic fake completions until spend caps, model allowlist, and redaction posture are approved.
- Storage and search: use local/fake providers until source ownership, retention, export, and delete posture are documented.
- Cloudflare and Buildkite: use local commands first, then configure hosted smoke and CI promotion after the fork is stable.

## First Live-Ready Pass

1. Copy \`.env.example\` to the local/deployment secret store.
2. Replace non-secret names first: app name, public URL, storage bucket, search prefix, and provider project names.
3. Request live secrets only for approved provider families.
4. Run \`pnpm template:doctor -- --mode fake\`.
5. Configure test credentials for the first vertical.
6. Run \`pnpm template:doctor -- --mode live\` before claiming live-provider readiness.

## Required Secret Names

See [env-manifest.md](../env-manifest.md) for ownership, fake-mode behavior,
production requirements, and rotation notes. Generated handoff packets may list
these names, but must never include secret values.
`;

export const buildHandoffPacket = (options?: {
  readonly name?: string;
  readonly blueprint?: BlueprintId;
  readonly mode?: ProviderMode;
}): HandoffPacket => {
  const blueprint = options?.blueprint ?? defaultBlueprintId;
  const blueprintConfig = findBlueprint(blueprint);
  const name = options?.name?.trim() || "Acme AI Operations";
  const mode = options?.mode ?? "fake";
  const sections = [
    { id: "overview", title: "Overview" },
    { id: "architecture", title: "Architecture" },
    { id: "quickstart", title: "Quickstart" },
    { id: "providers", title: "Providers" },
    { id: "verification", title: "Verification" },
    { id: "next-steps", title: "Next Steps" },
  ] as const;
  const liveProviderLine =
    mode === "fake"
      ? "No live secrets required. Providers run in fake, console, or local mode."
      : "Live provider credentials must be configured through typed provider adapters before handoff.";

  return {
    blueprint,
    mode,
    sections,
    markdown: `# ${name} Handoff Packet

## Overview

${name} is generated from the ${blueprintConfig.label} blueprint. It demonstrates the private app factory path for B2B AI/GTM implementation software.

## Architecture

- Frontend: TanStack Start direction, Notion Kit/block UI, React Flow for workflow interaction.
- Backend: Convex with Confect/Effect contracts, typed errors, and generated refs.
- Brain: source-backed markdown, links, notes, context packs, and Trust Receipts by default.
- Headless: API, CLI, and MCP surfaces share generated capability/workflow contracts.

## Quickstart

1. Run \`pnpm template:doctor -- --mode ${mode}\`.
2. Run \`pnpm template:seed-demo -- --blueprint ${blueprint} --write\`.
3. Start the app and inspect the seeded Brain, workflow, and Trust Receipt.

## Providers

${liveProviderLine}

## Verification

- \`pnpm template:doctor -- --mode ${mode}\`
- \`pnpm check:generators\`
- \`pnpm check:confect-contracts\`
- \`pnpm check:workflow-graph-boundary\`
- \`pnpm check:secret-canaries\`

## Next Steps

Use the implementation brief to capture client nouns, source inventory, provider shortlist, first workflow, and handoff risks.
`,
  };
};

const buildBlueprintQuickstartFiles = (
  blueprint: BlueprintId,
): readonly GeneratedFile[] => {
  if (blueprint !== "gtm-implementation") {
    return [];
  }

  return [
    {
      path: "generated/blueprints/gtm-implementation/provider-seams.json",
      content: `${JSON.stringify(
        {
          blueprint,
          seams: [
            {
              id: "crm",
              mode: "fake/test/live-ready",
              purpose: "Account, person, opportunity, and activity sync.",
            },
            {
              id: "drive",
              mode: "fake/test/live-ready",
              purpose: "Client source documents and approved exports.",
            },
            {
              id: "notion",
              mode: "fake/test/live-ready",
              purpose:
                "Workspace notes, implementation docs, and handoff pages.",
            },
          ],
          liveSdkPolicy:
            "Generated provider seams are descriptors until a client fork adds reviewed SDK adapters.",
        },
        null,
        2,
      )}\n`,
    },
    {
      path: "generated/blueprints/gtm-implementation/reporting-surfaces.json",
      content: `${JSON.stringify(
        {
          blueprint,
          surfaces: [
            {
              id: "accountBrief",
              label: "Account brief",
              source: "source-backed account context",
            },
            {
              id: "pipelineFunnel",
              label: "Pipeline funnel",
              source: "demo-safe account stage fixtures",
            },
            {
              id: "activityBoard",
              label: "Activity board",
              source: "fake/test connector events",
            },
          ],
          promotionPath:
            "generated feature stubs stay outside template core until reviewed",
        },
        null,
        2,
      )}\n`,
    },
  ];
};

export const buildTemplateQuickstart = (options?: {
  readonly name?: string;
  readonly blueprint?: BlueprintId;
  readonly providerMode?: ProviderMode;
  readonly generatedAt?: string;
}): TemplateQuickstart => {
  const blueprint = options?.blueprint ?? defaultBlueprintId;
  const blueprintConfig = findBlueprint(blueprint);
  const instance = buildTemplateInstance({
    ...(options?.name ? { name: options.name } : {}),
    blueprint,
    providerMode: options?.providerMode ?? "fake",
    ...(options?.generatedAt ? { generatedAt: options.generatedAt } : {}),
  });
  const seed = buildDemoSeedPlan({
    blueprint,
    workspaceSlug: instance.slug,
    providerMode: instance.providerMode,
  });
  const handoff = buildHandoffPacket({
    name: instance.name,
    blueprint,
    mode: instance.providerMode,
  });
  const dayZeroLoop = {
    blueprint,
    firstDomainNoun: "customerContext",
    firstCapability: blueprintConfig.defaultCapability,
    firstWorkflow: blueprintConfig.defaultWorkflow,
    firstAgent: blueprintConfig.defaultAgent,
    sourceTypes: blueprintConfig.sourceTypes,
    surfaces: blueprintConfig.surfaces,
    verification: [
      "pnpm template:doctor -- --mode fake",
      "pnpm --dir tooling/generators test",
      "pnpm check:generators",
    ],
  };
  const files: readonly GeneratedFile[] = [
    {
      path: "template-instance.json",
      content: `${JSON.stringify(instance, null, 2)}\n`,
    },
    {
      path: "docs/template/generated/implementation-brief.md",
      content: buildImplementationBrief(instance, blueprintConfig),
    },
    {
      path: "docs/template/generated/provider-setup-checklist.md",
      content: buildProviderSetupChecklist(instance, blueprintConfig),
    },
    {
      path: "generated/app-factory/day-0-loop.json",
      content: `${JSON.stringify(dayZeroLoop, null, 2)}\n`,
    },
    {
      path: `examples/demo-seed/${blueprint}/demo-seed.json`,
      content: `${JSON.stringify(seed, null, 2)}\n`,
    },
    {
      path: "docs/template/generated/handoff-packet.md",
      content: handoff.markdown,
    },
    ...buildBlueprintQuickstartFiles(blueprint),
  ];

  return {
    blueprint,
    instance,
    firstCapability: blueprintConfig.defaultCapability,
    firstWorkflow: blueprintConfig.defaultWorkflow,
    firstAgent: blueprintConfig.defaultAgent,
    files,
    nextCommands: [
      "pnpm template:doctor -- --mode fake",
      "review docs/template/generated/provider-setup-checklist.md",
      `pnpm template:seed-demo -- --blueprint ${blueprint} --write`,
      "pnpm template:add-client-domain -- --name customerContext --write",
      `pnpm template:add-capability -- --name ${blueprintConfig.defaultCapability} --write`,
      `pnpm template:add-workflow -- --name ${blueprintConfig.defaultWorkflow} --write`,
      "pnpm template:handoff -- --mode fake --write",
    ],
  };
};

export const buildClientIntake = (options?: {
  readonly name?: string;
  readonly blueprint?: BlueprintId;
  readonly providerMode?: ProviderMode;
  readonly generatedAt?: string;
}): ClientIntake => {
  const generatedAt = options?.generatedAt ?? new Date().toISOString();
  const blueprint = options?.blueprint ?? defaultBlueprintId;
  const blueprintConfig = findBlueprint(blueprint);
  const baseInstance = buildTemplateInstance({
    ...(options?.name ? { name: options.name } : {}),
    blueprint,
    providerMode: options?.providerMode ?? "fake",
    generatedAt,
  });
  const briefPath = "docs/template/generated/client-intake.md";
  const instance: TemplateInstance = {
    ...baseInstance,
    intake: {
      status: "draft",
      briefPath,
      generatedAt,
      blueprint,
    },
  };
  const markdown = `# ${instance.name} Client Intake

Generated: ${generatedAt}
Blueprint: \`${blueprintConfig.id}\`
Provider mode: \`${instance.providerMode}\`

This intake turns a client conversation into a structured implementation brief
for a source-backed B2B AI/GTM app. No live secrets required in fake mode.

## Business Outcome

- What business outcome should the first prototype prove?
- Who will use the app weekly, and what job are they trying to finish?
- What output would make the buyer say the system understands their business?

## Source Inventory

- Which sources are authoritative: markdown, links, notes, calls, CRM exports,
  enablement docs, product docs, or other systems?
- Who owns each source, and can it be exported, deleted, or retained?
- What should never be sent to an LLM provider?

## Domain Map

- Starting nouns: ${blueprintConfig.domainNouns.join(", ")}.
- Which nouns should be renamed for the client?
- Which nouns require new tables, policies, or provider integrations?

## First Workflow

- Default workflow: \`${blueprintConfig.defaultWorkflow}\`.
- What source set enters the workflow?
- What capability transforms it?
- What approval, Trust Receipt, or human review is required before output?

## Agents And Capabilities

- Default agent: \`${blueprintConfig.defaultAgent}\`.
- Default capability: \`${blueprintConfig.defaultCapability}\`.
- Which tools may the agent call?
- Which actions require approval before publish, send, spend, or delete?

## Provider Posture

- WorkOS: fake until auth ownership and domains are approved.
- PostHog: fake/test until event capture is approved.
- Dodo: fake/test until pricing and reconciliation are approved.
- MailerSend: console/fake until sender domain and templates are approved.
- LLM: deterministic fake until spend caps, model allowlist, and redaction are
  approved.

## Handoff Risks

- Client data not yet reviewed.
- Provider secrets not yet configured.
- RAG remains optional; source-backed context and Trust Receipts are the default.
- Client-specific business logic belongs in generated modules or private
  packages until contract review.
`;

  return {
    instance,
    files: [
      {
        path: "template-instance.json",
        content: `${JSON.stringify(instance, null, 2)}\n`,
      },
      {
        path: briefPath,
        content: markdown,
      },
    ],
  };
};

export const buildClientDomainFiles = (
  options: ClientDomainGeneratorOptions,
): ClientDomainGeneratorResult => {
  const name = camelCase(options.name);
  const pascalName = pascalCase(options.name);
  const description =
    options.description ??
    `Client-specific ${name} domain scaffold. Keep business logic outside template core until reviewed.`;
  const basePath = `generated/domains/${name}`;
  const metadata = {
    domain: name,
    description,
    extensionBoundary: "generated-or-private-package",
    sourceTypes: ["markdown", "link", "note"],
    surfaces: ["web", "api", "cli", "mcp"],
    requiredFollowUp: [
      "Map client nouns to source ownership and retention.",
      "Identify first capability, workflow, and agent grants.",
      "Decide fake, test, or live-ready provider posture.",
      "Promote reviewed contracts through Confect/Effect generators.",
    ],
  };
  const files: readonly GeneratedFile[] = [
    {
      path: `${basePath}/${name}.domain.json`,
      content: `${JSON.stringify(metadata, null, 2)}\n`,
    },
    {
      path: `${basePath}/README.md`,
      content: `# ${pascalName} Domain

${description}

## Purpose

Use this generated domain as the client-specific boundary for nouns, source
types, capabilities, workflows, agents, and provider posture. Keep reusable
mechanics in template core and client-specific decisions here or in a private
package until reviewed.

## Follow-Up

1. Map client nouns to source ownership and retention.
2. Identify first capability, workflow, and agent grants.
3. Decide fake, test, or live-ready provider posture.
4. Promote reviewed contracts through Confect/Effect generators.
`,
    },
  ];

  return {
    name,
    pascalName,
    files,
  };
};

export const buildCapabilityFiles = (
  options: CapabilityGeneratorOptions,
): CapabilityGeneratorResult => {
  const name = camelCase(options.name);
  const pascalName = pascalCase(options.name);
  const exposure = options.exposure ?? "headless";
  const description =
    options.description ??
    `Generated ${name} capability. Replace the domain logic while preserving the contract shape.`;
  const basePath = `generated/capabilities/${name}`;
  const typedErrors = ["Unauthorized", "ValidationFailed", "Forbidden"];
  const files: readonly GeneratedFile[] = [
    {
      path: `${basePath}/${name}.spec.ts`,
      content: `import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

export const ${name}Args = Schema.Struct({
  workspaceSlug: Schema.String,
  input: Schema.String,
});

export const ${name}Returns = Schema.Struct({
  status: Schema.Literal("accepted"),
  summary: Schema.String,
});

export const ${name}Errors = Schema.Union(
  Schema.TaggedStruct("Unauthorized", {
    message: Schema.String,
  }),
  Schema.TaggedStruct("ValidationFailed", {
    message: Schema.String,
  }),
  Schema.TaggedStruct("Forbidden", {
    message: Schema.String,
  }),
);

export const ${name} = FunctionSpec.publicMutation({
  name: "${name}",
  args: () => ${name}Args,
  returns: () => ${name}Returns,
  error: () => ${name}Errors,
});

export default GroupSpec.make().addFunction(${name});
`,
    },
    {
      path: `${basePath}/${name}.impl.ts`,
      content: `import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../../confect/_generated/schema";
import ${name}Group, { ${name} } from "./${name}.spec";

const ${name}Impl = FunctionImpl.make(databaseSchema, ${name}Group, "${name}", () =>
  Effect.succeed({
    status: "accepted" as const,
    summary: "${description}",
  }),
);

export default GroupImpl.make(databaseSchema, ${name}Group).pipe(
  Layer.provide(${name}Impl),
  GroupImpl.finalize,
);
`,
    },
    {
      path: `${basePath}/${name}.domain.ts`,
      content: `// Pure domain seam for ${name}. Replace the placeholder fields with the
// real capability input, keep normalize/validate pure, and keep provider
// calls out of this file (they belong in the impl behind services).
export type ${pascalName}Input = {
  readonly workspaceSlug: string;
  readonly input: string;
};

export const normalize${pascalName}Input = (
  input: ${pascalName}Input,
): ${pascalName}Input => ({
  workspaceSlug: input.workspaceSlug.trim(),
  input: input.input.trim(),
});

export const validate${pascalName}Input = (
  input: ${pascalName}Input,
): readonly string[] => {
  const errors: string[] = [];

  if (input.workspaceSlug.length === 0) {
    errors.push("workspaceSlug must not be blank.");
  }

  if (input.input.length === 0) {
    errors.push("input must not be blank.");
  }

  return errors;
};
`,
    },
    {
      path: `${basePath}/${name}.test.ts`,
      content: `import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  normalize${pascalName}Input,
  validate${pascalName}Input,
} from "./${name}.domain";

describe("${name} generated capability domain", () => {
  it("normalization is idempotent for any input", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (workspaceSlug, input) => {
        const once = normalize${pascalName}Input({ workspaceSlug, input });
        expect(normalize${pascalName}Input(once)).toEqual(once);
      }),
    );
  });

  it("rejects blank fields after normalization", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\\s*$/), (blank) => {
        const normalized = normalize${pascalName}Input({
          workspaceSlug: blank,
          input: blank,
        });
        expect(validate${pascalName}Input(normalized)).toHaveLength(2);
      }),
    );
  });

  it("accepts trimmed non-blank input", () => {
    const normalized = normalize${pascalName}Input({
      workspaceSlug: "  acme-demo  ",
      input: "  summarize the approved sources  ",
    });

    expect(normalized.workspaceSlug).toBe("acme-demo");
    expect(validate${pascalName}Input(normalized)).toEqual([]);
  });

  it("declares the required typed errors", () => {
    expect(${JSON.stringify(typedErrors)}).toContain("ValidationFailed");
  });
});
`,
    },
    {
      path: `${basePath}/${name}.headless.json`,
      content: `${JSON.stringify(
        {
          capability: name,
          description,
          exposure,
          authScope: "workspace member",
          typedErrors,
          surfaces:
            exposure === "headless" ? ["api", "cli", "mcp"] : [exposure],
          requiredFiles: [
            "Confect spec/impl",
            "tests",
            "headless registry entry",
            "docs",
          ],
          migrationNotes: [
            "Run Confect codegen before wiring generated refs.",
            "Add migration notes when the capability writes durable tables.",
          ],
          frontendAdapter: "required when exposure is web",
        },
        null,
        2,
      )}
`,
    },
    {
      path: `${basePath}/README.md`,
      content: `# ${pascalName} Capability

${description}

## Contract

- Args: \`${name}Args\`
- Returns: \`${name}Returns\`
- Typed errors: ${typedErrors.join(", ")}
- Exposure: ${exposure}

## Required Follow-Up

1. Move generated files into the owning Confect group.
2. Run \`pnpm confect:codegen\`.
3. Add generated refs to the web/API/CLI/MCP surfaces selected in \`${name}.headless.json\`.
4. Replace the placeholder implementation with domain logic behind capability checks.
5. Run \`pnpm check:confect-contracts\` and focused capability tests.
`,
    },
  ];

  return {
    name,
    pascalName,
    exposure,
    files,
  };
};

export const buildWorkflowFiles = (
  options: WorkflowGeneratorOptions,
): WorkflowGeneratorResult => {
  const name = camelCase(options.name);
  const pascalName = pascalCase(options.name);
  const description =
    options.description ??
    `Generated ${name} workflow. Replace sample capability refs after review.`;
  const basePath = `generated/workflows/${name}`;
  const graph = {
    id: name,
    name: pascalName,
    description,
    nodes: [
      {
        id: "source",
        kind: "source",
        label: "Source Set",
      },
      {
        id: "capability",
        kind: "capability",
        label: "Generated Capability",
        capability: "summarizeSource",
      },
      {
        id: "approval",
        kind: "approval",
        label: "Policy Approval",
      },
      {
        id: "receipt",
        kind: "output",
        label: "Trust Receipt",
      },
    ],
    edges: [
      { id: "e1", source: "source", target: "capability" },
      { id: "e2", source: "capability", target: "approval" },
      { id: "e3", source: "approval", target: "receipt" },
    ],
    policy: {
      idempotency: "required-for-external-effects",
      approval: "required-before-publish-send-spend-delete",
      audit: "record-workflow-run-and-trust-receipt",
    },
  };
  const files: readonly GeneratedFile[] = [
    {
      path: `${basePath}/${name}.workflow.json`,
      content: `${JSON.stringify(graph, null, 2)}\n`,
    },
    {
      path: `${basePath}/${name}.metadata.json`,
      content: `${JSON.stringify(
        {
          workflow: name,
          description,
          surfaces: ["web", "cli", "mcp"],
          requiredCapabilities: ["summarizeSource", "createTrustReceipt"],
          typedErrors: ["Unauthorized", "ValidationFailed", "PolicyDenied"],
          requiredFiles: [
            "durable workflow graph",
            "tests",
            "headless registry entry",
            "docs",
          ],
          migrationNotes: [
            "Persist only durable workflow metadata, never React Flow node state.",
            "Add migration notes when the workflow writes durable run/event rows.",
          ],
        },
        null,
        2,
      )}\n`,
    },
    {
      path: `${basePath}/${name}.test.ts`,
      content: `import { describe, expect, it } from "vitest";
import graph from "./${name}.workflow.json";

describe("${name} generated workflow graph", () => {
  it("has a connected source-to-receipt graph", () => {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));

    expect(graph.edges).toHaveLength(3);
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });
});
`,
    },
    {
      path: `${basePath}/README.md`,
      content: `# ${pascalName} Workflow

${description}

## Generated Files

- \`${name}.workflow.json\`: React Flow friendly durable graph seed.
- \`${name}.metadata.json\`: headless surfaces, typed errors, and required capabilities.
- \`${name}.test.ts\`: graph integrity scaffold.

## Required Follow-Up

1. Replace sample capability refs with generated or existing capability names.
2. Add save/validate/run Confect functions for this workflow.
3. Wire the graph into \`packages/workflow-ui\` and the headless registry.
4. Add replay, retry, idempotency, approval, and receipt tests.
`,
    },
  ];

  return {
    name,
    pascalName,
    files,
  };
};

export const buildCapabilityPromotionFiles = (
  options: PromotionGeneratorOptions,
): PromotionGeneratorResult => {
  const name = camelCase(options.name);
  const pascalName = pascalCase(options.name);
  const description =
    options.description ??
    `Promoted ${name} capability. Replace the deterministic template body with client-specific domain logic.`;
  const basePath = `packages/convex/confect/capabilities/${name}`;
  const files: readonly GeneratedFile[] = [
    {
      path: `${basePath}/${name}.spec.ts`,
      content: `import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import { Forbidden, Unauthorized, ValidationFailed } from "../../errors";

export const ${name}Args = Schema.Struct({
  workspaceSlug: Schema.String,
  input: Schema.String,
  idempotencyKey: Schema.String,
});

export const ${name}Returns = Schema.Struct({
  status: Schema.Literal("accepted"),
  summary: Schema.String,
});

export const ${name} = FunctionSpec.publicMutation({
  name: "${name}",
  args: () => ${name}Args,
  returns: () => ${name}Returns,
  error: () => Schema.Union(Unauthorized, ValidationFailed, Forbidden),
});

export default GroupSpec.make().addFunction(${name});
`,
    },
    {
      path: `${basePath}/${name}.impl.ts`,
      content: `import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../../_generated/schema";
import ${name}Group, { ${name} } from "./${name}.spec";

const ${name}Impl = FunctionImpl.make(
  databaseSchema,
  ${name}Group,
  "${name}",
  ({ workspaceSlug, input }) =>
    Effect.succeed({
      status: "accepted" as const,
      summary: \`${description} Workspace: \${workspaceSlug}. Input: \${input}.\`,
    }),
);

export default GroupImpl.make(databaseSchema, ${name}Group).pipe(
  Layer.provide(${name}Impl),
  GroupImpl.finalize,
);
`,
    },
    {
      path: `${basePath}/${name}.headless.json`,
      content: `${JSON.stringify(
        {
          capability: name,
          promoted: true,
          targetGroup: `capabilities/${name}`,
          authScope: "workspace member",
          typedErrors: ["Unauthorized", "ValidationFailed", "Forbidden"],
          surfaces: ["api", "cli", "mcp"],
          migrationNotes: [
            "Run Confect codegen before wiring generated refs.",
            "Document durable schema changes before promotion.",
          ],
          frontendAdapter: "required when exposed in web",
        },
        null,
        2,
      )}\n`,
    },
    {
      path: `${basePath}/README.md`,
      content: `# ${pascalName} Promoted Capability

${description}

## Promotion Contract

- Confect spec: \`${name}.spec.ts\`
- Confect impl: \`${name}.impl.ts\`
- Typed errors: Unauthorized, ValidationFailed, Forbidden
- Headless surfaces: API, CLI, MCP

## Required Follow-Up

1. Add this group to the Confect spec tree.
2. Run \`pnpm confect:codegen\`.
3. Wire generated refs into web/API/CLI/MCP surfaces.
4. Replace the deterministic implementation with client-specific domain logic.
5. Run \`pnpm check:confect-contracts\` and focused capability tests.
`,
    },
  ];

  return {
    name,
    pascalName,
    target: "capability",
    files,
    followUp: [
      "Add promoted group to the Confect spec tree.",
      "Run pnpm confect:codegen and inspect generated refs.",
      "Wire generated refs into selected headless and web surfaces.",
      "Run pnpm check:confect-contracts and focused capability tests.",
    ],
  };
};

export const buildWorkflowPromotionFiles = (
  options: PromotionGeneratorOptions,
): PromotionGeneratorResult => {
  const name = camelCase(options.name);
  const pascalName = pascalCase(options.name);
  const description =
    options.description ??
    `Promoted ${name} workflow. Replace sample capability refs with client-specific steps.`;
  const basePath = `packages/convex/confect/workflows/${name}`;
  const files: readonly GeneratedFile[] = [
    {
      path: `${basePath}/${name}.spec.ts`,
      content: `import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import { Unauthorized, ValidationFailed } from "../../errors";

export const ${name}RunArgs = Schema.Struct({
  workspaceSlug: Schema.String,
  sourceSetId: Schema.String,
  idempotencyKey: Schema.String,
});

export const ${name}RunReturns = Schema.Struct({
  status: Schema.Literal("queued"),
  workflow: Schema.Literal("${name}"),
  runId: Schema.String,
});

export const run = FunctionSpec.publicMutation({
  name: "run",
  args: () => ${name}RunArgs,
  returns: () => ${name}RunReturns,
  error: () => Schema.Union(Unauthorized, ValidationFailed),
});

export default GroupSpec.make().addFunction(run);
`,
    },
    {
      path: `${basePath}/${name}.impl.ts`,
      content: `import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../../_generated/schema";
import ${name}Group, { run } from "./${name}.spec";

const runImpl = FunctionImpl.make(
  databaseSchema,
  ${name}Group,
  "run",
  ({ workspaceSlug, idempotencyKey }) =>
    Effect.succeed({
      status: "queued" as const,
      workflow: "${name}" as const,
      runId: \`${name}_\${workspaceSlug}_\${idempotencyKey}\`,
    }),
);

export default GroupImpl.make(databaseSchema, ${name}Group).pipe(
  Layer.provide(runImpl),
  GroupImpl.finalize,
);
`,
    },
    {
      path: `${basePath}/${name}.workflow.json`,
      content: `${JSON.stringify(
        {
          id: name,
          name: pascalName,
          description,
          promoted: true,
          nodes: [
            { id: "source", kind: "source", label: "Source Set" },
            {
              id: "capability",
              kind: "capability",
              label: "Generated Capability",
              capability: "summarizeSource",
            },
            { id: "approval", kind: "approval", label: "Policy Approval" },
            { id: "receipt", kind: "output", label: "Trust Receipt" },
          ],
          edges: [
            { id: "e1", source: "source", target: "capability" },
            { id: "e2", source: "capability", target: "approval" },
            { id: "e3", source: "approval", target: "receipt" },
          ],
          migrationNotes: [
            "Keep React Flow view data derived from this durable graph.",
            "Document workflow run/event schema changes before promotion.",
          ],
          frontendAdapter: "packages/workflow-ui derived graph adapter",
          headlessRegistry: "required",
        },
        null,
        2,
      )}\n`,
    },
    {
      path: `${basePath}/README.md`,
      content: `# ${pascalName} Promoted Workflow

${description}

## Promotion Contract

- Confect run spec: \`${name}.spec.ts\`
- Confect run impl: \`${name}.impl.ts\`
- Durable graph seed: \`${name}.workflow.json\`

## Required Follow-Up

1. Add this group to the Confect spec tree.
2. Wire the graph into \`packages/workflow-ui\` and the headless registry.
3. Replace sample capability refs with promoted capability names.
4. Add replay, retry, idempotency, approval, and Trust Receipt tests.
5. Run \`pnpm confect:codegen\`, \`pnpm check:workflow-graph-boundary\`, and focused workflow tests.
`,
    },
  ];

  return {
    name,
    pascalName,
    target: "workflow",
    files,
    followUp: [
      "Add promoted workflow group to the Confect spec tree.",
      "Wire the durable graph into workflow UI and headless registry surfaces.",
      "Run pnpm confect:codegen and inspect generated refs.",
      "Run pnpm check:workflow-graph-boundary and focused workflow tests.",
    ],
  };
};

export const buildTemplateUpgradeReport = (options: {
  readonly from: string;
  readonly to: string;
}): TemplateUpgradeReport => {
  const changedPackages = [
    "packages/convex",
    "packages/template-core",
    "packages/workflow-ui",
    "packages/integrations",
    "tooling/generators",
  ];
  const envChanges = [
    "Review WorkOS, PostHog, Dodo, MailerSend, LLM, storage, and search env names.",
    "Confirm fake/test/live provider mode still matches template-instance.json.",
  ];
  const migrations = [
    "Run schema migration notes before promoting durable Convex table changes.",
    "Run Confect codegen and inspect generated refs before merging.",
  ];
  const generatedContractDiffs = [
    "Compare Confect specs, generated refs, OpenAPI, CLI, MCP, and workflow metadata.",
    "Re-run capability/workflow generators for client-owned extensions if contracts changed.",
  ];
  const privatePackageCompatibility = [
    "Review private-packages/* for template API compatibility before upgrade.",
    "Keep client-specific code under private-packages until contract review passes.",
  ];
  const manualReview = [
    "Move client-specific edits out of template core into private packages before upgrade.",
    "Review provider adapter substitutions and redaction rules.",
    "Verify hosted reference app, executable API handler, and headless CLI/MCP behavior.",
  ];
  const commands = [
    "pnpm review:readiness",
    "pnpm template:doctor -- --mode fake",
    "pnpm check:confect-contracts",
    "pnpm check:workflow-graph-boundary",
    "pnpm check:secret-canaries",
    "pnpm check:schema-migration-notes",
    "pnpm build",
    "pnpm smoke:web-static",
  ];

  return {
    from: options.from,
    to: options.to,
    ok: Boolean(options.from.trim() && options.to.trim()),
    changedPackages,
    envChanges,
    migrations,
    generatedContractDiffs,
    privatePackageCompatibility,
    manualReview,
    commands,
  };
};

type PrivatePackageManifest = {
  readonly name?: string;
  readonly capabilities?: readonly string[];
  readonly workflows?: readonly string[];
  readonly agents?: readonly string[];
  readonly docs?: readonly string[];
};

const privatePackageName = (
  fixturePath: string,
  manifest?: PrivatePackageManifest,
): string =>
  manifest?.name?.trim() || slugify(basename(fixturePath)) || "client-package";

const privatePackageCapabilityFiles = (
  packageName: string,
  capabilityName: string,
): readonly GeneratedFile[] => {
  const name = camelCase(capabilityName);
  const pascalName = pascalCase(capabilityName);
  const basePath = `private-packages/${packageName}/src/capabilities/${name}`;

  return [
    {
      path: `${basePath}/${name}.contract.json`,
      content: `${JSON.stringify(
        {
          capability: name,
          packageName,
          authScope: "workspace member",
          typedErrors: ["Unauthorized", "ValidationFailed", "Forbidden"],
          surfaces: ["api", "cli", "mcp"],
          promotionCommand: `pnpm template:promote-capability -- --name ${name} --write`,
        },
        null,
        2,
      )}\n`,
    },
    {
      path: `${basePath}/README.md`,
      content: `# ${pascalName} Capability Module

Private package capability module for \`${packageName}\`.

## Import Checklist

1. Review fixture redaction and source ownership.
2. Promote with \`pnpm template:promote-capability -- --name ${name} --write\`.
3. Replace deterministic implementation with client-specific domain logic.
4. Run \`pnpm check:confect-contracts\` and focused capability tests.
`,
    },
  ];
};

const privatePackageWorkflowFiles = (
  packageName: string,
  workflowName: string,
): readonly GeneratedFile[] => {
  const name = camelCase(workflowName);
  const pascalName = pascalCase(workflowName);
  const basePath = `private-packages/${packageName}/src/workflows/${name}`;

  return [
    {
      path: `${basePath}/${name}.workflow.json`,
      content: `${JSON.stringify(
        {
          workflow: name,
          packageName,
          promoted: false,
          nodes: [
            { id: "source", kind: "source", label: "Source Set" },
            {
              id: "capability",
              kind: "capability",
              label: "Private Capability",
            },
            { id: "approval", kind: "approval", label: "Policy Approval" },
            { id: "receipt", kind: "output", label: "Trust Receipt" },
          ],
          edges: [
            { id: "e1", source: "source", target: "capability" },
            { id: "e2", source: "capability", target: "approval" },
            { id: "e3", source: "approval", target: "receipt" },
          ],
        },
        null,
        2,
      )}\n`,
    },
    {
      path: `${basePath}/README.md`,
      content: `# ${pascalName} Workflow Module

Private package workflow module for \`${packageName}\`.

## Import Checklist

1. Review graph nodes, approvals, idempotency, and Trust Receipt policy.
2. Promote with \`pnpm template:promote-workflow -- --name ${name} --write\`.
3. Replace placeholder capability refs with reviewed capability modules.
4. Run \`pnpm check:workflow-graph-boundary\` and focused workflow tests.
`,
    },
  ];
};

const privatePackageIndexFile = (
  packageName: string,
  capabilities: readonly string[],
  workflows: readonly string[],
  docs: readonly string[],
): GeneratedFile => ({
  path: `private-packages/${packageName}/src/index.ts`,
  content: `export const privatePackage = ${JSON.stringify(
    {
      packageName,
      capabilities: capabilities.map(camelCase),
      workflows: workflows.map(camelCase),
      docs,
      requiredChecks: [
        "pnpm check:confect-contracts",
        "pnpm check:workflow-graph-boundary",
        "pnpm check:schema-migration-notes",
        "pnpm check:secret-canaries",
      ],
    },
    null,
    2,
  )} as const;
`,
});

export const buildPrivatePackagePlan = (options: {
  readonly fixturePath: string;
  readonly mode?: "dry-run" | "import";
}): PrivatePackagePlan => {
  const mode = options.mode ?? "dry-run";
  const manifestPath = resolve(options.fixturePath, "template-package.json");
  const manifest = readOptionalJson<PrivatePackageManifest>(manifestPath);
  const packageName = privatePackageName(options.fixturePath, manifest);
  const capabilities = manifest?.capabilities?.length
    ? manifest.capabilities
    : ["summarizeSource"];
  const workflows = manifest?.workflows?.length
    ? manifest.workflows
    : ["sourceGroundedPlan"];
  const docs = manifest?.docs?.length ? manifest.docs : ["README.md"];
  const checks: DoctorCheck[] = [
    {
      id: "fixture:manifest",
      label: "Package manifest",
      status: manifest ? "pass" : "warn",
      detail: manifest
        ? `Found ${manifestPath}`
        : "No template-package.json found; using safe default package plan",
    },
    {
      id: "fixture:redaction",
      label: "Fixture redaction",
      status: "pass",
      detail: "Generated plan contains no raw customer data or secret values.",
    },
    {
      id: "fixture:contracts",
      label: "Generated contracts",
      status: "pass",
      detail: "Capabilities and workflows require Confect contract checks.",
    },
  ];
  const files: GeneratedFile[] = [
    {
      path: `private-packages/${packageName}/package-plan.json`,
      content: `${JSON.stringify(
        {
          packageName,
          reviewBoundary: "private-packages-first",
          contractReview: "required-before-promotion",
          capabilities,
          workflows,
          agents: manifest?.agents ?? [],
          docs,
          ownershipNotes: [
            "Assign a client/package owner before promotion.",
            "Confirm source ownership, retention, and redaction posture.",
          ],
          migrationNotes: [
            "Do not promote directly into template core.",
            "Promote reviewed contracts through template:promote-* commands.",
          ],
          requiredChecks: [
            "pnpm check:confect-contracts",
            "pnpm check:schema-migration-notes",
            "pnpm check:secret-canaries",
          ],
        },
        null,
        2,
      )}\n`,
    },
    {
      path: `private-packages/${packageName}/README.md`,
      content: `# ${packageName} Private Package

This package plan is generated from \`${options.fixturePath}\`.

## Contents

- Capabilities: ${capabilities.join(", ")}
- Workflows: ${workflows.join(", ")}
- Docs: ${docs.join(", ")}

## Required Checks

- \`pnpm check:confect-contracts\`
- \`pnpm check:schema-migration-notes\`
- \`pnpm check:secret-canaries\`
`,
    },
    privatePackageIndexFile(packageName, capabilities, workflows, docs),
    ...capabilities.flatMap((capability) =>
      privatePackageCapabilityFiles(packageName, capability),
    ),
    ...workflows.flatMap((workflow) =>
      privatePackageWorkflowFiles(packageName, workflow),
    ),
  ];

  return {
    fixturePath: options.fixturePath,
    mode,
    ok: checks.every((check) => check.status !== "fail"),
    packageName,
    files,
    checks,
  };
};

const parseArgs = (
  argv: readonly string[],
): {
  readonly command: string | undefined;
  readonly name: string | undefined;
  readonly blueprint: BlueprintId;
  readonly from: string | undefined;
  readonly to: string | undefined;
  readonly fixture: string | undefined;
  readonly mode: ProviderMode;
  readonly exposure: "web" | "workflow" | "headless";
  readonly description: string | undefined;
  readonly write: boolean;
  readonly path: string;
} => {
  const [command] = argv;
  const nameIndex = argv.indexOf("--name");
  const blueprintIndex = argv.indexOf("--blueprint");
  const modeIndex = argv.indexOf("--mode");
  const pathIndex = argv.indexOf("--path");
  const exposureIndex = argv.indexOf("--exposure");
  const descriptionIndex = argv.indexOf("--description");
  const fromIndex = argv.indexOf("--from");
  const toIndex = argv.indexOf("--to");
  const fixtureIndex = argv.indexOf("--fixture");
  const mode = modeIndex >= 0 ? argv[modeIndex + 1] : undefined;
  const blueprint =
    blueprintIndex >= 0 ? argv[blueprintIndex + 1] : defaultBlueprintId;
  const exposure =
    exposureIndex >= 0 ? (argv[exposureIndex + 1] ?? "headless") : "headless";

  if (
    plannedBlueprintIds.includes(
      blueprint as (typeof plannedBlueprintIds)[number],
    )
  ) {
    throw new Error(
      `Blueprint ${blueprint} is planned, not generator-supported. Supported blueprints: ${defaultBlueprintId}`,
    );
  }

  if (!buildBlueprintCatalog().some((entry) => entry.id === blueprint)) {
    throw new Error(`Unknown blueprint: ${blueprint}`);
  }

  if (mode && !["fake", "test", "live"].includes(mode)) {
    throw new Error(`Unknown mode: ${mode}`);
  }

  if (!["web", "workflow", "headless"].includes(exposure)) {
    throw new Error(`Unknown exposure: ${exposure}`);
  }

  const path = pathIndex >= 0 ? argv[pathIndex + 1] : undefined;

  return {
    command,
    name: nameIndex >= 0 ? argv[nameIndex + 1] : undefined,
    blueprint: blueprint as BlueprintId,
    from: fromIndex >= 0 ? argv[fromIndex + 1] : undefined,
    to: toIndex >= 0 ? argv[toIndex + 1] : undefined,
    fixture: fixtureIndex >= 0 ? argv[fixtureIndex + 1] : undefined,
    mode: (mode ?? "fake") as ProviderMode,
    exposure: exposure as "web" | "workflow" | "headless",
    description: descriptionIndex >= 0 ? argv[descriptionIndex + 1] : undefined,
    write: argv.includes("--write"),
    path: path || "template-instance.json",
  };
};

export const runGeneratorCli = (
  argv: readonly string[],
  cwd = process.cwd(),
): {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
} => {
  try {
    const args = parseArgs(argv);
    const outputPath = resolve(cwd, args.path);

    if (!args.command || args.command === "help" || args.command === "--help") {
      return {
        exitCode: 0,
        stdout:
          [
            `Supported blueprints: ${buildBlueprintCatalog()
              .map((blueprint) => blueprint.id)
              .join(", ")}`,
            `Planned blueprints: ${plannedBlueprintIds.join(", ")}`,
            "template:init [--name <name>] [--mode fake|test|live] [--write] [--path <file>]",
            "template:doctor [--mode fake|test|live] [--path <file>]",
            "template:quickstart [--blueprint source-grounded-gtm-brain] [--name <name>] [--mode fake|test|live] [--write]",
            "template:intake [--blueprint source-grounded-gtm-brain] [--name <name>] [--mode fake|test|live] [--write]",
            "template:seed-demo [--blueprint source-grounded-gtm-brain] [--mode fake|test|live] [--write]",
            "template:handoff [--blueprint source-grounded-gtm-brain] [--name <name>] [--mode fake|test|live] [--write]",
            "template:add-client-domain --name <name> [--description <text>] [--write]",
            "template:add-capability --name <name> [--description <text>] [--exposure web|workflow|headless] [--write]",
            "template:add-workflow --name <name> [--description <text>] [--write]",
            "template:promote-capability --name <name> [--description <text>] [--write]",
            "template:promote-workflow --name <name> [--description <text>] [--write]",
            "template:upgrade --from <client-version> --to <template-version>",
            "template:private-package:dry-run --fixture <path>",
            "template:private-package:import --fixture <path> [--write]",
          ].join("\n") + "\n",
        stderr: "",
      };
    }

    if (args.command === "init") {
      const instance = buildTemplateInstance(
        args.name
          ? {
              name: args.name,
              blueprint: args.blueprint,
              providerMode: args.mode,
            }
          : { blueprint: args.blueprint, providerMode: args.mode },
      );
      const json = `${JSON.stringify(instance, null, 2)}\n`;

      if (args.write) {
        writeFileSync(outputPath, json);
      }

      return {
        exitCode: 0,
        stdout: json,
        stderr: "",
      };
    }

    if (args.command === "doctor") {
      if (!existsSync(outputPath)) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Missing template instance: ${outputPath}\n`,
        };
      }

      const instance = parseTemplateInstance(readFileSync(outputPath, "utf8"));
      const report = doctorTemplateInstance(instance, {
        mode: args.mode,
        instancePath: outputPath,
      });

      return {
        exitCode: report.ok ? 0 : 1,
        stdout: `${JSON.stringify(report, null, 2)}\n`,
        stderr: "",
      };
    }

    if (args.command === "quickstart") {
      const quickstart = buildTemplateQuickstart({
        ...(args.name ? { name: args.name } : {}),
        blueprint: args.blueprint,
        providerMode: args.mode,
      });

      if (args.write) {
        writeGeneratedFiles(quickstart.files, cwd);
      }

      return {
        exitCode: 0,
        stdout: `${JSON.stringify(quickstart, null, 2)}\n`,
        stderr: "",
      };
    }

    if (args.command === "intake") {
      const intake = buildClientIntake({
        ...(args.name ? { name: args.name } : {}),
        blueprint: args.blueprint,
        providerMode: args.mode,
      });

      if (args.write) {
        writeGeneratedFiles(intake.files, cwd);
      }

      return {
        exitCode: 0,
        stdout: `${JSON.stringify(intake, null, 2)}\n`,
        stderr: "",
      };
    }

    if (args.command === "seed-demo") {
      const instance = existsSync(outputPath)
        ? parseTemplateInstance(readFileSync(outputPath, "utf8"))
        : buildTemplateInstance({
            ...(args.name ? { name: args.name } : {}),
            blueprint: args.blueprint,
            providerMode: args.mode,
          });
      const seed = buildDemoSeedPlan({
        blueprint: args.blueprint,
        workspaceSlug: instance.slug,
        providerMode: args.mode,
      });
      const file: GeneratedFile = {
        path: `examples/demo-seed/${args.blueprint}/demo-seed.json`,
        content: `${JSON.stringify(seed, null, 2)}\n`,
      };

      if (args.write) {
        writeGeneratedFiles([file], cwd);
      }

      return {
        exitCode: 0,
        stdout: `${JSON.stringify(seed, null, 2)}\n`,
        stderr: "",
      };
    }

    if (args.command === "handoff") {
      const instance = existsSync(outputPath)
        ? parseTemplateInstance(readFileSync(outputPath, "utf8"))
        : buildTemplateInstance({
            ...(args.name ? { name: args.name } : {}),
            blueprint: args.blueprint,
            providerMode: args.mode,
          });
      const packet = buildHandoffPacket({
        name: args.name ?? instance.name,
        blueprint: args.blueprint,
        mode: args.mode,
      });
      const file: GeneratedFile = {
        path: "docs/template/generated/handoff-packet.md",
        content: packet.markdown,
      };

      if (args.write) {
        writeGeneratedFiles([file], cwd);
      }

      return {
        exitCode: 0,
        stdout: `${JSON.stringify(packet, null, 2)}\n`,
        stderr: "",
      };
    }

    if (args.command === "add-client-domain") {
      if (!args.name) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing required --name for add-client-domain\n",
        };
      }

      const result = buildClientDomainFiles({
        name: args.name,
        ...(args.description ? { description: args.description } : {}),
      });

      if (args.write) {
        writeGeneratedFiles(result.files, cwd);
      }

      return {
        exitCode: 0,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: "",
      };
    }

    if (args.command === "add-capability") {
      if (!args.name) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing required --name for add-capability\n",
        };
      }

      const result = buildCapabilityFiles({
        name: args.name,
        exposure: args.exposure,
        ...(args.description ? { description: args.description } : {}),
      });

      if (args.write) {
        writeGeneratedFiles(result.files, cwd);
      }

      return {
        exitCode: 0,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: "",
      };
    }

    if (args.command === "add-workflow") {
      if (!args.name) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing required --name for add-workflow\n",
        };
      }

      const result = buildWorkflowFiles({
        name: args.name,
        ...(args.description ? { description: args.description } : {}),
      });

      if (args.write) {
        writeGeneratedFiles(result.files, cwd);
      }

      return {
        exitCode: 0,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: "",
      };
    }

    if (args.command === "promote-capability") {
      if (!args.name) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing required --name for promote-capability\n",
        };
      }

      const result = buildCapabilityPromotionFiles({
        name: args.name,
        ...(args.description ? { description: args.description } : {}),
      });

      if (args.write) {
        writeGeneratedFiles(result.files, cwd);
      }

      return {
        exitCode: 0,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: "",
      };
    }

    if (args.command === "promote-workflow") {
      if (!args.name) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing required --name for promote-workflow\n",
        };
      }

      const result = buildWorkflowPromotionFiles({
        name: args.name,
        ...(args.description ? { description: args.description } : {}),
      });

      if (args.write) {
        writeGeneratedFiles(result.files, cwd);
      }

      return {
        exitCode: 0,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: "",
      };
    }

    if (args.command === "upgrade") {
      if (!args.from || !args.to) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing required --from or --to for upgrade\n",
        };
      }

      const report = buildTemplateUpgradeReport({
        from: args.from,
        to: args.to,
      });

      return {
        exitCode: report.ok ? 0 : 1,
        stdout: `${JSON.stringify(report, null, 2)}\n`,
        stderr: "",
      };
    }

    if (
      args.command === "private-package:dry-run" ||
      args.command === "private-package:import"
    ) {
      if (!args.fixture) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Missing required --fixture for ${args.command}\n`,
        };
      }

      const plan = buildPrivatePackagePlan({
        fixturePath: resolve(cwd, args.fixture),
        mode: args.command === "private-package:import" ? "import" : "dry-run",
      });

      if (args.command === "private-package:import" && args.write) {
        writeGeneratedFiles(plan.files, cwd);
      }

      return {
        exitCode: plan.ok ? 0 : 1,
        stdout: `${JSON.stringify(plan, null, 2)}\n`,
        stderr: "",
      };
    }

    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unknown generator command: ${args.command}\n`,
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
};

if (
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js")
) {
  const result = runGeneratorCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
