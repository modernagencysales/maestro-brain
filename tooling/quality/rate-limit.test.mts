import { describe, expect, it } from "vitest";

import {
  MAX_RATE_LIMIT_RETRIES,
  isRateLimitStatus,
  rateLimitDelayMs,
} from "./rate-limit.mts";

function headers(map: Record<string, string>): Pick<Response, "headers"> {
  return { headers: new Headers(map) };
}

describe("rate-limit", () => {
  it("treats 429 and 529 as rate-limited, others not", () => {
    expect(isRateLimitStatus(429)).toBe(true);
    expect(isRateLimitStatus(529)).toBe(true);
    expect(isRateLimitStatus(400)).toBe(false);
    expect(isRateLimitStatus(200)).toBe(false);
  });

  it("prefers the retry-after header, with a 1s buffer", () => {
    expect(rateLimitDelayMs(headers({ "retry-after": "28" }), "", 0)).toBe(
      29_000,
    );
  });

  it("falls back to the body 'try again in N seconds' hint", () => {
    expect(
      rateLimitDelayMs(headers({}), "Please try again in 25 seconds.", 0),
    ).toBe(26_000);
  });

  it("uses capped exponential backoff when no hint is present", () => {
    expect(rateLimitDelayMs(headers({}), "rate limited", 0)).toBe(2_000);
    expect(rateLimitDelayMs(headers({}), "rate limited", 3)).toBe(16_000);
    expect(rateLimitDelayMs(headers({}), "rate limited", 10)).toBe(60_000);
  });

  it("bounds in-process retries to a small positive number", () => {
    expect(MAX_RATE_LIMIT_RETRIES).toBeGreaterThan(0);
    expect(MAX_RATE_LIMIT_RETRIES).toBeLessThanOrEqual(10);
  });
});
