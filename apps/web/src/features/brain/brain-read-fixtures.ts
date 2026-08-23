import type {
  BrainContextPackData,
  BrainRolloutStatusData,
  BrainSearchResult,
  CandidateManifestV2Data,
} from "./brain-read-contract";

const digest = `sha256:${"a".repeat(64)}`;
const secondDigest = `sha256:${"b".repeat(64)}`;
const structuredEntityKey = `sent_${"c".repeat(64)}`;
const structuredRevisionKey = `srev_${"d".repeat(64)}`;
const structuredObservationKey = `sobs_${"e".repeat(64)}`;
const structuredRouteKey = `sroute_${"f".repeat(64)}`;
const evaluatedAt = 1_754_000_000_000;

export const candidateManifestV2Fixture: CandidateManifestV2Data = {
  version: "2",
  hash: digest,
};

export const canonicalSearchResultFixture: BrainSearchResult = {
  sourceKey: "source_launch",
  sourceRevisionKey: "revision_launch_4",
  publicationSetKey: "publication_launch_7",
  entryKey: "entry_launch",
  passageKey: "passage_launch_1",
  startOffset: 12,
  endOffset: 48,
  contentHash: digest,
  kind: "source",
  citationKey: "publication_launch_7:entry_launch",
  title: "Launch thread",
  excerpt: "The approved launch date is Friday.",
  authority: "authoritative",
  authorityPolicyKey: "policy_launch",
  observedAt: evaluatedAt,
  indexedAt: evaluatedAt + 100,
  freshness: "current",
  truncated: false,
  state: "resolved",
};

export const contextPackCurrentFixture: BrainContextPackData = {
  schemaVersion: "3",
  candidateManifest: candidateManifestV2Fixture,
  requestId: "request_launch",
  organizationKey: "organization_apero",
  brainKey: "brain_apero",
  question: "When is launch?",
  asOf: evaluatedAt,
  freshness: "current",
  coverageStatus: "complete",
  readiness: "ready",
  coverage: [
    {
      corpusKey: "slack",
      sourceKind: "slack",
      connectorScopeKey: "channel_launch",
      required: true,
      status: "complete",
      freshness: "current",
      generations: {
        connection: 3,
        allowlist: 4,
        policy: 2,
        reconciliation: 7,
      },
      lastObservedAt: evaluatedAt - 1_000,
      lastReconciledAt: evaluatedAt - 500,
      unresolvedFailureCount: 0,
    },
  ],
  entries: [
    {
      kind: "source",
      brainKey: "brain_apero",
      title: "Launch thread",
      excerpt: "The approved launch date is Friday.",
      sourceKey: "source_launch",
      revisionKey: "revision_launch_4",
      sourceRevisionKey: "revision_launch_4",
      publicationSetKey: "publication_launch_7",
      entryKey: "entry_launch",
      passageKey: "passage_launch_1",
      startOffset: 12,
      endOffset: 48,
      contentHash: digest,
      authority: "authoritative",
      observedAt: evaluatedAt,
      indexedAt: evaluatedAt + 100,
      freshness: "current",
      truncated: false,
      citationKey: "publication_launch_7:entry_launch",
      authorityPolicyKey: "policy_launch",
      state: "resolved",
    },
  ],
  structuredFacts: [
    {
      origin: {
        kind: "structured",
        organizationKey: "organization_apero",
        workspaceId: "workspace_apero",
        brainKey: "brain_apero",
        structuredEntityKey,
        structuredRevisionKey,
        structuredObservationKey,
        structuredRouteKey,
        fieldPath: "launch.date",
        valueHash: secondDigest,
      },
      entity: {
        structuredEntityKey,
        providerKey: "slack",
        entityKind: "launch",
        providerEntityId: "launch_1",
        incarnation: 1,
      },
      fieldPath: "launch.date",
      value: { type: "string", value: "Friday" },
      revision: {
        structuredRevisionKey,
        providerRevision: "4",
        observationOrder: 4,
        incarnation: 1,
      },
      valueHash: secondDigest,
      authority: "authoritative",
      sourceModifiedAt: evaluatedAt - 2_000,
      observedAt: evaluatedAt - 1_000,
      locator: "slack://channel_launch/thread_launch",
    },
  ],
  conflicts: [],
  structuredConflicts: [
    {
      subject: "launch.date",
      narrativeRevisionKeys: ["revision_launch_3"],
      structuredRevisionKeys: ["srev_launch_4"],
      reason: "narrative_typed_disagreement",
      behavior: "expose_both",
    },
  ],
  omissions: [],
};

export const contextPackStaleFixture: BrainContextPackData = {
  ...contextPackCurrentFixture,
  freshness: "stale",
  coverage: contextPackCurrentFixture.coverage.map((coverage) => ({
    ...coverage,
    freshness: "stale",
  })),
};

export const contextPackPartialFixture: BrainContextPackData = {
  ...contextPackCurrentFixture,
  coverageStatus: "partial",
  coverage: contextPackCurrentFixture.coverage.map((coverage) => ({
    ...coverage,
    status: "partial",
    reason: "Reconciliation is still running.",
  })),
  omissions: [{ reason: "reconciliation_pending", count: 1 }],
};

export const contextPackUnavailableFixture: BrainContextPackData = {
  ...contextPackCurrentFixture,
  coverageStatus: "unavailable",
  coverage: contextPackCurrentFixture.coverage.map((coverage) => ({
    ...coverage,
    status: "unavailable",
    freshness: "unknown",
    reason: "Required connector health is unavailable.",
  })),
  entries: [],
};

export const contextPackBlockedFixture: BrainContextPackData = {
  ...contextPackCurrentFixture,
  readiness: "blocked",
};

