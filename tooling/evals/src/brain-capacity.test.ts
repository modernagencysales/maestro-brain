import { describe, expect, it } from "vitest";
import {
  BRAIN_CAPACITY_FIXTURE,
  buildBrainCapacityFixture,
} from "./brain-capacity-fixture";
import {
  buildBrainCapacityReport,
  syntheticPassingRun,
} from "./brain-capacity-report";
import { evaluateBrainCapacity, type BrainCapacityRun } from "./brain-capacity";

const withoutChannel = (
  run: BrainCapacityRun,
  windowIndex: number,
  channelId: string,
): BrainCapacityRun => ({
  ...run,
  windows: run.windows.map((window, index) =>
    index === windowIndex
      ? {
          ...window,
          advancedChannelIds: window.advancedChannelIds.filter(
            (id) => id !== channelId,
          ),
        }
      : window,
  ),
});

const withCanary = <K extends keyof BrainCapacityRun["tenantDenialCanaries"]>(
  run: BrainCapacityRun,
  canary: K,
): BrainCapacityRun => ({
  ...run,
  tenantDenialCanaries: {
    ...run.tenantDenialCanaries,
    [canary]: false,
  },
});

const failureCases: ReadonlyArray<
  readonly [string, (run: BrainCapacityRun) => BrainCapacityRun]
> = [
  [
    "shared cursor",
    (run) => ({ ...run, recentProgressChannels: 1, deepProgressChannels: 1 }),
  ],
  [
    "unfair FIFO with aggregate-looking progress",
    (run) =>
      withoutChannel(
        {
          ...run,
          windows: run.windows.map((window, index) =>
            index === 0
              ? {
                  ...window,
                  advancedChannelIds: window.advancedChannelIds.filter(
                    (id) => id !== "direct-075",
                  ),
                  providerRateBlockedChannels: ["capture-005"],
                }
              : window,
          ),
        },
        1,
        "direct-075",
      ),
  ],
  ["dropped event", (run) => ({ ...run, droppedEvents: 1 })],
  ["queue overflow", (run) => ({ ...run, queueOverflowEvents: 1 })],
  ["cross-Brain leak", (run) => ({ ...run, crossBrainLeakEffects: 1 })],
  ...(
    [
      "crossTenantKeyDenied",
      "crossTenantReadDenied",
      "crossTenantCommitDenied",
      "crossTenantDeliveryDenied",
    ] as const
  ).map(
    (canary) =>
      [
        `canary isolation bypass: ${canary}`,
        (run: BrainCapacityRun) => withCanary(run, canary),
      ] as const,
  ),
  [
    "silently accepted above-envelope pressure",
    (run) => ({
      ...run,
      aboveEnvelopeAdmission: {
        attemptedEventsPerSecond: 40,
        outcome: "Accepted",
        queuedVisible: false,
      },
    }),
  ],
  [
    "invisible above-envelope queue",
    (run) => ({
      ...run,
      aboveEnvelopeAdmission: {
        attemptedEventsPerSecond: 40,
        outcome: "Queued",
        queuedVisible: false,
      },
    }),
  ],
];

describe("Brain capacity harness", () => {
  it("pins the declared launch fixture envelope", () => {
    expect(buildBrainCapacityFixture()).toMatchObject({
      agencies: 2,
      primaryAgencyClients: 25,
      channels: { direct: 75, classify: 20, captureOnly: 5, total: 100 },
      sourceRevisions: 100_000,
      liveBurst: { eventsPerSecond: 20, durationSeconds: 60 },
      concurrentAskMcpRequests: 10,
    });
  });

  it("passes a fair lossless isolated capacity run", () => {
    const receipt = evaluateBrainCapacity(syntheticPassingRun());
    expect(receipt.passed).toBe(true);
    expect(receipt.failures).toEqual([]);
    expect(receipt.fixtureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.metrics.crossBrainLeakEffects).toBe(0);
  });

  it.each(failureCases)("detects %s failures", (_name, makeRun) => {
    const receipt = evaluateBrainCapacity(makeRun(syntheticPassingRun()));
    expect(receipt.passed).toBe(false);
    expect(receipt.failures.length).toBeGreaterThan(0);
  });

  it("requires an exact provider-rate block for a missed runnable channel", () => {
    const run = withoutChannel(syntheticPassingRun(), 0, "direct-001");
    const receipt = evaluateBrainCapacity(run);

    expect(receipt.passed).toBe(false);
    expect(receipt.failures).toContain(
      "channel direct-001 missed 0s window without provider-rate block",
    );
  });

  it("allows a runnable channel to miss only when exactly provider-rate blocked", () => {
    const run = {
      ...withoutChannel(syntheticPassingRun(), 0, "direct-001"),
      windows: withoutChannel(
        syntheticPassingRun(),
        0,
        "direct-001",
      ).windows.map((window, index) =>
        index === 0
          ? { ...window, providerRateBlockedChannels: ["direct-001"] }
          : window,
      ),
    };

    expect(evaluateBrainCapacity(run).passed).toBe(true);
  });

  it("rejects any channel missing two consecutive windows", () => {
    const receipt = evaluateBrainCapacity(
      withoutChannel(
        withoutChannel(syntheticPassingRun(), 0, "direct-002"),
        1,
        "direct-002",
      ),
    );

    expect(receipt.passed).toBe(false);
    expect(receipt.failures).toContain(
      "channel direct-002 missed two consecutive fairness windows",
    );
  });

  it("builds an approval-ready synthetic report with computed provenance", () => {
    const report = buildBrainCapacityReport(syntheticPassingRun());
    expect(report.schemaVersion).toBe("maestro-brain-capacity-report/v1");
    expect(report.receipt.passed).toBe(true);
    expect(report.rawSyntheticOnly).toBe(true);
    expect(report.receipt.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.receipt.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.receipt.configHash).not.toContain("capacity-policy-v1");
  });
});
