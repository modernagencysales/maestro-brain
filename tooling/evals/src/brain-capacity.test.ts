import { describe, expect, it } from "vitest";
import {
  BRAIN_CAPACITY_FIXTURE,
  buildBrainCapacityFixture,
} from "./brain-capacity-fixture";
import { buildBrainCapacityReport } from "./brain-capacity-report";
import { evaluateBrainCapacity, type BrainCapacityRun } from "./brain-capacity";

const passingRun = (): BrainCapacityRun => ({
  schemaVersion: "maestro-brain-capacity-run/v1",
  fixture: BRAIN_CAPACITY_FIXTURE,
  runnerClass: "focused-local-synthetic",
  seed: "brain-capacity-seed-v1",
  configHash: "sha256:capacity-policy-v1",
  codeHash: "sha256:harness-v1",
  hardware: { cpuClass: "host-test-slot", memoryGb: 8 },
  liveLatencyMs: { p50: 4500, p95: 55000, p99: 59000 },
  askLatencyMs: { p50: 800, p95: 2400, p99: 4800 },
  windows: [
    {
      windowStartSecond: 0,
      runnableChannels: 100,
      advancedChannels: 100,
      providerRateBlockedChannels: [],
    },
    {
      windowStartSecond: 60,
      runnableChannels: 100,
      advancedChannels: 100,
      providerRateBlockedChannels: [],
    },
  ],
  admittedEvents: 1200,
  visibleWithin60Seconds: 1190,
  drainedWithinFiveMinutes: true,
  droppedEvents: 0,
  queueOverflowEvents: 0,
  attempts: 101500,
  acceptedEffects: 101500,
  rateWaits: 25,
  queueDepthMax: 240,
  recentProgressChannels: 100,
  deepProgressChannels: 100,
  storageBytes: 180_000_000,
  modelTokens: 50_000,
  tenantDenialCanaries: {
    crossTenantKeyDenied: true,
    crossTenantReadDenied: true,
    crossTenantCommitDenied: true,
    crossTenantDeliveryDenied: true,
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
    "unfair FIFO",
    (run) => ({
      ...run,
      windows: [{ ...run.windows[0]!, advancedChannels: 99 }],
    }),
  ],
  ["dropped event", (run) => ({ ...run, droppedEvents: 1 })],
  ["queue overflow", (run) => ({ ...run, queueOverflowEvents: 1 })],
  ["cross-Brain leak", (run) => ({ ...run, acceptedEffects: 101501 })],
  [
    "canary isolation bypass",
    (run) => ({
      ...run,
      tenantDenialCanaries: {
        ...run.tenantDenialCanaries,
        crossTenantReadDenied: false,
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
    const receipt = evaluateBrainCapacity(passingRun());
    expect(receipt.passed).toBe(true);
    expect(receipt.failures).toEqual([]);
    expect(receipt.fixtureHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(failureCases)("detects %s failures", (_name, makeRun) => {
    const receipt = evaluateBrainCapacity(makeRun(passingRun()));
    expect(receipt.passed).toBe(false);
    expect(receipt.failures.length).toBeGreaterThan(0);
  });

  it("builds an approval-ready synthetic report", () => {
    const report = buildBrainCapacityReport(passingRun());
    expect(report.schemaVersion).toBe("maestro-brain-capacity-report/v1");
    expect(report.receipt.passed).toBe(true);
    expect(report.rawSyntheticOnly).toBe(true);
  });
});
