import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): string =>
  readFileSync(resolve(appRoot, path), "utf8");

describe("Notion Kit shell style contract", () => {
  it("loads Notion Kit style.css through the template notion stylesheet", () => {
    expect(read("src/notion.css")).toContain(
      '@import "@notion-kit/ui/style.css"',
    );
  });

  it("loads notion.css and index.css from the root route head", () => {
    const root = read("src/routes/__root.tsx");

    expect(root).toContain("../notion.css?url");
    expect(root).toContain("../index.css?url");
  });

  it("uses the reusable Notion Kit shell instead of the old sample stylesheet shell", () => {
    const app = read("src/sample/App.tsx");

    expect(app).toContain("TemplateWorkspaceShell");
    expect(app).not.toContain("AppFrame");
    expect(app).not.toContain("./sample/styles.css");
  });

  it("owns global route UX wiring at the root route", () => {
    const root = read("src/routes/__root.tsx");
    const boundary = read("src/navigation/route-ux-boundary.tsx");
    const network = read("src/navigation/network-state.ts");

    expect(root).toContain("WebRouteUxBoundary");
    expect(root).toContain("TemplateToastProvider");
    expect(root).toContain("useRouterState");
    expect(root).toContain("<Outlet />");
    expect(boundary).toContain("TemplateRouteFocusBoundary");
    expect(boundary).toContain("describeRouteAnnouncement");
    expect(boundary).toContain("useBrowserNetworkState");
    expect(boundary).toContain("networkState={networkState}");
    expect(boundary).toContain("hashchange");
    expect(network).toContain('"online"');
    expect(network).toContain('"offline"');
  });

  it("uses reusable route pending and error surfaces", () => {
    const router = read("src/router.tsx");

    expect(router).toContain("TemplateRoutePending");
    expect(router).toContain("TemplateRouteError");
    expect(router).toContain("Return to overview");
    expect(router).not.toContain("defaultPendingComponent: () => null");
    expect(router).not.toContain("<main>Not Found</main>");
  });

  it("keeps nested sidebar route links inside the Notion Kit menu row hit target", () => {
    const css = read("src/index.css");

    expect(css).toContain(".template-sidebar-menuitem");
    expect(css).toContain("overflow: hidden");
    expect(css).toContain("height: 100%");
    expect(css).toContain("min-height: 0");
  });

  it("defines UX safety classes and reduced-motion behavior", () => {
    const css = read("src/index.css");

    expect(css).toContain(".template-skip-link");
    expect(css).toContain(".template-live-region");
    expect(css).toContain(".template-shell-content");
    expect(css).toContain(".template-network-banner");
    expect(css).toContain(".template-empty-state");
    expect(css).toContain(".template-dialog-backdrop");
    expect(css).toContain(".template-dialog");
    expect(css).toContain(".template-toast-region");
    expect(css).toContain(".template-route-state");
    expect(css).toContain(".template-route-state-actions");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".workflow-canvas .react-flow__edge.animated path");
  });
});
