import { sha256 } from "./brain-eval-report";
import {
  BRAIN_CAPACITY_FIXTURE,
  type BrainCapacityFixture,
} from "./brain-capacity-fixture";

export type BrainCapacityWindow = {
  readonly windowStartSecond: number;
  readonly runnableChannels: number;
  readonly advancedChannels: number;
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
    readonly rateWaits: number;
    readonly lossEvents: number;
    readonly storageBytes: number;
    readonly modelTokens: number;
    readonly tenantDenialCanaries: BrainCapacityRun["tenantDenialCanaries"];
  };
  readonly failures: readonly string[];
  readonly passed: boolean;
};

const expectedLiveEvents = (fixture: BrainCapacityFixture): number =>
  fixture.liveBurst.eventsPerSecond * fixture.liveBurst.durationSeconds;

const fixtureMatches = (fixture: BrainCapacityFixture): boolean =>
  sha256(fixture) === sha256(BRAIN_CAPACITY_FIXTURE);

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
  if (run.recentProgressChannels !== run.fixture.channels.total) {
    failures.push("shared or stalled recent cursor detected");
  }
  if (run.deepProgressChannels !== run.fixture.channels.total) {
    failures.push("shared or stalled deep cursor detected");
  }
  for (const window of run.windows) {
    const accounted =
      window.advancedChannels + window.providerRateBlockedChannels.length;
    if (accounted < window.runnableChannels) {
      failures.push(`unfair progress window at ${window.windowStartSecond}s`);
    }
  }
  for (const [name, denied] of Object.entries(run.tenantDenialCanaries)) {
    if (!denied) failures.push(`tenant canary failed: ${name}`);
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
      rateWaits: run.rateWaits,
      lossEvents: run.droppedEvents + run.queueOverflowEvents,
      storageBytes: run.storageBytes,
      modelTokens: run.modelTokens,
      tenantDenialCanaries: run.tenantDenialCanaries,
    },
    failures,
    passed: failures.length === 0,
  };
};