const rolloutScope: BrainRolloutStatusData["scopes"][number] = {
  requiredScopeIntentKey: "scope_launch",
  intentGeneration: 1,
  corpusKey: "slack",
  providerKind: "slack",
  connectorScopeKey: "channel_launch",
  configuration: {
    connectionKey: "connection_slack",
    connectionGeneration: 3,
    allowlistGeneration: 4,
    controllingConfigurationDigest: digest,
    connectorState: "active",
    allowlistState: "current",
    tupleMatches: true,
  },
  eligibility: { status: "eligible", failureCount: 0 },
  reconciliation: {
    runKey: "run_7",
    runGeneration: 7,
    status: "complete",
    providerHighWater: "provider_42",
    ledgerHighWater: 42,
    completedAt: evaluatedAt - 500,
    completionDigest: digest,
    blockingObligationCount: 0,
    truncated: false,
  },
  rebuild: {
    runKey: null,
    runGeneration: null,
    status: null,
    ledgerHighWater: null,
    catchupHighWater: null,
    completionDigest: null,
    blockingChildCount: 0,
    truncated: false,
  },
  health: {
    rowPresent: true,
    lastObservedAt: evaluatedAt - 1_000,
    lastPublishedAt: evaluatedAt - 900,
    lastReconciledAt: evaluatedAt - 500,
    freshnessThresholdMs: 86_400_000,
    failedCount: 0,
    degradedReason: null,
  },
  freshness: "current",
  coverageStatus: "complete",
  readiness: "ready",
  obligations: {
    counts: [{ state: "complete", count: 12, truncated: false }],
    nonterminalCount: 0,
    oldestNonterminalAt: null,
    truncated: false,
  },
  publication: {
    counts: [{ state: "succeeded", count: 12, truncated: false }],
    unresolvedCount: 0,
    deadLetters: [],
    truncated: false,
  },
  targetResolution: {
    counts: [],
    unresolvedCount: 0,
    oldestUnresolvedAt: null,
    truncated: false,
  },
  workers: { pauseEpoch: 0, state: "running" },
  failures: {
    capacityCount: 0,
    publicationIntegrityCount: 0,
    eligibilityIntegrityCount: 0,
  },
  blockers: [],
};

export const rolloutCurrentFixture: BrainRolloutStatusData = {
  statusVersion: 1,
  organizationKey: "organization_apero",
  workspaceId: "workspace_apero" as BrainRolloutStatusData["workspaceId"],
  brainKey: "brain_apero",
  evaluatedAt,
  freshness: "current",
  coverageStatus: "complete",
  readiness: "ready",
  promotionReady: true,
  projection: {
    present: true,
    projectionPopulationGeneration: 2,
    subjectBackfillGeneration: 2,
    subjectPopulationDigest: digest,
    subjectCompletionDigest: digest,
    subjectValidated: true,
    fenceBackfillGeneration: 2,
    fencePopulationDigest: secondDigest,
    fenceCompletionDigest: secondDigest,
    fenceValidated: true,
    conflictCount: 0,
    capacityCount: 0,
  },
  scopes: [rolloutScope],
  alerts: [],
};

const blockedRollout = (
  scope: BrainRolloutStatusData["scopes"][number],
  overrides: Partial<BrainRolloutStatusData> = {},
): BrainRolloutStatusData => ({
  ...rolloutCurrentFixture,
  readiness: "blocked",
  promotionReady: false,
  scopes: [scope],
  ...overrides,
});

export const rolloutStaleFixture = blockedRollout(
  {
    ...rolloutScope,
    freshness: "stale",
    readiness: "blocked",
    blockers: ["freshness_stale"],
  },
  { freshness: "stale" },
);

export const rolloutPartialFixture = blockedRollout(
  {
    ...rolloutScope,
    coverageStatus: "partial",
    readiness: "blocked",
    blockers: ["coverage_incomplete"],
  },
  { coverageStatus: "partial" },
);

export const rolloutUnavailableFixture = blockedRollout(
  {
    ...rolloutScope,
    coverageStatus: "unavailable",
    freshness: "unknown",
    readiness: "blocked",
    blockers: ["missing_health"],
  },
  { coverageStatus: "unavailable", freshness: "unknown" },
);

export const rolloutBlockedFixture = blockedRollout({
  ...rolloutScope,
  readiness: "blocked",
  blockers: ["reconciliation_incomplete"],
});

export const rolloutCapacityFixture = blockedRollout({
  ...rolloutScope,
  readiness: "blocked",
  failures: { ...rolloutScope.failures, capacityCount: 2 },
  blockers: ["capacity_failure"],
});

export const rolloutIntegrityFixture = blockedRollout({
  ...rolloutScope,
  readiness: "blocked",
  failures: { ...rolloutScope.failures, publicationIntegrityCount: 1 },
  blockers: ["publication_integrity_failure"],
});

export const rolloutDeadLetterFixture = blockedRollout({
  ...rolloutScope,
  readiness: "blocked",
  publication: {
    ...rolloutScope.publication,
    counts: [{ state: "dead_letter", count: 1, truncated: false }],
    unresolvedCount: 1,
    deadLetters: [
      {
        jobKey: "publication_job_launch",
        effectClass: "publication",
        attemptCount: 5,
        lastErrorTag: "PermanentPublicationFailure",
        repairOfJobKey: null,
      },
    ],
  },
  blockers: ["dead_letter", "publication_jobs_unresolved"],
});

export const rolloutPausedFixture = blockedRollout({
  ...rolloutScope,
  readiness: "blocked",
  workers: { pauseEpoch: 2, state: "paused" },
  blockers: ["workers_paused"],
});
