import { createFileRoute } from "@tanstack/react-router";
import {
  TemplateMainContent,
  TemplateOnboardingChecklist,
} from "@maestro-template/ui";
import { buildOnboardingChecklistSteps } from "../features/setup/setup-surface";

export const Route = createFileRoute("/_workspace/onboarding")({
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const mode = "fake";
  const steps = buildOnboardingChecklistSteps({ mode });

  return (
    <TemplateMainContent className="template-page">
      <article className="template-readable-page">
        <p className="eyebrow">Setup</p>
        <h1>Onboarding</h1>
        <p>
          Configure the client workspace, provider posture, source-backed Brain,
          and first workflow before enabling live external actions.
        </p>
        <TemplateOnboardingChecklist mode={mode} steps={steps} />
      </article>
    </TemplateMainContent>
  );
}
