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
    expect(read("src/routes/_workspace.onboarding.tsx")).toContain(
      "toastForOnboardingContinue",
    );
    expect(read("src/routes/_workspace.onboarding.tsx")).toContain(
      "useTemplateToast",
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
    expect(manifest.icons).toEqual([
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ]);
    expect(JSON.stringify(manifest).toLowerCase()).not.toContain("offline");
  });

  it("ships starter-safe public SEO assets", () => {
    expect(read("public/robots.txt")).toContain(
      "Sitemap: https://maestro-template.pages.dev/sitemap.xml",
    );
    expect(read("public/sitemap.xml")).toContain(
      "https://maestro-template.pages.dev/onboarding",
    );
    expect(read("public/favicon.svg")).toContain("Maestro Template");
    expect(read("public/social-card.svg")).toContain("Maestro Template");
    expect(read("src/routes/__root.tsx")).toContain("buildTemplateRouteHead");
  });
});
