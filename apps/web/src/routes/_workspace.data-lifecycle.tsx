import { createFileRoute } from "@tanstack/react-router";
import { TemplateMainContent } from "@maestro-template/ui";
import { DataLifecycleSurface } from "../features/data-lifecycle/data-lifecycle-surface";

export const Route = createFileRoute("/_workspace/data-lifecycle")({
  component: DataLifecycleRoute,
});

function DataLifecycleRoute() {
  return (
    <TemplateMainContent className="template-page">
      <article className="template-readable-page">
        <p className="eyebrow">Privacy Operations</p>
        <h1>Data lifecycle</h1>
        <p>
          Data maps, retention posture, and DSAR request planning stay dry-run
          until a client fork completes legal review and fulfillment wiring.
        </p>
        <DataLifecycleSurface />
      </article>
    </TemplateMainContent>
  );
}
