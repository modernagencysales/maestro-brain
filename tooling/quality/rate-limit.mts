/**
 * rate-limit — shared backoff helpers for the AI gate LLM calls. A 429/529
 * from a provider is a transient tokens-per-minute spike (common when a large
 * PR judges many files in a burst), not a credit problem; honoring the polite
 * retry window lets a pass self-heal instead of failing the whole gate.
 */

// invariant: bounded in-process retries; past this a 429 is treated as a real
// infrastructure block so the gate fails loudly rather than spinning.
export const MAX_RATE_LIMIT_RETRIES = 5;

export function isRateLimitStatus(status: number): boolean {
  return status === 429 || status === 529;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polite retry delay (ms) for a 429/529: prefer the `retry-after` header, then
 * the "try again in N seconds" body hint, else exponential backoff. A +1s
 * buffer ensures the next attempt lands after the provider's window resets.
 */
export function rateLimitDelayMs(
  response: Pick<Response, "headers">,
  body: string,
  attempt: number,
): number {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return (header + 1) * 1000;
  const match = /try again in (\d+)\s*seconds?/i.exec(body);
  if (match?.[1] !== undefined) return (Number(match[1]) + 1) * 1000;
  return Math.min(60_000, 2_000 * 2 ** attempt);
}
