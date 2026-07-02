import { describe, expect, it } from "vitest";
import {
  MissingPolicyError,
  resolvePolicy,
  resolvePolicySnapshot,
} from "../confect/policy/resolver";
import type { PolicyCandidate } from "../confect/policy/kinds";

type SpendPolicy = {
  readonly dailySpendLimitCents: number;
  readonly perRunSpendLimitCents: number;
  readonly currency: "USD";
  readonly locale?: string;
};

const policies: readonly PolicyCandidate<SpendPolicy>[] = [
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
      locale: "en-US",
    },
    createdAt: 1_000,
    activatedAt: 1_000,
  },
  {
    id: "workspace_v1",
    kind: "spend.limits",
    scope: "workspace",
    workspaceId: "workspace_123",
    version: 1,
    status: "active",
    data: {
      dailySpendLimitCents: 2_500,
      perRunSpendLimitCents: 250,
      currency: "USD",
      locale: "en-US",
    },
    createdAt: 2_000,
    activatedAt: 2_000,
  },
  {
    id: "workspace_fr_v2",
    kind: "spend.limits",
    scope: "workspace",
    workspaceId: "workspace_123",
    version: 2,
    status: "active",
    data: {
      dailySpendLimitCents: 2_000,
      perRunSpendLimitCents: 200,
      currency: "USD",
      locale: "fr-FR",
    },
    createdAt: 3_000,
    activatedAt: 3_000,
  },
  {
    id: "workspace_v3_inactive",
    kind: "spend.limits",
    scope: "workspace",
    workspaceId: "workspace_123",
    version: 3,
    status: "draft",
    data: {
      dailySpendLimitCents: 500,
      perRunSpendLimitCents: 50,
      currency: "USD",
      locale: "en-US",
    },
    createdAt: 4_000,
    activatedAt: null,
  },
];

describe("policy resolver", () => {
  it("resolves system policy when no workspace override exists", () => {
    expect(
      resolvePolicy({
        kind: "spend.limits",
        workspaceId: "workspace_other",
        nowMs: 10_000,
        policies,
      }),
    ).toMatchObject({
      id: "system_v1",
      data: { dailySpendLimitCents: 5_000 },
    });
  });

  it("resolves workspace override before system policy", () => {
    expect(
      resolvePolicy({
        kind: "spend.limits",
        workspaceId: "workspace_123",
        nowMs: 10_000,
        policies,
      }),
    ).toMatchObject({
      id: "workspace_v1",
      data: { dailySpendLimitCents: 2_500 },
    });
  });

  it("selects locale-specific active policy when requested", () => {
    expect(
      resolvePolicy({
        kind: "spend.limits",
        workspaceId: "workspace_123",
        locale: "fr-FR",
        nowMs: 10_000,
        policies,
      }),
    ).toMatchObject({
      id: "workspace_fr_v2",
      data: { locale: "fr-FR" },
    });
  });

  it("looks up a pinned version even when a newer active policy exists", () => {
    expect(
      resolvePolicy({
        kind: "spend.limits",
        workspaceId: "workspace_123",
        pinned: { policyKey: "workspace_123:spend.limits", version: 1 },
        nowMs: 10_000,
        policies,
      }),
    ).toMatchObject({
      id: "workspace_v1",
      version: 1,
    });
  });

  it("excludes inactive policies from latest resolution", () => {
    expect(
      resolvePolicy({
        kind: "spend.limits",
        workspaceId: "workspace_123",
        nowMs: 10_000,
        policies,
      }),
    ).not.toMatchObject({ id: "workspace_v3_inactive" });
  });

  it("returns a typed missing policy error", () => {
    const result = resolvePolicy({
      kind: "agent.config",
      workspaceId: "workspace_123",
      nowMs: 10_000,
      policies,
    });

    expect(result).toBeInstanceOf(MissingPolicyError);
    expect(result).toMatchObject({
      _tag: "MissingPolicyError",
      kind: "agent.config",
      workspaceId: "workspace_123",
    });
  });

  it("creates workflow kickoff snapshot with pinned policy version", () => {
    expect(
      resolvePolicySnapshot({
        kind: "spend.limits",
        workspaceId: "workspace_123",
        workflowRunId: "run_123",
        nowMs: 10_000,
        policies,
      }),
    ).toEqual({
      kind: "spend.limits",
      policyId: "workspace_v1",
      policyKey: "workspace_123:spend.limits",
      version: 1,
      scope: "workspace",
      workspaceId: "workspace_123",
      workflowRunId: "run_123",
      resolvedAt: 10_000,
      data: {
        dailySpendLimitCents: 2_500,
        perRunSpendLimitCents: 250,
        currency: "USD",
        locale: "en-US",
      },
    });
  });
});
