import { describe, expect, it } from "vitest";

import { evaluateBrainCapacity } from "../../../tooling/evals/src/brain-capacity";
import { BRAIN_CAPACITY_FIXTURE } from "../../../tooling/evals/src/brain-capacity-fixture";

describe("Brain capacity Convex contract proof", () => {
  it("keeps the capacity harness synthetic and tenant-denial based", () => {
    const receipt = evaluateBrainCapacity({
      schemaVersion: "maestro-brain-capacity-run/v1",
      fixture: BRAIN_CAPACITY_FIXTURE,
      runnerClass: "convex-focused-synthetic",
      seed: "brain-capacity-seed-v1",
      configHash: "sha256:capacity-policy-v1",
      codeHash: "sha256:harness-v1",
      hardware: { cpuClass: "host-test-slot", memoryGb: 8 },
      liveLatencyMs: { p50: 1, p95: 2, p99: 3 },
      askLatencyMs: { p50: 1, p95: 2, p99: 3 },
      windows: [
        {
          windowStartSecond: 0,
          runnableChannels: 100,
          advancedChannels: 100,
          providerRateBlockedChannels: [],
        },
      ],
      admittedEvents: 1200,
      visibleWithin60Seconds: 1200,
      drainedWithinFiveMinutes: true,
      droppedEvents: 0,
      queueOverflowEvents: 0,
      attempts: 100_000,
      acceptedEffects: 100_000,
      rateWaits: 0,
      queueDepthMax: 100,
      recentProgressChannels: 100,
      deepProgressChannels: 100,
      storageBytes: 1,
      modelTokens: 1,
      tenantDenialCanaries: {
        crossTenantKeyDenied: true,
        crossTenantReadDenied: true,
        crossTenantCommitDenied: true,
        crossTenantDeliveryDenied: true,
      },
    });

    expect(receipt.passed).toBe(true);
    expect(receipt.metrics.lossEvents).toBe(0);
    expect(receipt.metrics.tenantDenialCanaries).toEqual({
      crossTenantKeyDenied: true,
      crossTenantReadDenied: true,
      crossTenantCommitDenied: true,
      crossTenantDeliveryDenied: true,
    });
  });
});
