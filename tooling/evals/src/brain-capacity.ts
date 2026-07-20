import { sha256 } from "./brain-eval-report";
import {
  BRAIN_CAPACITY_FIXTURE,
  type BrainCapacityFixture,
} from "./brain-capacity-fixture";

export type BrainCapacityWindow = {
  readonly windowStartSecond: number;
  readonly runnableChannelIds: readonly string[];
  readonly advancedChannelIds: readonly string[];
  readonly providerRateBlockedChannels: readonly string[];
};

export type BrainCapacityRun = {
  readonly schemaVersion: "maestro-brain-capacity-run/v1";
  readonly fixture: BrainCapacityFixture;
  readonly runnerClass: string;
  readonly seed: string;
  readonly configHash: string;
  readonly codeHash: string;
  readonly hardware: { readonly cpuClass: string; readonly memoryGb: number };
  readonly liveLatencyMs: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
  readonly askLatencyMs: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
  readonly windows: readonly BrainCapacityWindow[];
  readonly admittedEvents: number;
  readonly visibleWithin60Seconds: number;
  readonly drainedWithinFiveMinutes: boolean;
  readonly droppedEvents: number;
  readonly queueOverflowEvents: number;
  readonly attempts: number;
  readonly acceptedEffects: number;
  readonly crossBrainLeakEffects: number;
  readonly rateWaits: number;
  readonly queueDepthMax: number;
  readonly recentProgressChannels: number;
  readonly deepProgressChannels: number;
  readonly storageBytes: number;
  readonly modelTokens: number;
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

export type BrainCapacityReceipt = {
  readonly schemaVersion: "maestro-brain-capacity-receipt/v1";
  readonly fixtureHash: string;
  readonly configHash: string;
  readonly codeHash: string;
  readonly runnerClass: string;
  readonly seed: string;
  readonly hardware: BrainCapacityRun["hardware"];
  readonly metrics: {
    readonly liveLatencyMs: BrainCapacityRun["liveLatencyMs"];
    readonly askLatencyMs: BrainCapacityRun["askLatencyMs"];
    readonly visibleWithin60SecondsRatio: number;
    readonly queueDepthMax: number;
    readonly attempts: number;
    readonly acceptedEffects: number;
    readonly crossBrainLeakEffects: number;
    readonly rateWaits: number;
    readonly lossEvents: number;
    readonly storageBytes: number;
    readonly modelTokens: number;
    readonly tenantDenialCanaries: BrainCapacityRun["tenantDenialCanaries"];
    readonly aboveEnvelopeAdmission: BrainCapacityRun["aboveEnvelopeAdmission"];
  };
  readonly failures: readonly string[];
  readonly passed: boolean;
};

const expectedLiveEvents = (fixture: BrainCapacityFixture): number =>
  fixture.liveBurst.eventsPerSecond * fixture.liveBurst.durationSeconds;

export const buildBrainCapacityChannelIds = (
  fixture: BrainCapacityFixture,
): readonly string[] => [
  ...Array.from(
    { length: fixture.channels.direct },
    (_, index) => `direct-${String(index + 1).padStart(3, "0")}`,
  ),
  ...Array.from(
    { length: fixture.channels.classify },
    (_, index) => `classify-${String(index + 1).padStart(3, "0")}`,
  ),
  ...Array.from(
    { length: fixture.channels.captureOnly },
    (_, index) => `capture-${String(index + 1).padStart(3, "0")}`,
  ),
];

const fixtureMatches = (fixture: BrainCapacityFixture): boolean =>
  sha256(fixture) === sha256(BRAIN_CAPACITY_FIXTURE);

const unique = (ids: readonly string[]): Set<string> => new Set(ids);

export const evaluateBrainCapacity = (
  run: BrainCapacityRun,
): BrainCapacityReceipt => {
  const failures: string[] = [];
  if (!fixtureMatches(run.fixture)) failures.push("fixture envelope changed");
  if (run.admittedEvents < expectedLiveEvents(run.fixture)) {
    failures.push("admitted events below declared burst");
  }
  if (run.visibleWithin60Seconds / run.admittedEvents < 0.95) {
    failures.push("less than 95% of live events visible within 60 seconds");
  }
  if (!run.drainedWithinFiveMinutes)
    failures.push("admitted events missed drain deadline");
  if (run.droppedEvents !== 0) failures.push("dropped event detected");
  if (run.queueOverflowEvents !== 0) failures.push("queue overflow detected");
  if (run.attempts !== run.acceptedEffects)
    failures.push("attempt/effect mismatch");
  if (run.crossBrainLeakEffects !== 0)
    failures.push("cross-Brain leak detected");
  if (run.recentProgressChannels !== run.fixture.channels.total) {
    failures.push("shared or stalled recent cursor detected");
  }
  if (run.deepProgressChannels !== run.fixture.channels.total) {
    failures.push("shared or stalled deep cursor detected");
  }
  const expectedChannels = buildBrainCapacityChannelIds(run.fixture);
  const expectedChannelSet = unique(expectedChannels);
  const previousMissed = new Set<string>();
  for (const window of run.windows) {
    const runnable = unique(window.runnableChannelIds);
    const advanced = unique(window.advancedChannelIds);
    const blocked = unique(window.providerRateBlockedChannels);
    if (runnable.size !== window.runnableChannelIds.length)
      failures.push(
        `duplicate runnable channel in ${window.windowStartSecond}s window`,
      );
    for (const channelId of window.runnableChannelIds) {
      if (!expectedChannelSet.has(channelId))
        failures.push(`unknown runnable channel ${channelId}`);
    }
    for (const channelId of window.providerRateBlockedChannels) {
      if (!runnable.has(channelId))
        failures.push(
          `provider-rate block for non-runnable channel ${channelId}`,
        );
    }
    const missedThisWindow = new Set<string>();
    for (const channelId of runnable) {
      if (advanced.has(channelId)) continue;
      missedThisWindow.add(channelId);
      if (!blocked.has(channelId)) {
        failures.push(
          `channel ${channelId} missed ${window.windowStartSecond}s window without provider-rate block`,
        );
      }
      if (previousMissed.has(channelId) && !blocked.has(channelId)) {
        failures.push(
          `channel ${channelId} missed two consecutive fairness windows`,
        );
      }
    }
    previousMissed.clear();
    for (const channelId of missedThisWindow) previousMissed.add(channelId);
  }
  for (const [name, denied] of Object.entries(run.tenantDenialCanaries)) {
    if (!denied) failures.push(`tenant canary failed: ${name}`);
  }
  if (
    run.aboveEnvelopeAdmission.attemptedEventsPerSecond >
    run.fixture.liveBurst.eventsPerSecond
  ) {
    if (run.aboveEnvelopeAdmission.outcome === "Accepted") {
      failures.push("above-envelope load silently accepted");
    }
    if (run.aboveEnvelopeAdmission.outcome === "Dropped") {
      failures.push("above-envelope load silently dropped");
    }
    if (
      run.aboveEnvelopeAdmission.outcome === "Queued" &&
      !run.aboveEnvelopeAdmission.queuedVisible
    ) {
      failures.push("above-envelope queued pressure was not visible");
    }
  }

  return {
    schemaVersion: "maestro-brain-capacity-receipt/v1",
    fixtureHash: sha256(run.fixture),
    configHash: run.configHash,
    codeHash: run.codeHash,
    runnerClass: run.runnerClass,
    seed: run.seed,
    hardware: run.hardware,
    metrics: {
      liveLatencyMs: run.liveLatencyMs,
      askLatencyMs: run.askLatencyMs,
      visibleWithin60SecondsRatio:
        run.visibleWithin60Seconds / run.admittedEvents,
      queueDepthMax: run.queueDepthMax,
      attempts: run.attempts,
      acceptedEffects: run.acceptedEffects,
      crossBrainLeakEffects: run.crossBrainLeakEffects,
      rateWaits: run.rateWaits,
      lossEvents: run.droppedEvents + run.queueOverflowEvents,
      storageBytes: run.storageBytes,
      modelTokens: run.modelTokens,
      tenantDenialCanaries: run.tenantDenialCanaries,
      aboveEnvelopeAdmission: run.aboveEnvelopeAdmission,
    },
    failures,
    passed: failures.length === 0,
  };
};
