import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string): string =>
  readFileSync(resolve(appRoot, path), "utf8");

describe("AuthKit browser routes", () => {
  it("registers callback and sign-in server handlers", () => {
    const callbackPath = resolve(appRoot, "src/routes/api.auth.callback.tsx");
    const signInPath = resolve(appRoot, "src/routes/api.auth.sign-in.tsx");

    expect(existsSync(callbackPath)).toBe(true);
    expect(existsSync(signInPath)).toBe(true);

    expect(read("src/routes/api.auth.callback.tsx")).toContain(
      "GET: handleCallbackRoute()",
    );
    const signIn = read("src/routes/api.auth.sign-in.tsx");
    expect(signIn).toContain("await getSignInUrl(");
    expect(signIn).toContain("status: 307");
  });

  it("redirects signed-out live requests before mounting providers", () => {
    const root = read("src/routes/__root.tsx");

    expect(root).toContain('workspaceRuntimeMode !== "fake"');
    expect(root).toContain('authSnapshot.status === "signedOut"');
    expect(root).toContain("/api/auth/sign-in?returnPathname=");
    expect(root.indexOf("throw redirect(")).toBeLessThan(
      root.indexOf("function RootComponent"),
    );
  });
});
