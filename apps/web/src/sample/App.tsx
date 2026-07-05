import { useEffect, useState } from "react";
import {
  NotionDocumentPage,
  TemplateWorkspaceShell,
  type NotionDocumentPageModel,
} from "@maestro-template/ui";
import {
  WorkflowCanvas,
  WorkflowGraphCanvas,
} from "@maestro-template/workflow-ui";
import {
  referenceAppNavigationHint,
  referenceAppNavigationLabel,
  referenceAppRouteKeyByPageId,
} from "../navigation/reference-app-routes";
import { TEMPLATE_NAV_CATEGORIES } from "../navigation/workspace";
import { LiveWorkflowRunsPanel } from "../features/workflows/live-runs-panel";
import { navItems } from "./navItems";
import { overviewPage, pages, type DocumentPage } from "./sampleDocumentData";

type RenderedDocumentPage = Omit<DocumentPage, "diagram"> &
  Pick<NotionDocumentPageModel, "diagram" | "diagramLabel">;

const pageById = new Map(pages.map((page) => [page.id, page]));
const sampleNavigation = TEMPLATE_NAV_CATEGORIES.map((category) => ({
  ...category,
  items: category.items.map((item) => {
    const hint = referenceAppNavigationHint(item.key);

    return {
      key: item.key,
      label: referenceAppNavigationLabel(item.key),
      icon: item.icon,
      href: item.path,
      ...(hint ? { hint } : {}),
    };
  }),
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
  const activeRouteKey =
    referenceAppRouteKeyByPageId.get(activePage.id) ?? "home";

  useEffect(() => {
    const handleHashChange = () => {
      setActivePageId(resolvePageIdFromHash(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return (
    <TemplateWorkspaceShell
      title="Maestro Template"
      subtitle="Private AI app factory"
      navigation={sampleNavigation}
      activeKey={activeRouteKey}
      topbarTitle={activePage.title}
    >
      <NotionDocumentPage page={toRenderedPage(activePage)} />
      {activePage.id === "workflows" ? <LiveWorkflowRunsPanel /> : null}
    </TemplateWorkspaceShell>
  );
}
