import { useEffect, useState } from "react";
import {
  NotionDocumentPage,
  TemplateLiveRegion,
  TemplateNetworkBanner,
  TemplateSkipLink,
  TemplateToastProvider,
  TemplateWorkspaceShell,
  type NotionDocumentPageModel,
} from "@maestro-template/ui";
import {
  WorkflowCanvas,
  WorkflowGraphCanvas,
} from "@maestro-template/workflow-ui";
import { TEMPLATE_NAV_CATEGORIES } from "../navigation/workspace";
import { LiveWorkflowRunsPanel } from "../features/workflows/live-runs-panel";
import { navItems } from "./navItems";
import { overviewPage, pages, type DocumentPage } from "./sampleDocumentData";

type RenderedDocumentPage = Omit<DocumentPage, "diagram"> &
  Pick<NotionDocumentPageModel, "diagram" | "diagramLabel">;

const pageById = new Map(pages.map((page) => [page.id, page]));
const routeKeyToPageId = new Map<string, string>([
  ["home", "overview"],
  ["brain", "brain"],
  ["workflows", "workflows"],
  ["capabilities", "capabilities"],
  ["agents", "agents"],
  ["runs", "runs"],
  ["documents", "documents"],
  ["sources", "sources"],
  ["api", "headless"],
  ["onboarding", "onboarding"],
  ["dataMap", "data-map"],
  ["notifications", "notifications"],
  ["integrations", "integrations"],
  ["settings", "settings"],
  ["legal", "legal"],
  ["billing", "billing"],
  ["analytics", "analytics"],
  ["health", "safety"],
  ["admin", "admin"],
]);
const pageIdToRouteKey = new Map(
  [...routeKeyToPageId.entries()].map(([key, value]) => [value, key]),
);
const sampleNavigation = TEMPLATE_NAV_CATEGORIES.map((category) => ({
  ...category,
  items: category.items.map((item) => ({
    key: item.key,
    label: item.key === "health" ? "Safety" : item.label,
    icon: item.icon,
    href: `#${routeKeyToPageId.get(item.key) ?? item.key}`,
    ...(item.key === "api" ? { hint: "Scalar" } : {}),
  })),
}));
const fallbackPageId = navItems[0]?.id ?? "overview";
const resolvePageIdFromHash = (hashValue: string) => {
  const pageId = hashValue.replace(/^#/, "");

  return pageById.has(pageId) ? pageId : fallbackPageId;
};

const toRenderedPage = (page: DocumentPage): RenderedDocumentPage => {
  const { diagram, ...documentPage } = page;

  if (!diagram) {
    return documentPage;
  }

  return {
    ...documentPage,
    diagramLabel: diagram.label,
    diagram: diagram.graph ? (
      <WorkflowGraphCanvas graph={diagram.graph} />
    ) : (
      <WorkflowCanvas nodes={diagram.nodes ?? []} edges={diagram.edges ?? []} />
    ),
  };
};

export function App() {
  const [activePageId, setActivePageId] = useState<string>(() =>
    typeof window === "undefined"
      ? fallbackPageId
      : resolvePageIdFromHash(window.location.hash),
  );
  const activePage = pageById.get(activePageId) ?? overviewPage;
  const activeRouteKey = pageIdToRouteKey.get(activePage.id) ?? "home";

  useEffect(() => {
    const handleHashChange = () => {
      setActivePageId(resolvePageIdFromHash(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return (
    <>
      <TemplateSkipLink />
      <TemplateLiveRegion
        message={`Viewing ${activePage.id === "overview" ? "Overview" : activePage.title}`}
      />
      <TemplateNetworkBanner state="online" />
      <TemplateToastProvider>
        <TemplateWorkspaceShell
          title="Maestro Template"
          subtitle="Private AI app factory"
          navigation={sampleNavigation}
          activeKey={activeRouteKey}
          topbarTitle={activePage.title}
          onNavigate={(key) => {
            const pageId = routeKeyToPageId.get(key) ?? "overview";

            if (typeof window !== "undefined") {
              window.location.hash = pageId;
            }
            setActivePageId(pageId);
          }}
        >
          <NotionDocumentPage page={toRenderedPage(activePage)} />
          {activePage.id === "workflows" ? <LiveWorkflowRunsPanel /> : null}
        </TemplateWorkspaceShell>
      </TemplateToastProvider>
    </>
  );
}
