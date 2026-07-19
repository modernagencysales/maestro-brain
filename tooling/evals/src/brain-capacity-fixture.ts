export type BrainCapacityFixture = {
  readonly schemaVersion: "maestro-brain-capacity-fixture/v1";
  readonly agencies: number;
  readonly primaryAgencyClients: number;
  readonly channels: {
    readonly direct: number;
    readonly classify: number;
    readonly captureOnly: number;
    readonly total: number;
  };
  readonly sourceRevisions: number;
  readonly liveBurst: {
    readonly eventsPerSecond: number;
    readonly durationSeconds: number;
  };
  readonly concurrentAskMcpRequests: number;
  readonly fairnessWindowSeconds: number;
  readonly drainDeadlineSeconds: number;
};

export const BRAIN_CAPACITY_FIXTURE: BrainCapacityFixture = {
  schemaVersion: "maestro-brain-capacity-fixture/v1",
  agencies: 2,
  primaryAgencyClients: 25,
  channels: { direct: 75, classify: 20, captureOnly: 5, total: 100 },
  sourceRevisions: 100_000,
  liveBurst: { eventsPerSecond: 20, durationSeconds: 60 },
  concurrentAskMcpRequests: 10,
  fairnessWindowSeconds: 60,
  drainDeadlineSeconds: 300,
};

export const buildBrainCapacityFixture = (): BrainCapacityFixture =>
  BRAIN_CAPACITY_FIXTURE;
