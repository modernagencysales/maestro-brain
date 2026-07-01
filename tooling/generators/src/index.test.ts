import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTemplateInstance,
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
});
