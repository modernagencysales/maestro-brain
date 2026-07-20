import { describe, expect, it } from "vitest";

type CapacityReceipt = {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly metrics: {
    readonly lossEvents: number;
    readonly crossBrainLeakEffects: number;
    readonly tenantDenialCanaries: {
      readonly crossTenantKeyDenied: boolean;
      readonly crossTenantReadDenied: boolean;
      readonly crossTenantCommitDenied: boolean;
      readonly crossTenantDeliveryDenied: boolean;
    };
    readonly aboveEnvelopeAdmission: {
      readonly attemptedEventsPerSecond: number;
      readonly outcome: "CapacityExceeded" | "Queued" | "Accepted" | "Dropped";
      readonly queuedVisible: boolean;
    };
  };
};

type CapacityRun = {
  readonly tenantDenialCanaries: CapacityReceipt["metrics"]["tenantDenialCanaries"];
};

const loadCapacityHarness = async (): Promise<{
  readonly evaluateBrainCapacity: (run: CapacityRun) => CapacityReceipt;
  readonly syntheticPassingRun: () => CapacityRun;
}> => {
  const capacityPath = "../../../tooling/evals/src/brain-capacity";
  const reportPath = "../../../tooling/evals/src/brain-capacity-report";
  const [{ evaluateBrainCapacity }, { syntheticPassingRun }] =
    await Promise.all([import(capacityPath), import(reportPath)]);
  return { evaluateBrainCapacity, syntheticPassingRun };
};

describe("Brain capacity Convex contract proof", () => {
  it("keeps the capacity harness synthetic and tenant-denial based", async () => {
    const { evaluateBrainCapacity, syntheticPassingRun } =
      await loadCapacityHarness();
    const receipt = evaluateBrainCapacity(syntheticPassingRun());

    expect(receipt.passed).toBe(true);
    expect(receipt.metrics.lossEvents).toBe(0);
    expect(receipt.metrics.crossBrainLeakEffects).toBe(0);
    expect(receipt.metrics.tenantDenialCanaries).toEqual({
      crossTenantKeyDenied: true,
      crossTenantReadDenied: true,
      crossTenantCommitDenied: true,
      crossTenantDeliveryDenied: true,
    });
    expect(receipt.metrics.aboveEnvelopeAdmission).toEqual({
      attemptedEventsPerSecond: 40,
      outcome: "CapacityExceeded",
      queuedVisible: false,
    });
  });

  it("exercises the shared harness for tenant denial failures", async () => {
    const { evaluateBrainCapacity, syntheticPassingRun } =
      await loadCapacityHarness();
    const run = syntheticPassingRun();
    const receipt = evaluateBrainCapacity({
      ...run,
      tenantDenialCanaries: {
        ...run.tenantDenialCanaries,
        crossTenantCommitDenied: false,
      },
    });

    expect(receipt.passed).toBe(false);
    expect(receipt.failures).toContain(
      "tenant canary failed: crossTenantCommitDenied",
    );
  });
});
