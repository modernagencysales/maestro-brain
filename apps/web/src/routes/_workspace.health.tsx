import { createFileRoute } from "@tanstack/react-router";
import { TemplateMainContent } from "@maestro-template/ui";
import { HealthSurface } from "../features/health/health-surface";

export const Route = createFileRoute("/_workspace/health")({
  component: HealthRoute,
});

function HealthRoute() {
  return (
    <TemplateMainContent className="template-page">
      <article className="template-readable-page">
        <p className="eyebrow">Operations</p>
        <h1>Health</h1>
        <p>
          Runtime checks and provider readiness stay visible before live
          credentials or client-specific production smoke are enabled.
        </p>
        <HealthSurface />
      </article>
    </TemplateMainContent>
  );
}
