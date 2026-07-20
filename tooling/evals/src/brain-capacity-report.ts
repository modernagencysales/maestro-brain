import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildBrainCapacityChannelIds,
  evaluateBrainCapacity,
  type BrainCapacityRun,
} from "./brain-capacity";
import { sha256 } from "./brain-eval-report";
import { BRAIN_CAPACITY_FIXTURE } from "./brain-capacity-fixture";

export type BrainCapacityReport = {
  readonly schemaVersion: "maestro-brain-capacity-report/v1";
  readonly generatedBy: "@maestro-template/evals brain:capacity";
  readonly rawSyntheticOnly: true;
  readonly receipt: ReturnType<typeof evaluateBrainCapacity>;
};

export const buildBrainCapacityReport = (
  run: BrainCapacityRun,
): BrainCapacityReport => ({
  schemaVersion: "maestro-brain-capacity-report/v1",
  generatedBy: "@maestro-template/evals brain:capacity",
  rawSyntheticOnly: true,
  receipt: evaluateBrainCapacity(run),
});

const configHash = (): string => sha256(BRAIN_CAPACITY_FIXTURE);

const codeHash = (): string =>
  sha256(
    readFileSync(
      fileURLToPath(new URL("./brain-capacity.ts", import.meta.url)),
      "utf8",
    ),
  );

export const syntheticPassingRun = (): BrainCapacityRun => {
  const channelIds = buildBrainCapacityChannelIds(BRAIN_CAPACITY_FIXTURE);
  return {
    schemaVersion: "maestro-brain-capacity-run/v1",
    fixture: BRAIN_CAPACITY_FIXTURE,
    runnerClass: "focused-local-synthetic",
    seed: "brain-capacity-seed-v1",
    configHash: configHash(),
    codeHash: codeHash(),
    hardware: { cpuClass: "host-test-slot", memoryGb: 8 },
    liveLatencyMs: { p50: 4500, p95: 55000, p99: 59000 },
    askLatencyMs: { p50: 800, p95: 2400, p99: 4800 },
    windows: [
      {
        windowStartSecond: 0,
        runnableChannelIds: channelIds,
        advancedChannelIds: channelIds,
        providerRateBlockedChannels: [],
      },
      {
        windowStartSecond: 60,
        runnableChannelIds: channelIds,
        advancedChannelIds: channelIds,
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
    crossBrainLeakEffects: 0,
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
    aboveEnvelopeAdmission: {
      attemptedEventsPerSecond: 40,
      outcome: "CapacityExceeded",
      queuedVisible: false,
    },
  };
};

export const writeBrainCapacityReport = (path: string): BrainCapacityReport => {
  const report = buildBrainCapacityReport(syntheticPassingRun());
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
};

if (process.argv[1]?.endsWith("brain-capacity-report.ts")) {
  const out = process.argv[2];
  const report = out
    ? writeBrainCapacityReport(out)
    : buildBrainCapacityReport(syntheticPassingRun());
  if (!out) console.log(JSON.stringify(report, null, 2));
  if (!report.receipt.passed) process.exitCode = 1;
}
