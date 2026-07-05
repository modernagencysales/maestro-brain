import type { ReactNode } from "react";
import { Navbar } from "@notion-kit/ui/navbar";
import { TooltipProvider } from "@notion-kit/ui/primitives";
import {
  Sidebar,
  SidebarClose,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenuItem,
  SidebarOpen,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "@notion-kit/ui/sidebar";
import { TemplateMainContent } from "../blocks/ux-essentials";

export type TemplateShellRouteItem = {
  readonly key: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly href?: string;
  readonly hint?: string;
};

export type TemplateShellNavCategory = {
  readonly label: string;
  readonly defaultExpanded?: boolean;
  readonly items: readonly TemplateShellRouteItem[];
};

export type TemplateShellActionItem = {
  readonly key: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly hint?: string;
  readonly onSelect: () => void;
};

export type TemplateWorkspaceShellProps = {
  readonly title: string;
  readonly subtitle?: string;
  readonly activeKey?: string;
  readonly navigation: readonly TemplateShellNavCategory[];
  readonly actions?: readonly TemplateShellActionItem[];
  readonly footerItems?: readonly TemplateShellActionItem[];
  readonly topbarTitle?: string;
  readonly onNavigate?: (key: string) => void;
  readonly children: ReactNode;
};

export function TemplateRouteItem({
  item,
  activeKey,
  onNavigate,
}: {
  readonly item: TemplateShellRouteItem;
  readonly activeKey?: string;
  readonly onNavigate?: (key: string) => void;
}) {
  const isActive = activeKey === item.key;
  const { isMobile, setOpenMobile } = useSidebar();

  // label/icon/hint render ONLY inside the anchor below. Passing them to
  // SidebarMenuItem as props makes Notion Kit render a second, non-clickable
  // copy of the row that swallows most of the click area.
  return (
    <SidebarMenuItem
      className="template-sidebar-menuitem"
      label={null}
      role="none"
    >
      <a
        aria-current={isActive ? "page" : undefined}
        className={
          isActive ? "template-sidebar-row is-active" : "template-sidebar-row"
        }
        href={item.href ?? `#${item.key}`}
        onClick={(event) => {
          if (!item.href || item.href.startsWith("#")) {
            event.preventDefault();
          }

          onNavigate?.(item.key);

          if (isMobile) {
            window.setTimeout(() => {
              setOpenMobile(false);
            }, 150);
          }

          if (item.href?.startsWith("#") && typeof window !== "undefined") {
            window.history.replaceState(null, "", item.href);
          }
        }}
      >
        <span className="template-sidebar-icon" aria-hidden="true">
          {item.icon ?? item.label.slice(0, 1)}
        </span>
        <span className="template-sidebar-label">{item.label}</span>
        {item.hint ? (
          <span className="template-sidebar-hint">{item.hint}</span>
        ) : null}
      </a>
    </SidebarMenuItem>
  );
}

export function TemplateActionItem({
  item,
}: {
  readonly item: TemplateShellActionItem;
}) {
  // Same rule as TemplateRouteItem: the button is the whole row.
  return (
    <SidebarMenuItem
      className="template-sidebar-menuitem"
      label={null}
      role="none"
    >
      <button
        className="template-sidebar-row"
        onClick={item.onSelect}
        type="button"
      >
        <span className="template-sidebar-icon" aria-hidden="true">
          {item.icon ?? item.label.slice(0, 1)}
        </span>
        <span className="template-sidebar-label">{item.label}</span>
        {item.hint ? (
          <span className="template-sidebar-hint">{item.hint}</span>
        ) : null}
      </button>
    </SidebarMenuItem>
  );
}

export function TemplateFooterItem({
  item,
}: {
  readonly item: TemplateShellActionItem;
}) {
  return <TemplateActionItem item={item} />;
}

function TopbarSidebarOpen() {
  const { isMobile, open, openMobile } = useSidebar();
  const sidebarShown = isMobile ? openMobile : open;

  // Match Notion: the hamburger only exists while the sidebar is hidden.
  // Rendering it while the sidebar is open turns it into a toggle that
  // collapses the sidebar out from under keyboard/automation users.
  if (sidebarShown) {
    return null;
  }

  return <SidebarOpen aria-label="Open sidebar" />;
}

export function TemplateWorkspaceShell({
  title,
  subtitle,
  activeKey,
  navigation,
  actions = [],
  footerItems = [],
  topbarTitle,
  onNavigate,
  children,
}: TemplateWorkspaceShellProps) {
  return (
    <TooltipProvider>
      <SidebarProvider className="template-workspace-shell" defaultOpen>
        <Sidebar className="template-sidebar" collapsible="offcanvas">
          <SidebarHeader className="template-sidebar-header">
            <button className="template-workspace-switcher" type="button">
              <span className="template-workspace-mark" aria-hidden="true">
                {title.slice(0, 1)}
              </span>
              <span>
                <span className="template-workspace-name">{title}</span>
                {subtitle ? (
                  <span className="template-workspace-subtitle">
                    {subtitle}
                  </span>
                ) : null}
              </span>
            </button>
            <SidebarClose aria-label="Close sidebar" />
          </SidebarHeader>

          <SidebarContent className="template-sidebar-content">
            <nav aria-label="Primary">
              {navigation.map((category) => (
                <SidebarGroup
                  className="template-sidebar-group"
                  data-default-expanded={
                    category.defaultExpanded ? "true" : "false"
                  }
                  key={category.label}
                >
                  <p className="template-sidebar-group-label">
                    {category.label}
                  </p>
                  {category.items.map((item) => {
                    const routeProps: {
                      item: TemplateShellRouteItem;
                      activeKey?: string;
                      onNavigate?: (key: string) => void;
                    } = { item };

                    if (activeKey !== undefined) {
                      routeProps.activeKey = activeKey;
                    }

                    if (onNavigate !== undefined) {
                      routeProps.onNavigate = onNavigate;
                    }

                    return <TemplateRouteItem {...routeProps} key={item.key} />;
                  })}
                </SidebarGroup>
              ))}

              {actions.length > 0 ? (
                <SidebarGroup className="template-sidebar-group">
                  <p className="template-sidebar-group-label">Actions</p>
                  {actions.map((item) => (
                    <TemplateActionItem item={item} key={item.key} />
                  ))}
                </SidebarGroup>
              ) : null}
            </nav>
          </SidebarContent>

          <SidebarFooter className="template-sidebar-footer">
            {footerItems.map((item) => (
              <TemplateFooterItem item={item} key={item.key} />
            ))}
          </SidebarFooter>
          <SidebarRail enableDrag />
        </Sidebar>

        <SidebarInset className="template-shell-main">
          <Navbar className="template-shell-topbar" aria-label="Workspace">
            <TopbarSidebarOpen />
            <span className="template-topbar-title">
              {topbarTitle ?? title}
            </span>
            <span aria-hidden="true" />
          </Navbar>
          <TemplateMainContent className="template-shell-content">
            {children}
          </TemplateMainContent>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
