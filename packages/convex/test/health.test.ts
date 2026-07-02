import { describe, expect, it } from "vitest";
import healthSpec, { TemplateHealthReport } from "../confect/ops/health.spec";
import { buildTemplateHealthReport } from "../confect/ops/health";

describe("template health Confect group", () => {
  it("builds a typed liveness report for fake/test/live environments", () => {
    expect(
      buildTemplateHealthReport({
        environment: "fake",
        commitSha: "abc123",
        checkedAt: 1_700_000_000_000,
      }),
    ).toEqual({
      ok: true,
      service: "maestro-template",
      environment: "fake",
      commitSha: "abc123",
      checkedAt: 1_700_000_000_000,
      checks: [
        { id: "runtime", status: "pass", detail: "process is responsive" },
        { id: "confect", status: "pass", detail: "health group registered" },
        {
          id: "providers",
          status: "pass",
          detail: "fake providers do not require live secrets",
        },
      ],
    });
  });

  it("exports schemas that encode the liveness report", () => {
    const report = buildTemplateHealthReport({
      environment: "test",
      commitSha: "abc123",
      checkedAt: 1_700_000_000_000,
    });

    expect(TemplateHealthReport.make(report)).toEqual(report);
    expect(healthSpec).toBeDefined();
  });
});
