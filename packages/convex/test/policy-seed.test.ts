import { describe, expect, it } from "vitest";
import { createSystemPolicySeedPlan } from "../confect/policy/seed";

describe("system policy seeder", () => {
  it("seeds default spend policy, agent policy, and prompt family", () => {
    const plan = createSystemPolicySeedPlan({
      nowMs: 1_000,
      existingPolicyKeys: [],
      existingPromptRefs: [],
    });

    expect(plan.policies.map((policy) => policy.policyKey).sort()).toEqual([
      "system:agent.config",
      "system:spend.limits",
    ]);
    expect(plan.prompts.map((prompt) => prompt.ref)).toEqual([
      "prompt:gtm.planner:v1",
    ]);
    expect(plan.policies.every((policy) => policy.status === "active")).toBe(
      true,
    );
    expect(plan.prompts[0]).toMatchObject({
      family: "gtm.planner",
      version: 1,
      status: "active",
    });
  });

  it("is idempotent when seed rows already exist", () => {
    const plan = createSystemPolicySeedPlan({
      nowMs: 2_000,
      existingPolicyKeys: ["system:spend.limits", "system:agent.config"],
      existingPromptRefs: ["prompt:gtm.planner:v1"],
    });

    expect(plan).toEqual({
      policies: [],
      prompts: [],
      skipped: [
        "system:spend.limits",
        "system:agent.config",
        "prompt:gtm.planner:v1",
      ],
    });
  });

  it("does not require live provider secrets", () => {
    const plan = createSystemPolicySeedPlan({
      nowMs: 3_000,
      existingPolicyKeys: [],
      existingPromptRefs: [],
    });

    expect(JSON.stringify(plan)).not.toMatch(/api[_-]?key|secret|token/i);
    expect(plan.prompts[0]?.modelRef).toBe("openrouter:fake/local-demo");
  });
});
