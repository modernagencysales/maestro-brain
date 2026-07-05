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
  referenceAppPageIdByRouteKey,
} from "../navigation/reference-app-routes";
import {
  TEMPLATE_NAV_CATEGORIES,
  TEMPLATE_ROUTE_ITEMS,
  type TemplateRouteKey,
} from "../navigation/workspace";
import { LiveWorkflowRunsPanel } from "../features/workflows/live-runs-panel";
import { overviewPage, pages, type DocumentPage } from "./sampleDocumentData";

type RenderedDocumentPage = Omit<DocumentPage, "diagram"> &
  Pick<NotionDocumentPageModel, "diagram" | "diagramLabel">;

const pageById = new Map(pages.map((page) => [page.id, page]));
const routeItemByKey = new Map(
  TEMPLATE_ROUTE_ITEMS.map((item) => [item.key, item]),
);

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

export function buildReferenceRouteNavigation() {
  return TEMPLATE_NAV_CATEGORIES.map((category) => ({
    ...category,
    items: category.items.map((item) => {
      const hint = referenceAppNavigationHint(item.key);

      return {
        key: item.key,
        label: referenceAppNavigationLabel(item.key),
        icon: item.icon,
        href: routeItemByKey.get(item.key)?.path ?? item.path,
        ...(hint ? { hint } : {}),
      };
    }),
  }));
}

export function ReferenceDocumentRoute({
  routeKey,
}: {
  readonly routeKey: TemplateRouteKey;
}) {
  const pageId = referenceAppPageIdByRouteKey.get(routeKey) ?? "overview";
  const activePage = pageById.get(pageId) ?? overviewPage;

  return (
    <TemplateWorkspaceShell
      title="Maestro Template"
      subtitle="Private AI app factory"
      navigation={buildReferenceRouteNavigation()}
      activeKey={routeKey}
      topbarTitle={activePage.title}
    >
      <NotionDocumentPage page={toRenderedPage(activePage)} />
      {activePage.id === "workflows" ? <LiveWorkflowRunsPanel /> : null}
    </TemplateWorkspaceShell>
  );
}
