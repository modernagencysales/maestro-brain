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
          Replace this client-specific legal draft before launch. It is
          intentionally plain and reviewable so privacy, terms, data handling,
          AI review, and provider disclosure language can move through counsel
          without redesign work.
        </p>
        <h2>Privacy review draft</h2>
        <p>
          Document what customer data is collected, where provider processing
          occurs, how support access works, and how workspace export/delete
          requests are handled.
        </p>
        <h2>Cookie and analytics review draft</h2>
        <p>
          Replace the consent banner copy, analytics purpose, retention period,
          and opt-out instructions with the client-approved privacy posture
          before enabling live telemetry.
        </p>
        <h2>Terms review draft</h2>
        <p>
          Replace with the client-specific service terms, billing terms,
          acceptable use policy, and AI-generated-output review requirements.
        </p>
      </article>
    </TemplateMainContent>
  );
}
