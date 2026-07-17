import { createFileRoute } from "@tanstack/react-router";
import { useBrainWorkspaceController } from "../features/brain/brain-adapter";
import { BrainWorkspace } from "../features/brain/brain-workspace";
import { BusinessAppShell, BusinessPageRoot } from "../saas-ui/business-shell";

export const Route = createFileRoute("/_workspace/brain")({
  validateSearch: (search: Record<string, unknown>) => ({
    brainKey: typeof search.brainKey === "string" ? search.brainKey : undefined,
    pageKey: typeof search.pageKey === "string" ? search.pageKey : undefined,
  }),
  component: BrainRoute,
});

function BrainRoute() {
  const search = Route.useSearch();
  const controller = useBrainWorkspaceController(search);

  return (
    <BusinessAppShell activePath="/brain">
      <BusinessPageRoot>
        <BrainWorkspace
          state={controller.state}
          onArchivePage={controller.onArchivePage}
          onCreatePage={controller.onCreatePage}
          onFavoritePage={controller.onFavoritePage}
          onMovePage={controller.onMovePage}
          onRenamePage={controller.onRenamePage}
          onSaveMarkdown={controller.onSaveMarkdown}
          onSelectPage={controller.onSelectPage}
        />
      </BusinessPageRoot>
    </BusinessAppShell>
  );
}
