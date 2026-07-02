import { describe, expect, it } from "vitest";
import {
  createErrorReporter,
  createPostHogCapture,
  redactObservabilityPayload,
} from "./index";

describe("observability provider seams", () => {
  it("captures PostHog events in fake mode without throwing", async () => {
    const captured: unknown[] = [];
    const posthog = createPostHogCapture({
      mode: "fake",
      sink: (event) => {
        captured.push(event);
      },
    });

    await expect(
      posthog.capture({
        event: "template.workflow.started",
        distinctId: "user_123",
        properties: { workspaceSlug: "acme-demo", apiKey: "secret" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      delivery: "fake",
    });
    expect(JSON.stringify(captured)).not.toContain("secret");
  });

  it("keeps capture failures non-fatal", async () => {
    const posthog = createPostHogCapture({
      mode: "live",
      sink: () => {
        throw new Error("posthog unavailable");
      },
    });

    await expect(
      posthog.capture({
        event: "template.workflow.started",
        distinctId: "user_123",
        properties: { workspaceSlug: "acme-demo" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      delivery: "dropped",
      retryable: true,
    });
  });

  it("reports errors through fake/test/live-ready reporters with redaction", async () => {
    const reported: unknown[] = [];
    const reporter = createErrorReporter({
      mode: "test",
      sink: (event) => {
        reported.push(event);
      },
    });

    await expect(
      reporter.report({
        error: new Error("raw secret payload"),
        context: { requestId: "req_123", token: "secret" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      delivery: "test",
    });
    expect(JSON.stringify(reported)).not.toContain("secret");
    expect(redactObservabilityPayload({ token: "secret", safe: true })).toEqual(
      {
        token: "[redacted]",
        safe: true,
      },
    );
  });
});
