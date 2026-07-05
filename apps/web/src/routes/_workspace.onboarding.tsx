import { createFileRoute } from "@tanstack/react-router";
import {
  TemplateMainContent,
  TemplateOnboardingChecklist,
} from "@maestro-template/ui";

export const Route = createFileRoute("/_workspace/onboarding")({
  component: OnboardingRoute,
});

function OnboardingRoute() {
  return (
    <TemplateMainContent className="template-page">
      <article className="template-readable-page">
        <p className="eyebrow">Setup</p>
        <h1>Onboarding</h1>
        <p>
          Configure the client workspace, provider posture, source-backed Brain,
          and first workflow before enabling live external actions.
        </p>
        <TemplateOnboardingChecklist
          mode="fake"
          steps={[
            {
              id: "workspace",
              label: "Workspace identity",
              description: "Create the client workspace and ownership model.",
              status: "complete",
            },
            {
              id: "providers",
              label: "Provider readiness",
              description:
                "Fake mode is ready. Live provider setup still needs environment values.",
              status: "blocked",
              missingEnv: ["WORKOS_API_KEY", "MAILERSEND_API_KEY"],
            },
            {
              id: "brain",
              label: "Source-backed Brain",
              description:
                "Add markdown, links, and source sets before agent workflows run.",
              status: "ready",
            },
          ]}
        />
      </article>
    </TemplateMainContent>
  );
}
