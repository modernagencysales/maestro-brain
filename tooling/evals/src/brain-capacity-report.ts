import { sha256 } from "./brain-eval-report";
import {
  buildBrainCapacityChannelIds,
  evaluateBrainCapacity,
  type BrainCapacityRun,
} from "./brain-capacity";
import {
  BRAIN_CAPACITY_FIXTURE,
  buildBrainCapacityFixture,
} from "./brain-capacity-fixture";

const channelIds = buildBrainCapacityChannelIds(BRAIN_CAPACITY_FIXTURE);

export const syntheticPassingRun = (): BrainCapacityRun => ({
  schemaVersion: "maestro-brain-capacity-run/v1",
  fixture: buildBrainCapacityFixture(),
  runnerClass: "synthetic-local",
  seed: "brain-capacity-v1",
  configHash: sha256({ fixture: BRAIN_CAPACITY_FIXTURE, config: "v1" }),
  codeHash: sha256({ evaluator: "brain-capacity-v1" }),
  hardware: { cpuClass: "synthetic", memoryGb: 1 },
  liveLatencyMs: { p50: 10, p95: 25, p99: 50 },
  askLatencyMs: { p50: 20, p95: 60, p99: 100 },
  windows: [0, 60].map((windowStartSecond) => ({
    windowStartSecond,
    runnableChannelIds: channelIds,
    advancedChannelIds: channelIds,
    providerRateBlockedChannels: [],
  })),
  admittedEvents: 1_200,
  visibleWithin60Seconds: 1_200,
  drainedWithinFiveMinutes: true,
  droppedEvents: 0,
  queueOverflowEvents: 0,
  attempts: 1_200,
  acceptedEffects: 1_200,
  crossBrainLeakEffects: 0,
  rateWaits: 0,
  queueDepthMax: 100,
  recentProgressChannels: 100,
  deepProgressChannels: 100,
  storageBytes: 10_000_000,
  modelTokens: 25_000,
  tenantDenialCanaries: {
    crossTenantKeyDenied: true,
    crossTenantReadDenied: true,
    crossTenantCommitDenied: true,
    crossTenantDeliveryDenied: true,
  },
  aboveEnvelopeAdmission: {
    attemptedEventsPerSecond: 40,
    outcome: "Queued",
    queuedVisible: true,
  },
});

export const buildBrainCapacityReport = (run: BrainCapacityRun) => ({
  schemaVersion: "maestro-brain-capacity-report/v1" as const,
  rawSyntheticOnly: true as const,
  fixture: run.fixture,
  receipt: evaluateBrainCapacity(run),
});
