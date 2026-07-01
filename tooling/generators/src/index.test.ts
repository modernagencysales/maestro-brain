import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCapabilityFiles,
  buildCapabilityPromotionFiles,
  buildPrivatePackagePlan,
  buildTemplateInstance,
  buildTemplateUpgradeReport,
  buildWorkflowFiles,
  buildWorkflowPromotionFiles,
  doctorTemplateInstance,
  runGeneratorCli,
} from "./index";

describe("template app factory generators", () => {
  it("builds a fake-provider template instance by default", () => {
    const instance = buildTemplateInstance({
      name: "North Star Brain",
      generatedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(instance).toMatchObject({
      name: "North Star Brain",
      slug: "north-star-brain",
      providerMode: "fake",
      providers: {
        convex: "fake",
        email: "console",
        storage: "local",
      },
    });
    expect(instance.modules).toEqual([
      "brain",
      "workflows",
      "capabilities",
      "agents",
      "api",
      "mcp",
      "integrations",
      "safety",
    ]);
  });

  it("doctors fake instances without requiring live secrets", () => {
    const report = doctorTemplateInstance(buildTemplateInstance(), {
      mode: "fake",
      instancePath: "template-instance.json",
    });

    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.status !== "fail")).toBe(true);
    expect(report.checks.map((check) => check.id)).toContain("provider:workos");
  });

  it("warns when a fake instance is doctored for live mode", () => {
    const report = doctorTemplateInstance(buildTemplateInstance(), {
      mode: "live",
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "provider:workos",
        status: "warn",
      }),
    );
  });

  it("writes and doctors an instance through the CLI", () => {
    const cwd = mkdtempSync(join(tmpdir(), "maestro-template-generator-"));

    try {
      const init = runGeneratorCli(
        ["init", "--name", "Client Brain", "--write"],
        cwd,
      );
      const doctor = runGeneratorCli(["doctor", "--mode", "fake"], cwd);

      expect(init.exitCode).toBe(0);
      expect(JSON.parse(init.stdout)).toMatchObject({
        slug: "client-brain",
      });
      expect(doctor.exitCode).toBe(0);
      expect(JSON.parse(doctor.stdout)).toMatchObject({
        ok: true,
        mode: "fake",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds Confect-oriented capability generator files", () => {
    const generated = buildCapabilityFiles({
      name: "summarize source",
      description: "Summarizes an approved source set.",
      exposure: "headless",
    });

    expect(generated).toMatchObject({
      name: "summarizeSource",
      pascalName: "SummarizeSource",
      exposure: "headless",
    });
    expect(generated.files.map((file) => file.path)).toEqual([
      "generated/capabilities/summarizeSource/summarizeSource.spec.ts",
      "generated/capabilities/summarizeSource/summarizeSource.impl.ts",
      "generated/capabilities/summarizeSource/summarizeSource.test.ts",
      "generated/capabilities/summarizeSource/summarizeSource.headless.json",
      "generated/capabilities/summarizeSource/README.md",
    ]);
    expect(generated.files[0]?.content).toContain(
      "FunctionSpec.publicMutation",
    );
    expect(generated.files[3]?.content).toContain('"surfaces"');
  });

  it("writes generated capability files through the CLI", () => {
    const cwd = mkdtempSync(join(tmpdir(), "maestro-template-capability-"));

    try {
      const result = runGeneratorCli(
        [
          "add-capability",
          "--name",
          "summarize source",
          "--description",
          "Summarizes an approved source set.",
          "--write",
        ],
        cwd,
      );
      const specPath = join(
        cwd,
        "generated/capabilities/summarizeSource/summarizeSource.spec.ts",
      );
      const metadataPath = join(
        cwd,
        "generated/capabilities/summarizeSource/summarizeSource.headless.json",
      );

      expect(result.exitCode).toBe(0);
      expect(existsSync(specPath)).toBe(true);
      expect(readFileSync(specPath, "utf8")).toContain("summarizeSourceArgs");
      expect(JSON.parse(readFileSync(metadataPath, "utf8"))).toMatchObject({
        capability: "summarizeSource",
        surfaces: ["api", "cli", "mcp"],
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds workflow generator files with graph and headless metadata", () => {
    const generated = buildWorkflowFiles({
      name: "source grounded plan",
      description: "Builds a sourced plan with approval and receipt.",
    });

    expect(generated).toMatchObject({
      name: "sourceGroundedPlan",
      pascalName: "SourceGroundedPlan",
    });
    expect(generated.files.map((file) => file.path)).toEqual([
      "generated/workflows/sourceGroundedPlan/sourceGroundedPlan.workflow.json",
      "generated/workflows/sourceGroundedPlan/sourceGroundedPlan.metadata.json",
      "generated/workflows/sourceGroundedPlan/sourceGroundedPlan.test.ts",
      "generated/workflows/sourceGroundedPlan/README.md",
    ]);
    expect(JSON.parse(generated.files[0]?.content ?? "{}")).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "source" }),
        expect.objectContaining({ id: "receipt" }),
      ]),
    });
    expect(JSON.parse(generated.files[1]?.content ?? "{}")).toMatchObject({
      surfaces: ["web", "cli", "mcp"],
      requiredCapabilities: ["summarizeSource", "createTrustReceipt"],
    });
  });

  it("writes generated workflow files through the CLI", () => {
    const cwd = mkdtempSync(join(tmpdir(), "maestro-template-workflow-"));

    try {
      const result = runGeneratorCli(
        [
          "add-workflow",
          "--name",
          "source grounded plan",
          "--description",
          "Builds a sourced plan with approval and receipt.",
          "--write",
        ],
        cwd,
      );
      const graphPath = join(
        cwd,
        "generated/workflows/sourceGroundedPlan/sourceGroundedPlan.workflow.json",
      );

      expect(result.exitCode).toBe(0);
      expect(existsSync(graphPath)).toBe(true);
      expect(JSON.parse(readFileSync(graphPath, "utf8"))).toMatchObject({
        id: "sourceGroundedPlan",
        policy: {
          audit: "record-workflow-run-and-trust-receipt",
        },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds production-target capability promotion files", () => {
    const promoted = buildCapabilityPromotionFiles({
      name: "summarize source",
      description: "Summarizes an approved source set.",
    });

    expect(promoted).toMatchObject({
      name: "summarizeSource",
      pascalName: "SummarizeSource",
      target: "capability",
    });
    expect(promoted.files.map((file) => file.path)).toEqual([
      "packages/convex/confect/capabilities/summarizeSource/summarizeSource.spec.ts",
      "packages/convex/confect/capabilities/summarizeSource/summarizeSource.impl.ts",
      "packages/convex/confect/capabilities/summarizeSource/summarizeSource.headless.json",
      "packages/convex/confect/capabilities/summarizeSource/README.md",
    ]);
    expect(promoted.files[0]?.content).toContain("FunctionSpec.publicMutation");
    expect(promoted.files[1]?.content).toContain(
      'import databaseSchema from "../../_generated/schema"',
    );
    expect(promoted.followUp).toContain(
      "Run pnpm confect:codegen and inspect generated refs.",
    );
  });

  it("writes promoted capability files through the CLI", () => {
    const cwd = mkdtempSync(join(tmpdir(), "maestro-template-promote-cap-"));

    try {
      const result = runGeneratorCli(
        [
          "promote-capability",
          "--name",
          "summarize source",
          "--description",
          "Summarizes an approved source set.",
          "--write",
        ],
        cwd,
      );
      const specPath = join(
        cwd,
        "packages/convex/confect/capabilities/summarizeSource/summarizeSource.spec.ts",
      );

      expect(result.exitCode).toBe(0);
      expect(existsSync(specPath)).toBe(true);
      expect(readFileSync(specPath, "utf8")).toContain("summarizeSourceArgs");
      expect(JSON.parse(result.stdout)).toMatchObject({
        target: "capability",
        name: "summarizeSource",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds production-target workflow promotion files", () => {
    const promoted = buildWorkflowPromotionFiles({
      name: "source grounded plan",
      description: "Builds a sourced plan with approval and receipt.",
    });

    expect(promoted).toMatchObject({
      name: "sourceGroundedPlan",
      pascalName: "SourceGroundedPlan",
      target: "workflow",
    });
    expect(promoted.files.map((file) => file.path)).toEqual([
      "packages/convex/confect/workflows/sourceGroundedPlan/sourceGroundedPlan.spec.ts",
      "packages/convex/confect/workflows/sourceGroundedPlan/sourceGroundedPlan.impl.ts",
      "packages/convex/confect/workflows/sourceGroundedPlan/sourceGroundedPlan.workflow.json",
      "packages/convex/confect/workflows/sourceGroundedPlan/README.md",
    ]);
    expect(promoted.files[0]?.content).toContain("FunctionSpec.publicMutation");
    expect(promoted.files[2]?.content).toContain('"promoted": true');
    expect(promoted.followUp).toContain(
      "Run pnpm confect:codegen and inspect generated refs.",
    );
  });

  it("writes promoted workflow files through the CLI", () => {
    const cwd = mkdtempSync(join(tmpdir(), "maestro-template-promote-flow-"));

    try {
      const result = runGeneratorCli(
        [
          "promote-workflow",
          "--name",
          "source grounded plan",
          "--description",
          "Builds a sourced plan with approval and receipt.",
          "--write",
        ],
        cwd,
      );
      const graphPath = join(
        cwd,
        "packages/convex/confect/workflows/sourceGroundedPlan/sourceGroundedPlan.workflow.json",
      );

      expect(result.exitCode).toBe(0);
      expect(existsSync(graphPath)).toBe(true);
      expect(JSON.parse(readFileSync(graphPath, "utf8"))).toMatchObject({
        id: "sourceGroundedPlan",
        promoted: true,
      });
      expect(JSON.parse(result.stdout)).toMatchObject({
        target: "workflow",
        name: "sourceGroundedPlan",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds a client-fork upgrade report", () => {
    const report = buildTemplateUpgradeReport({
      from: "client-v1.0.0",
      to: "template-v1.1.0",
    });

    expect(report).toMatchObject({
      from: "client-v1.0.0",
      to: "template-v1.1.0",
      ok: true,
      changedPackages: expect.arrayContaining([
        "packages/convex",
        "packages/integrations",
      ]),
      envChanges: expect.arrayContaining([expect.stringContaining("WorkOS")]),
      generatedContractDiffs: expect.arrayContaining([
        expect.stringContaining("OpenAPI"),
      ]),
      commands: expect.arrayContaining([
        "pnpm review:readiness",
        "pnpm check:confect-contracts",
      ]),
    });
  });

  it("prints a client-fork upgrade report through the CLI", () => {
    const result = runGeneratorCli([
      "upgrade",
      "--from",
      "client-v1.0.0",
      "--to",
      "template-v1.1.0",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      from: "client-v1.0.0",
      to: "template-v1.1.0",
      ok: true,
    });
  });

  it("builds a private package dry-run plan from a fixture manifest", () => {
    const cwd = mkdtempSync(join(tmpdir(), "maestro-template-private-"));
    const fixture = join(cwd, "fixtures/generic-ai-ops");

    try {
      mkdirSync(fixture, { recursive: true });
      writeFileSync(
        join(fixture, "template-package.json"),
        JSON.stringify({
          name: "generic-ai-ops",
          capabilities: ["summarizeSource", "draftPlan"],
          workflows: ["sourceGroundedPlan"],
          agents: ["planner"],
          docs: ["README.md", "playbook.md"],
        }),
        { flag: "w" },
      );

      const plan = buildPrivatePackagePlan({ fixturePath: fixture });

      expect(plan).toMatchObject({
        mode: "dry-run",
        ok: true,
        packageName: "generic-ai-ops",
        files: expect.arrayContaining([
          expect.objectContaining({
            path: "private-packages/generic-ai-ops/package-plan.json",
          }),
          expect.objectContaining({
            path: "private-packages/generic-ai-ops/src/index.ts",
          }),
          expect.objectContaining({
            path: "private-packages/generic-ai-ops/src/capabilities/summarizeSource/summarizeSource.contract.json",
          }),
          expect.objectContaining({
            path: "private-packages/generic-ai-ops/src/workflows/sourceGroundedPlan/sourceGroundedPlan.workflow.json",
          }),
        ]),
      });
      expect(plan.checks).toContainEqual(
        expect.objectContaining({
          id: "fixture:manifest",
          status: "pass",
        }),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("imports a private package plan through the CLI when write is explicit", () => {
    const cwd = mkdtempSync(join(tmpdir(), "maestro-template-private-import-"));
    const fixture = join(cwd, "fixtures/generic-ai-ops");

    try {
      mkdirSync(fixture, { recursive: true });
      writeFileSync(
        join(fixture, "template-package.json"),
        JSON.stringify({
          name: "generic-ai-ops",
          capabilities: ["summarizeSource"],
          workflows: ["sourceGroundedPlan"],
        }),
        { flag: "w" },
      );

      const dryRun = runGeneratorCli(
        ["private-package:dry-run", "--fixture", "fixtures/generic-ai-ops"],
        cwd,
      );
      const imported = runGeneratorCli(
        [
          "private-package:import",
          "--fixture",
          "fixtures/generic-ai-ops",
          "--write",
        ],
        cwd,
      );
      const planPath = join(
        cwd,
        "private-packages/generic-ai-ops/package-plan.json",
      );
      const indexPath = join(
        cwd,
        "private-packages/generic-ai-ops/src/index.ts",
      );
      const capabilityPath = join(
        cwd,
        "private-packages/generic-ai-ops/src/capabilities/summarizeSource/summarizeSource.contract.json",
      );
      const workflowPath = join(
        cwd,
        "private-packages/generic-ai-ops/src/workflows/sourceGroundedPlan/sourceGroundedPlan.workflow.json",
      );

      expect(dryRun.exitCode).toBe(0);
      expect(JSON.parse(dryRun.stdout)).toMatchObject({
        mode: "dry-run",
        packageName: "generic-ai-ops",
      });
      expect(imported.exitCode).toBe(0);
      expect(existsSync(planPath)).toBe(true);
      expect(existsSync(indexPath)).toBe(true);
      expect(existsSync(capabilityPath)).toBe(true);
      expect(existsSync(workflowPath)).toBe(true);
      expect(JSON.parse(readFileSync(planPath, "utf8"))).toMatchObject({
        packageName: "generic-ai-ops",
        requiredChecks: expect.arrayContaining(["pnpm check:secret-canaries"]),
      });
      expect(readFileSync(indexPath, "utf8")).toContain("privatePackage");
      expect(JSON.parse(readFileSync(capabilityPath, "utf8"))).toMatchObject({
        capability: "summarizeSource",
        promotionCommand:
          "pnpm template:promote-capability -- --name summarizeSource --write",
      });
      expect(JSON.parse(readFileSync(workflowPath, "utf8"))).toMatchObject({
        workflow: "sourceGroundedPlan",
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "source" }),
          expect.objectContaining({ id: "receipt" }),
        ]),
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
