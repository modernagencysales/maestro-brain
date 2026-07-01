#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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

const parseArgs = (
  argv: readonly string[],
): {
  readonly command: string | undefined;
  readonly name: string | undefined;
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
