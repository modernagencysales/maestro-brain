import { createFileRoute } from "@tanstack/react-router";
import {
  TemplateMainContent,
  TemplateOnboardingChecklist,
  useTemplateToast,
} from "@maestro-template/ui";
import {
  buildOnboardingChecklistSteps,
  toastForOnboardingContinue,
  type SetupMode,
} from "../features/setup/setup-surface";
import { OnboardingWorkspaceBriefForm } from "../features/setup/onboarding-workspace-brief-form";

export const Route = createFileRoute("/_workspace/onboarding")({
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const mode: SetupMode = "fake";
  const steps = buildOnboardingChecklistSteps({ mode });
  const toast = useTemplateToast();
  const continueSetup = () => {
    toast.notify(toastForOnboardingContinue({ mode, steps }));
  };

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
          mode={mode}
          onContinue={continueSetup}
          steps={steps}
        />
        <OnboardingWorkspaceBriefForm mode={mode} />
      </article>
    </TemplateMainContent>
  );
}
