import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCapabilityFiles,
  buildTemplateInstance,
  buildWorkflowFiles,
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
});
