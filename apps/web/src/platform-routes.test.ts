import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activeTemplateRouteKey,
  TEMPLATE_ROUTE_ITEMS,
} from "./navigation/workspace";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): string =>
  readFileSync(resolve(appRoot, path), "utf8");

describe("frontend platform routes", () => {
  it("registers legal and onboarding workspace routes in navigation", () => {
    expect(TEMPLATE_ROUTE_ITEMS.map((item) => item.key)).toContain("legal");
    expect(TEMPLATE_ROUTE_ITEMS.find((item) => item.key === "legal")).toEqual(
      expect.objectContaining({
        label: "Legal",
        path: "/legal",
      }),
    );
    expect(activeTemplateRouteKey("/legal/privacy")).toBe("legal");
    expect(activeTemplateRouteKey("/onboarding")).toBe("onboarding");
  });

  it("defines legal and onboarding route files as template placeholders", () => {
    expect(
      existsSync(resolve(appRoot, "src/routes/_workspace.legal.tsx")),
    ).toBe(true);
    expect(
      existsSync(resolve(appRoot, "src/routes/_workspace.onboarding.tsx")),
    ).toBe(true);
    expect(read("src/routes/_workspace.legal.tsx")).toContain(
      "Replace these legal placeholders per client",
    );
    expect(read("src/routes/_workspace.onboarding.tsx")).toContain(
      "TemplateOnboardingChecklist",
    );
    expect(read("src/routes/_workspace.onboarding.tsx")).toContain(
      "buildOnboardingChecklistSteps",
    );
  });

  it("ships a PWA manifest without unsupported offline claims", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as Record<
      string,
      unknown
    >;

    expect(manifest).toMatchObject({
      name: "Maestro Template",
      short_name: "Maestro",
      display: "standalone",
      start_url: "/",
    });
    expect(JSON.stringify(manifest).toLowerCase()).not.toContain("offline");
  });
});
