import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");

describe("Notion Kit reusable shell contract", () => {
  it("adapts Notion Kit sidebar, navbar, and tooltip primitives", () => {
    const shell = read("src/shell/template-workspace-shell.tsx");

    expect(shell).toContain("@notion-kit/ui/sidebar");
    expect(shell).toContain("@notion-kit/ui/navbar");
    expect(shell).toContain("@notion-kit/ui/primitives");
    expect(shell).toContain("SidebarProvider");
    expect(shell).toContain("Sidebar");
    expect(shell).toContain("SidebarHeader");
    expect(shell).toContain("SidebarContent");
    expect(shell).toContain("SidebarFooter");
    expect(shell).toContain("SidebarRail");
    expect(shell).toContain("SidebarInset");
    expect(shell).toContain("SidebarClose");
    expect(shell).toContain("SidebarOpen");
    expect(shell).toContain("Navbar");
  });

  it("keeps route and action sidebar rows as typed adapters", () => {
    const shell = read("src/shell/template-workspace-shell.tsx");

    expect(shell).toContain("TemplateRouteItem");
    expect(shell).toContain("TemplateActionItem");
    expect(shell).toContain("TemplateFooterItem");
    expect(shell).toContain("template-sidebar-menuitem");
  });

  it("wires active route state, expandable groups, and collapsed controls", () => {
    const shell = read("src/shell/template-workspace-shell.tsx");

    expect(shell).toContain("TemplateMainContent");
    expect(shell).toContain('className="template-shell-content"');
    expect(shell).toContain('aria-current={isActive ? "page" : undefined}');
    expect(shell).toContain("activeKey === item.key");
    expect(shell).toContain("data-default-expanded");
    expect(shell).toContain("category.defaultExpanded");
    expect(shell).toContain('SidebarClose aria-label="Close sidebar"');
    expect(shell).toContain('SidebarOpen aria-label="Open sidebar"');
    expect(shell).toContain("SidebarRail enableDrag");
  });

  it("closes the mobile offcanvas sidebar after route navigation", () => {
    const shell = read("src/shell/template-workspace-shell.tsx");

    expect(shell).toContain("useSidebar");
    expect(shell).toContain("isMobile");
    expect(shell).toContain("window.setTimeout");
    expect(shell).toContain("}, 150)");
    expect(shell).toContain("setOpenMobile(false)");
  });
});
