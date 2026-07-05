import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const headersPath = resolve(appRoot, "public/_headers");

const parseCloudflareHeaders = (
  source: string,
): Readonly<Record<string, string>> => {
  const headers: Record<string, string> = {};

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "/*") {
      continue;
    }

    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      continue;
    }

    headers[trimmed.slice(0, separator).toLowerCase()] = trimmed
      .slice(separator + 1)
      .trim();
  }

  return headers;
};

describe("static web security headers", () => {
  it("ships Cloudflare Pages headers for the static reference app", () => {
    expect(existsSync(headersPath)).toBe(true);

    const headers = parseCloudflareHeaders(readFileSync(headersPath, "utf8"));

    expect(headers["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["permissions-policy"]).toContain("microphone=()");
  });

  it("pins a CSP that matches the current static TanStack Start shell", () => {
    const { ["content-security-policy"]: csp } = parseCloudflareHeaders(
      readFileSync(headersPath, "utf8"),
    );

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("https://*.convex.cloud");
    expect(csp).toContain("https://*.convex.site");
    expect(csp).toContain("https://*.workos.com");
    expect(csp).toContain("https://*.posthog.com");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("default-src *");
  });
});
