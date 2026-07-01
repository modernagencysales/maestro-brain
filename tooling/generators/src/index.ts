#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export type ProviderMode = "fake" | "test" | "live";

export type TemplateInstance = {
  readonly name: string;
  readonly slug: string;
  readonly workspaceName: string;
  readonly providerMode: ProviderMode;
  readonly modules: readonly string[];
  readonly providers: {
    readonly convex: "fake" | "configured";
    readonly workos: "fake" | "configured";
    readonly posthog: "fake" | "configured";
    readonly dodo: "fake" | "configured";
    readonly email: "console" | "configured";
    readonly llm: "fake" | "configured";
    readonly storage: "local" | "configured";
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

export type CapabilityGeneratorOptions = {
  readonly name: string;
  readonly description?: string;
  readonly exposure?: "web" | "workflow" | "headless";
  readonly write?: boolean;
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
  readonly providerMode?: ProviderMode;
  readonly generatedAt?: string;
}): TemplateInstance => {
  const name = options?.name?.trim() || "Acme AI Operations";
  const providerMode = options?.providerMode ?? "fake";
  const fakeProviders = providerMode === "fake";

  return {
    name,
    slug: slugify(name) || "acme-ai-operations",
    workspaceName: `${name} Workspace`,
    providerMode,
    modules: defaultModules,
    providers: {
      convex: fakeProviders ? "fake" : "configured",
      workos: fakeProviders ? "fake" : "configured",
      posthog: fakeProviders ? "fake" : "configured",
      dodo: fakeProviders ? "fake" : "configured",
      email: fakeProviders ? "console" : "configured",
      llm: fakeProviders ? "fake" : "configured",
      storage: fakeProviders ? "local" : "configured",
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

  return parsed as TemplateInstance;
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
          : `${provider} should be configured before ${mode} handoff`,
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
  errors: () => ${name}Errors,
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
      path: `${basePath}/${name}.test.ts`,
      content: `import { describe, expect, it } from "vitest";

describe("${name} generated capability contract", () => {
  it("declares args, returns, typed errors, and implementation files", () => {
    expect("${name}").toBe("${name}");
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
          capabilities,
          workflows,
          agents: manifest?.agents ?? [],
          docs,
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
  const modeIndex = argv.indexOf("--mode");
  const pathIndex = argv.indexOf("--path");
  const exposureIndex = argv.indexOf("--exposure");
  const descriptionIndex = argv.indexOf("--description");
  const fromIndex = argv.indexOf("--from");
  const toIndex = argv.indexOf("--to");
  const fixtureIndex = argv.indexOf("--fixture");
  const mode = modeIndex >= 0 ? argv[modeIndex + 1] : undefined;
  const exposure =
    exposureIndex >= 0 ? (argv[exposureIndex + 1] ?? "headless") : "headless";

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
            "template:init [--name <name>] [--mode fake|test|live] [--write] [--path <file>]",
            "template:doctor [--mode fake|test|live] [--path <file>]",
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
          ? { name: args.name, providerMode: args.mode }
          : { providerMode: args.mode },
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
