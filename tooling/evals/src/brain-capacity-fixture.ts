export type BrainCapacityFixture = Readonly<{
  readonly agencies: number;
  readonly primaryAgencyClients: number;
  readonly channels: Readonly<{
    readonly direct: number;
    readonly classify: number;
    readonly captureOnly: number;
    readonly total: number;
  }>;
  readonly sourceRevisions: number;
  readonly liveBurst: Readonly<{
    readonly eventsPerSecond: number;
    readonly durationSeconds: number;
  }>;
  readonly concurrentAskMcpRequests: number;
}>;

export const BRAIN_CAPACITY_FIXTURE: BrainCapacityFixture = {
  agencies: 2,
  primaryAgencyClients: 25,
  channels: { direct: 75, classify: 20, captureOnly: 5, total: 100 },
  sourceRevisions: 100_000,
  liveBurst: { eventsPerSecond: 20, durationSeconds: 60 },
  concurrentAskMcpRequests: 10,
};

export const buildBrainCapacityFixture = (): BrainCapacityFixture => ({
  ...BRAIN_CAPACITY_FIXTURE,
  channels: { ...BRAIN_CAPACITY_FIXTURE.channels },
  liveBurst: { ...BRAIN_CAPACITY_FIXTURE.liveBurst },
});
