import { describe, expect, it } from "vitest";
import {
  createConfectFailureEvent,
  createErrorReporter,
  createPostHogCapture,
  normalizeErrorReport,
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

  it("reports normalized errors with release, environment, and redaction", async () => {
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
        context: {
          requestId: "req_123",
          token: "secret",
          nested: { authorization: "bearer secret" },
        },
        release: "template-v1.2.3",
        environment: "staging",
        severity: "fatal",
        handled: true,
        tags: { surface: "workflow" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      delivery: "test",
    });
    expect(JSON.stringify(reported)).not.toContain("secret");
    expect(reported).toEqual([
      expect.objectContaining({
        type: "template.error",
        name: "Error",
        message: "Error captured.",
        severity: "fatal",
        handled: true,
        release: "template-v1.2.3",
        environment: "staging",
        fingerprint: expect.stringMatching(/^err_/),
        context: {
          requestId: "req_123",
          token: "[redacted]",
          nested: { authorization: "[redacted]" },
        },
        tags: { surface: "workflow" },
      }),
    ]);
  });

  it("normalizes unknown errors without leaking raw object payloads", () => {
    expect(
      normalizeErrorReport({
        error: { apiKey: "secret" },
        context: { safe: true },
      }),
    ).toMatchObject({
      type: "template.error",
      name: "UnknownError",
      message: "Error captured.",
      release: "unreleased",
      environment: "unknown",
      severity: "error",
      handled: false,
    });
  });

  it("redacts observability payloads recursively", () => {
    expect(
      redactObservabilityPayload({
        token: "secret",
        safe: true,
        nested: { password: "secret", values: [{ apiKey: "secret" }] },
      }),
    ).toEqual({
      token: "[redacted]",
      safe: true,
      nested: { password: "[redacted]", values: [{ apiKey: "[redacted]" }] },
    });
  });

  it("keeps error reporter sink failures non-fatal", async () => {
    const reporter = createErrorReporter({
      mode: "live",
      sink: () => {
        throw new Error("sentry unavailable");
      },
    });

    await expect(
      reporter.report({
        error: new Error("provider failed"),
        context: { requestId: "req_123" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      delivery: "dropped",
      retryable: true,
    });
  });

  it("builds redacted Confect failure events for PostHog", () => {
    expect(
      createConfectFailureEvent({
        functionPath: "brain/pages.createMarkdown",
        kind: "mutation",
        errorTag: "MemberNotInWorkspace",
        errorMessage: "Denied",
        causeHash: "cause_123",
        workspaceId: "workspaces_1",
        userId: "users_1",
      }),
    ).toEqual({
      event: "template.confect.failure",
      distinctId: "users_1",
      properties: {
        functionPath: "brain/pages.createMarkdown",
        kind: "mutation",
        errorTag: "MemberNotInWorkspace",
        errorMessage: "Denied",
        causeHash: "cause_123",
        workspaceId: "workspaces_1",
      },
    });
  });

  it("uses system distinctId for Confect failures without a user", () => {
    expect(
      createConfectFailureEvent({
        functionPath: "brain/pages.reindex",
        kind: "action",
        errorTag: "ActionFailed",
        errorMessage: "Action failed",
        causeHash: "cause_456",
      }),
    ).toMatchObject({
      event: "template.confect.failure",
      distinctId: "system",
      properties: {
        functionPath: "brain/pages.reindex",
        kind: "action",
        errorTag: "ActionFailed",
        errorMessage: "Action failed",
        causeHash: "cause_456",
      },
    });
  });
});
