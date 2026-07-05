import { describe, expect, it } from "vitest";
import { providerAdapters } from "../../sample/templateData";
import {
  buildOnboardingChecklistSteps,
  buildOnboardingDocumentSections,
  buildProviderSetupDocumentSections,
  missingLiveProviderEnv,
  requiredLiveProviderEnv,
} from "./setup-surface";

describe("setup surface", () => {
  it("explains provider posture without constructing live SDK clients", () => {
    const sections = buildProviderSetupDocumentSections(providerAdapters);

    expect(sections.map((section) => section.heading)).toEqual([
      "Workspace setup",
      "Provider posture",
      "Billing and credits",
      "Email and notifications",
      "Deploy readiness",
    ]);
    expect(sections[1]?.body).toContain(
      "**WorkOS/AuthKit** stays behind the fake + live adapter and is currently planned.",
    );
    expect(sections[2]?.body).toContain(
      "**Dodo** starts in billing fake first mode so demos and tests do not need live payment secrets.",
    );
  });

  it("creates a first-client onboarding path for AI/GTM app forks", () => {
    const sections = buildOnboardingDocumentSections();

    expect(sections[0]?.body).toContain(
      "- Create or confirm the client workspace.",
    );
    expect(sections[1]?.body).toContain(
      "- Import markdown, links, notes, and approved source lists.",
    );
    expect(sections[2]?.body).toContain(
      "- Add the first capability with typed args, typed returns, typed failures, and policy.",
    );
    expect(sections[3]?.body).toContain(
      "- Run browser smoke, app tests, Confect contract checks, and deploy readiness checks before handoff.",
    );
  });

  it("builds a route checklist for fake-mode client setup", () => {
    const steps = buildOnboardingChecklistSteps({ mode: "fake" });

    expect(steps.map((step) => step.id)).toEqual([
      "workspace",
      "providers",
      "brain",
      "workflow",
    ]);
    expect(steps[0]).toMatchObject({
      label: "Workspace identity",
      status: "complete",
    });
    expect(steps[1]).toMatchObject({
      label: "Provider readiness",
      status: "ready",
      missingEnv: requiredLiveProviderEnv,
    });
    expect(steps[2]).toMatchObject({
      label: "Source-backed Brain",
      status: "ready",
    });
    expect(steps[3]).toMatchObject({
      label: "First workflow receipt",
      status: "ready",
    });
  });

  it("marks live provider readiness when required environment names are present", () => {
    const steps = buildOnboardingChecklistSteps({
      mode: "live",
      presentEnv: requiredLiveProviderEnv,
    });

    expect(steps[1]).toMatchObject({
      status: "ready",
      missingEnv: [],
    });
  });

  it("blocks live provider readiness until every required environment name is present", () => {
    const presentEnv = requiredLiveProviderEnv.filter(
      (envName) => envName !== "OPENROUTER_API_KEY",
    );

    expect(missingLiveProviderEnv(presentEnv)).toEqual(["OPENROUTER_API_KEY"]);
    expect(
      buildOnboardingChecklistSteps({ mode: "live", presentEnv })[1],
    ).toMatchObject({
      status: "blocked",
      missingEnv: ["OPENROUTER_API_KEY"],
    });
  });
});
