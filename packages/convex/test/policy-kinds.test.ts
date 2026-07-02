import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import policies from "../confect/tables/policies";
import {
  agentPolicyKind,
  policyKinds,
  promptOverridePolicyKind,
  selectNearestPolicy,
  spendLimitsPolicyKind,
} from "../confect/policy/kinds";

describe("policy kind registry", () => {
  it("registers spend, agent, and prompt policy kinds with eval metadata", () => {
    expect(Object.keys(policyKinds).sort()).toEqual([
      "agent.config",
      "prompt.override",
      "spend.limits",
    ]);
    expect(spendLimitsPolicyKind.evalRequired).toBe(true);
    expect(agentPolicyKind.evalRequired).toBe(true);
    expect(promptOverridePolicyKind.evalRequired).toBe(true);
  });

  it("rejects invalid policy data through Effect schemas", () => {
    expect(() =>
      Schema.decodeUnknownSync(spendLimitsPolicyKind.schema)({
        dailySpendLimitCents: -1,
        perRunSpendLimitCents: 100,
        currency: "USD",
      }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(agentPolicyKind.schema)({
        maxToolCalls: 5,
        allowedToolGrantIds: ["brain.read", "workflow.run"],
        modelRef: "prompt:planner:v1",
      }),
    ).toMatchObject({ maxToolCalls: 5 });
  });

  it("merges policy data with kind-specific semantics", () => {
    expect(
      spendLimitsPolicyKind.merge(
        {
          dailySpendLimitCents: 5_000,
          perRunSpendLimitCents: 500,
          currency: "USD",
        },
        {
          dailySpendLimitCents: 2_500,
        },
      ),
    ).toEqual({
      dailySpendLimitCents: 2_500,
      perRunSpendLimitCents: 500,
      currency: "USD",
    });
    expect(
      agentPolicyKind.merge(
        {
          maxToolCalls: 5,
          allowedToolGrantIds: ["brain.read"],
          modelRef: "prompt:planner:v1",
        },
        {
          allowedToolGrantIds: ["workflow.run"],
        },
      ),
    ).toEqual({
      maxToolCalls: 5,
      allowedToolGrantIds: ["brain.read", "workflow.run"],
      modelRef: "prompt:planner:v1",
    });
  });

  it("selects nearest active policy by scope and version", () => {
    const selected = selectNearestPolicy({
      kind: "spend.limits",
      workspaceId: "workspace_123",
      nowMs: 10_000,
      policies: [
        {
          id: "system_v1",
          kind: "spend.limits",
          scope: "system",
          version: 1,
          status: "active",
          data: {
            dailySpendLimitCents: 5_000,
            perRunSpendLimitCents: 500,
            currency: "USD",
          },
          createdAt: 1,
          activatedAt: 2,
        },
        {
          id: "workspace_v1",
          kind: "spend.limits",
          scope: "workspace",
          workspaceId: "workspace_123",
          version: 1,
          status: "active",
          data: {
            dailySpendLimitCents: 2_000,
            perRunSpendLimitCents: 200,
            currency: "USD",
          },
          createdAt: 3,
          activatedAt: 4,
        },
        {
          id: "workspace_v2_inactive",
          kind: "spend.limits",
          scope: "workspace",
          workspaceId: "workspace_123",
          version: 2,
          status: "draft",
          data: {
            dailySpendLimitCents: 1_000,
            perRunSpendLimitCents: 100,
            currency: "USD",
          },
          createdAt: 5,
          activatedAt: null,
        },
      ],
    });

    expect(selected?.id).toBe("workspace_v1");
  });

  it("declares append-only policy table indexes and provenance fields", () => {
    expect(policies.indexes).toMatchObject({
      by_kind_scope_status: ["kind", "scope", "status"],
      by_workspace_kind_status: ["workspaceId", "kind", "status"],
      by_policy_version: ["policyKey", "version"],
    });
  });
});
