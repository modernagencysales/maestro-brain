import { describe, expect, it } from "vitest";
import {
  buildHealthBoardView,
  buildTemplateHealthReport,
} from "./health-surface";

describe("health surface presenter", () => {
  it("marks fake mode ready without live provider secrets", () => {
    const view = buildHealthBoardView({
      mode: "fake",
      env: {},
      report: buildTemplateHealthReport({
        environment: "fake",
        commitSha: "local",
        checkedAt: 1_700_000_000_000,
      }),
    });

    expect(view).toMatchObject({
      state: "ready",
      summary: {
        ready: 11,
        degraded: 0,
        blocked: 0,
      },
    });
    expect(view.checks.map((check) => check.label)).toContain("Runtime");
    expect(view.checks.map((check) => check.label)).toContain("WorkOS/AuthKit");
    expect(view.checks.every((check) => check.status === "ready")).toBe(true);
    expect(JSON.stringify(view)).not.toContain("secret-");
  });

  it("reports live provider gaps as blocked without leaking values", () => {
    const view = buildHealthBoardView({
      mode: "live",
      env: {
        DODO_API_KEY: "secret-dodo",
        DODO_WEBHOOK_SECRET: " webhook-secret ",
      },
      report: buildTemplateHealthReport({
        environment: "live",
        commitSha: "abc123",
        checkedAt: 1_700_000_000_000,
      }),
    });

    expect(view.state).toBe("ready");
    expect(view.summary.blocked).toBeGreaterThan(0);
    expect(view.checks).toContainEqual(
      expect.objectContaining({
        label: "Dodo",
        status: "blocked",
        detail: "Missing none; invalid DODO_WEBHOOK_SECRET.",
      }),
    );
    expect(JSON.stringify(view)).not.toContain("secret-dodo");
    expect(JSON.stringify(view)).not.toContain("webhook-secret");
  });

  it("maps warning health checks to degraded rows", () => {
    const view = buildHealthBoardView({
      mode: "test",
      env: {},
      report: {
        ok: true,
        service: "maestro-template",
        environment: "test",
        commitSha: "abc123",
        checkedAt: 1_700_000_000_000,
        checks: [
          {
            id: "providers",
            status: "warn",
            detail: "verify provider credentials through deploy doctor",
          },
        ],
      },
    });

    expect(view.checks).toContainEqual({
      label: "Providers",
      status: "degraded",
      detail: "verify provider credentials through deploy doctor",
    });
    expect(view.summary.degraded).toBe(1);
  });
});
