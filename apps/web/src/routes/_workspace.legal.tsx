import { createFileRoute } from "@tanstack/react-router";
import { TemplateMainContent } from "@maestro-template/ui";

export const Route = createFileRoute("/_workspace/legal")({
  component: LegalRoute,
});

function LegalRoute() {
  return (
    <TemplateMainContent className="template-page">
      <article className="template-readable-page">
        <p className="eyebrow">Platform</p>
        <h1>Legal</h1>
        <p>
          Replace these legal placeholders per client before launch. They are
          intentionally plain, reviewable pages for privacy, terms, data
          handling, and provider disclosure language.
        </p>
        <h2>Privacy placeholder</h2>
        <p>
          Document what customer data is collected, where provider processing
          occurs, how support access works, and how workspace export/delete
          requests are handled.
        </p>
        <h2>Cookie and analytics placeholder</h2>
        <p>
          Replace the consent banner copy, analytics purpose, retention period,
          and opt-out instructions with the client-approved privacy posture
          before enabling live telemetry.
        </p>
        <h2>Terms placeholder</h2>
        <p>
          Replace with the client-specific service terms, billing terms,
          acceptable use policy, and AI-generated-output review requirements.
        </p>
      </article>
    </TemplateMainContent>
  );
}
