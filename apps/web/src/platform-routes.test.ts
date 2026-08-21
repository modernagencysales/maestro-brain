import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activeTemplateRouteKey,
  REFERENCE_ROUTE_ITEMS,
  TEMPLATE_ROUTE_ITEMS,
} from "./navigation/workspace";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): string =>
  readFileSync(resolve(appRoot, path), "utf8");

describe("frontend platform routes", () => {
  it("registers the Maestro Brain product routes", () => {
    expect(TEMPLATE_ROUTE_ITEMS.map((item) => item.key)).toEqual([
      "clients",
      "brain",
      "connections",
      "settings",
    ]);
    expect(TEMPLATE_ROUTE_ITEMS.find((item) => item.key === "clients")).toEqual(
      expect.objectContaining({ label: "Clients", path: "/clients" }),
    );
    expect(TEMPLATE_ROUTE_ITEMS.find((item) => item.key === "brain")).toEqual(
      expect.objectContaining({ label: "Agency Brain", path: "/brain" }),
    );
    expect(activeTemplateRouteKey("/clients/acme")).toBe("clients");
    expect(activeTemplateRouteKey("/connections/slack")).toBe("connections");
    expect(activeTemplateRouteKey("/legal/privacy")).toBeNull();
  });

  it("routes the product through the canonical upstream chassis", () => {
    for (const item of TEMPLATE_ROUTE_ITEMS) {
      const route = `src/routes/_workspace.${item.path.slice(1).replaceAll("/", ".")}.tsx`;
      expect(
        existsSync(resolve(appRoot, route)),
        `${item.path} should exist`,
      ).toBe(true);
    }

    expect(read("src/routes/_workspace.tsx")).toContain("<DashboardLayout");
    expect(read("src/routes/_workspace.tsx")).toContain("ssr: false");
    expect(existsSync(resolve(appRoot, "src/saas-ui/business-shell.tsx"))).toBe(
      false,
    );
    expect(read("src/routes/_workspace.clients.tsx")).toContain(
      "ClientsScreen",
    );
    expect(read("src/routes/_workspace.connections.tsx")).toContain(
      "ConnectionsRouteAdapter",
    );
  });

  it("keeps reference routes and prebuilt archetype screens available", () => {
    expect(REFERENCE_ROUTE_ITEMS.map((item) => item.path)).toContain("/legal");
    expect(REFERENCE_ROUTE_ITEMS.map((item) => item.path)).toContain(
      "/data-lifecycle",
    );
    expect(
      existsSync(resolve(appRoot, "src/routes/_workspace.legal.tsx")),
    ).toBe(true);
    expect(
      existsSync(resolve(appRoot, "src/routes/_workspace.onboarding.tsx")),
    ).toBe(true);
    expect(
      existsSync(resolve(appRoot, "src/routes/_workspace.notifications.tsx")),
    ).toBe(true);
    expect(
      existsSync(resolve(appRoot, "src/routes/_workspace.data-lifecycle.tsx")),
    ).toBe(true);
    for (const route of [
      "contacts",
      "inbox",
      "reports",
      "forms",
      "kanban",
      "states",
    ]) {
      expect(
        existsSync(resolve(appRoot, `src/routes/_workspace.${route}.tsx`)),
      ).toBe(true);
    }
    expect(read("src/routes/dashboard.tsx")).toContain("DashboardPage");
  });

  it("adapts reference screens to the generated route topology", () => {
    expect(read("src/routes/_workspace.contacts.tsx")).toContain(
      "component: ContactsRoute",
    );
    expect(read("src/routes/_workspace.contacts.$contactId.tsx")).toContain(
      "Route.useParams()",
    );
    expect(read("src/routes/_workspace.inbox.tsx")).toContain(
      "component: InboxRoute",
    );

    for (const feature of [
      "src/features/contacts/inbox/inbox-list.tsx",
      "src/features/contacts/list/add-person-dialog.tsx",
      "src/features/contacts/list/contact-card.tsx",
      "src/features/contacts/list/list-page.tsx",
      "src/features/contacts/view/contact-page.tsx",
      "src/features/settings/common/settings-sidebar.tsx",
    ]) {
      expect(read(feature)).not.toContain("/$workspace");
    }
  });

  it("ships starter-safe public assets", () => {
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
    expect(read("src/routes/__root.tsx")).toContain("buildTemplateRouteHead");
  });
});
