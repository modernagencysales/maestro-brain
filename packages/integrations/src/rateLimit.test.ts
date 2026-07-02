import { describe, expect, it } from "vitest";
import {
  createFakeRateLimiter,
  mapRateLimitError,
  RateLimitDeniedError,
  tokenLimiterKey,
  workspaceLimiterKey,
} from "./rateLimit";

describe("rate limit and usage attribution seam", () => {
  it("builds stable per-workspace and per-token limiter keys", () => {
    expect(
      workspaceLimiterKey({
        workspaceSlug: "acme-demo",
        operation: "llm.complete",
      }),
    ).toBe("workspace:acme-demo:operation:llm.complete");
    expect(
      tokenLimiterKey({
        workspaceSlug: "acme-demo",
        tokenHash: "hash_123",
        operation: "workflow.run",
      }),
    ).toBe("workspace:acme-demo:token:hash_123:operation:workflow.run");
  });

  it("allows requests while quota remains and includes usage attribution", () => {
    const limiter = createFakeRateLimiter({
      maxRequests: 2,
      windowMs: 60_000,
      nowMs: () => 1_000,
    });

    expect(
      limiter.check({
        key: workspaceLimiterKey({
          workspaceSlug: "acme-demo",
          operation: "llm.complete",
        }),
        workspaceSlug: "acme-demo",
        operation: "llm.complete",
        costUnits: 1,
      }),
    ).toEqual({
      ok: true,
      key: "workspace:acme-demo:operation:llm.complete",
      remaining: 1,
      resetAt: 61_000,
      usage: {
        workspaceSlug: "acme-demo",
        operation: "llm.complete",
        costUnits: 1,
      },
    });
  });

  it("denies requests after quota is exhausted", () => {
    const limiter = createFakeRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      nowMs: () => 1_000,
    });
    const input = {
      key: tokenLimiterKey({
        workspaceSlug: "acme-demo",
        tokenHash: "hash_123",
        operation: "workflow.run",
      }),
      workspaceSlug: "acme-demo",
      operation: "workflow.run",
      costUnits: 1,
    } as const;

    expect(limiter.check(input)).toMatchObject({ ok: true });
    expect(limiter.check(input)).toMatchObject({
      ok: false,
      error: {
        _tag: "RateLimitDeniedError",
        key: "workspace:acme-demo:token:hash_123:operation:workflow.run",
        limit: 1,
        retryAfterMs: 60_000,
      },
    });
  });

  it("maps adapter failures to typed public-safe rate limit errors", () => {
    const mapped = mapRateLimitError({
      key: "workspace:acme-demo:operation:llm.complete",
      limit: 10,
      retryAfterMs: 5_000,
      raw: new Error("provider secret payload"),
    });

    expect(mapped).toBeInstanceOf(RateLimitDeniedError);
    expect(mapped).toMatchObject({
      _tag: "RateLimitDeniedError",
      key: "workspace:acme-demo:operation:llm.complete",
      limit: 10,
      retryAfterMs: 5_000,
    });
    expect(JSON.stringify(mapped)).not.toContain("secret");
  });
});
