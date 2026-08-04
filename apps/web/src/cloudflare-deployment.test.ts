import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readWebFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Cloudflare server deployment", () => {
  it("deploys the TanStack server entry with client assets", () => {
    const vite = readWebFile("vite.config.ts");
    const pkg = JSON.parse(readWebFile("package.json")) as {
      readonly devDependencies?: Readonly<Record<string, string>>;
    };
    const wrangler = JSON.parse(readWebFile("wrangler.jsonc")) as {
      readonly main?: string;
      readonly compatibility_flags?: readonly string[];
      readonly assets?: { readonly directory?: string };
      readonly vars?: Readonly<Record<string, string>>;
    };

    expect(vite).toContain('from "@cloudflare/vite-plugin"');
    expect(vite).toContain('cloudflare({ viteEnvironment: { name: "ssr" } })');
    expect(vite).not.toContain("spa: { enabled: true }");
    expect(vite.indexOf("cloudflare({")).toBeLessThan(
      vite.indexOf("tanstackStart({"),
    );
    expect(pkg.devDependencies).toHaveProperty("@cloudflare/vite-plugin");
    expect(pkg.devDependencies).toHaveProperty("wrangler");
    expect(wrangler.main).toBe("@tanstack/react-start/server-entry");
    expect(wrangler.compatibility_flags).toContain("nodejs_compat");
    expect(wrangler.assets?.directory).toBe("./dist/client");
    expect(wrangler.vars?.APP_ENV).toBe("live");
    expect(wrangler.vars?.APP_PROVIDER_MODE).toBe("live");
    expect(wrangler.vars?.WORKOS_REDIRECT_URI).toBe(
      "https://maestro-brain-staging.tim-bb0.workers.dev/callback",
    );
    expect(wrangler.vars?.WORKOS_AUTHKIT_JWKS_URL).toBe(
      "https://api.workos.com/sso/jwks/client_01KV1TTNCJJBCXAZK7KJ2GNTHP",
    );
    expect(existsSync(new URL("../public/_redirects", import.meta.url))).toBe(
      false,
    );
  });
});
