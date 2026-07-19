import { describe, expect, it } from "vitest";
import {
  createBrainMetric,
  enforceBrainBudget,
  redactBrainMetricPayload,
} from "./brainMetrics";

describe("Brain operations metrics", () => {
  it("emits only ids, hashes, counts, durations, status, and error tags", () => {
    const metric = createBrainMetric({
      subsystem: "classification",
      workspaceId: "workspaces_123",
      brainKey: "brn_456",
      sourceHash: "sha256:abc",
      prompt: "customer prompt must not leak",
      token: "token-canary-value",
      authorization: "header-canary-value",
      inputText: "raw customer source",
      count: 4,
      durationMs: 12,
      status: "degraded",
      errorTag: "ProviderUnavailable",
      measuredAt: "2026-07-18T00:00:00.000Z",
    });

    expect(JSON.stringify(metric)).not.toContain("customer prompt");
    expect(JSON.stringify(metric)).not.toContain("token-canary-value");
    expect(JSON.stringify(metric)).not.toContain("header-canary-value");
    expect(JSON.stringify(metric)).not.toContain("raw customer source");
    expect(metric).toMatchObject({
      subsystem: "classification",
      workspaceId: "workspaces_123",
      sourceHash: "sha256:abc",
      count: 4,
      durationMs: 12,
      status: "degraded",
      errorTag: "ProviderUnavailable",
    });
  });

  it("enforces model, Slack, storage, queue, and channel budgets", () => {
    expect(
      enforceBrainBudget("modelTokens", 999, { modelTokens: 1_000 }),
    ).toEqual({ ok: true });
    expect(
      enforceBrainBudget("modelTokens", 1_001, { modelTokens: 1_000 }),
    ).toEqual({
      ok: false,
      errorTag: "BudgetExceeded",
      budget: "modelTokens",
      limit: 1_000,
      observed: 1_001,
    });
    expect(
      enforceBrainBudget("slackRate", 51, { slackRate: 50 }),
    ).toMatchObject({
      ok: false,
      budget: "slackRate",
    });
  });

  it("redacts prompt, source, token, and header canaries recursively", () => {
    expect(
      redactBrainMetricPayload({
        prompt: "prompt-canary",
        sourceText: "source-canary",
        headers: { authorization: "header-canary" },
        nested: [{ refreshToken: "token-canary" }],
      }),
    ).toEqual({
      prompt: "[redacted]",
      sourceText: "[redacted]",
      headers: "[redacted]",
      nested: [{ refreshToken: "[redacted]" }],
    });
  });
});
