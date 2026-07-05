import { describe, expect, it } from "vitest";
import {
  defaultFeatureFlags,
  evaluateFeatureFlag,
  featureFlagReadinessReport,
  validateFeatureFlagDefinition,
  type FeatureFlagDefinition,
} from "./flags";

const context = {
  workspaceSlug: "acme-demo",
  userEmail: "operator@example.test",
};

describe("feature flags", () => {
  it("ships starter-safe default flags with live side effects disabled", () => {
    expect(defaultFeatureFlags.map((flag) => flag.key)).toEqual([
      "template.onboarding.workspaceBrief",
      "template.workflow.liveRuns",
      "template.billing.liveCheckout",
      "template.notifications.center",
      "template.ai.liveGeneration",
    ]);
    expect(
      defaultFeatureFlags
        .filter(
          (flag) =>
            flag.key === "template.billing.liveCheckout" ||
            flag.key === "template.notifications.center" ||
            flag.key === "template.ai.liveGeneration",
        )
        .every((flag) => !flag.enabled),
    ).toBe(true);
  });

  it("evaluates enabled flags deterministically by workspace bucket", () => {
    const definition: FeatureFlagDefinition = {
      key: "template.workflow.liveRuns",
      description: "Rollout test",
      enabled: true,
      rolloutPercent: 100,
      audience: "everyone",
    };

    expect(evaluateFeatureFlag(definition, context)).toMatchObject({
      key: "template.workflow.liveRuns",
      enabled: true,
      reason: "enabled",
    });
    expect(evaluateFeatureFlag(definition, context)).toEqual(
      evaluateFeatureFlag(definition, context),
    );
  });

  it("lets kill switches override enabled definitions", () => {
    expect(
      evaluateFeatureFlag(
        {
          key: "template.ai.liveGeneration",
          description: "Live AI",
          enabled: true,
          rolloutPercent: 100,
          audience: "everyone",
          killSwitchEnv: "LLM_DISABLED",
        },
        {
          ...context,
          env: { LLM_DISABLED: "true" },
        },
      ),
    ).toMatchObject({
      enabled: false,
      reason: "kill-switch",
    });
  });

  it("keeps internal flags unavailable to ordinary external users", () => {
    expect(
      evaluateFeatureFlag(
        {
          key: "template.notifications.center",
          description: "Notifications",
          enabled: true,
          rolloutPercent: 100,
          audience: "internal",
        },
        {
          workspaceSlug: "acme-demo",
          userEmail: "client@example.com",
        },
      ),
    ).toMatchObject({
      enabled: false,
      reason: "audience",
    });
  });

  it("validates malformed rollout definitions", () => {
    expect(
      validateFeatureFlagDefinition({
        key: "template.billing.liveCheckout",
        description: "Bad rollout",
        enabled: true,
        rolloutPercent: 101,
        audience: "everyone",
      }),
    ).toMatchObject({
      _tag: "FeatureFlagConfigError",
      publicMessage: "Feature flag rolloutPercent must be between 0 and 100.",
    });
  });

  it("summarizes readiness without leaking env values", () => {
    const report = featureFlagReadinessReport({
      context: {
        ...context,
        env: {
          LLM_DISABLED: "true",
          SECRET_TOKEN: "do-not-leak",
        },
      },
    });

    expect(report.total).toBe(defaultFeatureFlags.length);
    expect(report.blockedByKillSwitch).toBe(1);
    expect(JSON.stringify(report)).not.toContain("do-not-leak");
  });
});
