import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "./retrievalSchemas";

export const RolloutFreshness = Schema.Literal("current", "stale", "unknown");
export const RolloutCoverageStatus = Schema.Literal(
  "complete",
  "partial",
  "unavailable",
  "unknown",
);
export const RolloutReadiness = Schema.Literal("ready", "blocked");

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(NonNegativeInteger);
const NullableDigest = Schema.NullOr(ContentHash);

const IngestionObligationState = Schema.Literal(
  "captured",
  "normalization_pending",
  "quarantined",
  "target_resolution_pending",
  "capacity_blocked",
  "publication_pending",
  "retry_wait",
  "removal_pending",
  "drain_pending",
  "complete",
  "policy_excluded",
  "failed",
);

const PublicationJobState = Schema.Literal(
  "pending",
  "retry_wait",
  "succeeded",
  "superseded",
  "revoked",
  "integrity_failure",
  "dead_letter",
);

const ObligationStateCount = Schema.Struct({
  state: IngestionObligationState,
  count: NonNegativeInteger,
  truncated: Schema.Boolean,
});
const PublicationJobStateCount = Schema.Struct({
  state: PublicationJobState,
  count: NonNegativeInteger,
  truncated: Schema.Boolean,
});
const ProviderTargetResolutionIntentStateCount = Schema.Struct({
  state: Schema.Literal(
    "pending",
    "retry_wait",
    "capacity_blocked",
    "integrity_failure",
  ),
  count: NonNegativeInteger,
  truncated: Schema.Boolean,
});

export const RolloutBlocker = Schema.Literal(
  "missing_health",
  "freshness_stale",
  "freshness_unknown",
  "coverage_incomplete",
  "configuration_mismatch",
  "scope_revoked",
  "eligibility_ineligible",
  "eligibility_integrity_failure",
  "reconciliation_incomplete",
  "obligations_nonterminal",
  "publication_jobs_unresolved",
  "target_resolution_intents_unresolved",
  "dead_letter",
  "quarantine",
  "cursor_stalled",
  "workers_paused",
  "capacity_failure",
  "publication_integrity_failure",
  "projection_population_invalid",
  "bounded_scan_overflow",
);

export const RolloutAlertKind = Schema.Literal(
  "freshness_breach",
  "reconciliation_breach",
  "oldest_obligation_breach",
  "dead_letter",
  "quarantine",
  "stalled_cursor",
  "integrity_failure",
  "retrieval_capacity_overflow",
  "bounded_scan_overflow",
);

const DeadLetter = Schema.Struct({
  jobKey: Schema.String,
  effectClass: NullableString,
  attemptCount: NonNegativeInteger,
  lastErrorTag: NullableString,
  repairOfJobKey: NullableString,
});

const ScopeStatus = Schema.Struct({
  requiredScopeIntentKey: Schema.String,
  intentGeneration: PositiveInteger,
  corpusKey: Schema.Literal("slack", "transcripts", "documents"),
  providerKind: Schema.Literal("slack", "transcript", "google_drive"),
  connectorScopeKey: Schema.String,
  configuration: Schema.Struct({
    connectionKey: Schema.String,
    connectionGeneration: PositiveInteger,
    allowlistGeneration: PositiveInteger,
    controllingConfigurationDigest: ContentHash,
    connectorState: Schema.Literal("active", "revoked", "missing"),
    allowlistState: Schema.Literal(
      "current",
      "superseded",
      "revoked",
      "missing",
    ),
    tupleMatches: Schema.Boolean,
  }),
  eligibility: Schema.Struct({
    status: Schema.Literal("eligible", "ineligible", "integrity_failure"),
    failureCount: NonNegativeInteger,
  }),
  reconciliation: Schema.Struct({
    runKey: NullableString,
    runGeneration: NullableNumber,
    status: Schema.NullOr(
      Schema.Literal(
        "scan",
        "traversal_closed",
        "apply_removals",
        "drain_derived",
        "complete",
        "superseded",
        "blocked",
      ),
    ),
    providerHighWater: NullableString,
    ledgerHighWater: NullableNumber,
    completedAt: NullableNumber,
    completionDigest: NullableDigest,
    blockingObligationCount: NonNegativeInteger,
    truncated: Schema.Boolean,
  }),
  rebuild: Schema.Struct({
    runKey: NullableString,
    runGeneration: NullableNumber,
    status: Schema.NullOr(
      Schema.Literal("running", "closing", "complete", "superseded", "blocked"),
    ),
    ledgerHighWater: NullableNumber,
    catchupHighWater: NullableNumber,
    completionDigest: NullableDigest,
    blockingChildCount: NonNegativeInteger,
    truncated: Schema.Boolean,
  }),
  health: Schema.Struct({
    rowPresent: Schema.Boolean,
    lastObservedAt: NullableNumber,
    lastPublishedAt: NullableNumber,
    lastReconciledAt: NullableNumber,
    freshnessThresholdMs: NullableNumber,
    failedCount: NonNegativeInteger,
    degradedReason: NullableString,
  }),
  freshness: RolloutFreshness,
  coverageStatus: RolloutCoverageStatus,
  readiness: RolloutReadiness,
  obligations: Schema.Struct({
    counts: Schema.Array(ObligationStateCount),
    nonterminalCount: NonNegativeInteger,
    oldestNonterminalAt: NullableNumber,
    truncated: Schema.Boolean,
  }),
  publication: Schema.Struct({
    counts: Schema.Array(PublicationJobStateCount),
    unresolvedCount: NonNegativeInteger,
    deadLetters: Schema.Array(DeadLetter).pipe(Schema.maxItems(20)),
    truncated: Schema.Boolean,
  }),
  targetResolution: Schema.Struct({
    counts: Schema.Array(ProviderTargetResolutionIntentStateCount).pipe(
      Schema.maxItems(4),
    ),
    unresolvedCount: NonNegativeInteger,
    oldestUnresolvedAt: NullableNumber,
    truncated: Schema.Boolean,
  }),
  workers: Schema.Struct({
    pauseEpoch: NonNegativeInteger,
    state: Schema.Literal("running", "paused"),
  }),
  failures: Schema.Struct({
    capacityCount: NonNegativeInteger,
    publicationIntegrityCount: NonNegativeInteger,
    eligibilityIntegrityCount: NonNegativeInteger,
  }),
  blockers: Schema.Array(RolloutBlocker),
});

const ProjectionPopulation = Schema.Struct({
  present: Schema.Boolean,
  projectionPopulationGeneration: NonNegativeInteger,
  subjectBackfillGeneration: NonNegativeInteger,
  subjectPopulationDigest: NullableDigest,
  subjectCompletionDigest: NullableDigest,
  subjectValidated: Schema.Boolean,
  fenceBackfillGeneration: NonNegativeInteger,
  fencePopulationDigest: NullableDigest,
  fenceCompletionDigest: NullableDigest,
  fenceValidated: Schema.Boolean,
  conflictCount: NonNegativeInteger,
  capacityCount: NonNegativeInteger,
});

const RolloutAlert = Schema.Struct({
  alertKey: Schema.String.pipe(Schema.pattern(/^ralt_[a-f0-9]{64}$/)),
  kind: RolloutAlertKind,
  severity: Schema.Literal("warning", "critical"),
  dri: Schema.Literal("workspace_owner"),
  connectorScopeKey: Schema.String,
  requiredScopeIntentKey: Schema.String,
  intentGeneration: PositiveInteger,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  reconciliationRunKey: NullableString,
  count: NonNegativeInteger,
  oldestAt: NullableNumber,
  entityKeys: Schema.Array(Schema.String).pipe(Schema.maxItems(20)),
  runbookLink: Schema.Literal("docs/template/operations-runbook.md#incident"),
});

export const BrainRolloutStatus = Schema.Struct({
  statusVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  evaluatedAt: NonNegativeInteger,
  freshness: RolloutFreshness,
  coverageStatus: RolloutCoverageStatus,
  readiness: RolloutReadiness,
  promotionReady: Schema.Boolean,
  projection: ProjectionPopulation,
  scopes: Schema.Array(ScopeStatus).pipe(Schema.maxItems(10)),
  alerts: Schema.Array(RolloutAlert),
});

export class RolloutStatusCapacityExceeded extends Schema.TaggedError<RolloutStatusCapacityExceeded>()(
  "RolloutStatusCapacityExceeded",
  {
    resource: Schema.Literal("required_scopes"),
    limit: PositiveInteger,
    observedAtLeast: PositiveInteger,
  },
) {}

export class RolloutStatusIntegrityConflict extends Schema.TaggedError<RolloutStatusIntegrityConflict>()(
  "RolloutStatusIntegrityConflict",
  {
    resource: Schema.Literal("required_scope_intent", "projection_population"),
    detail: Schema.String,
  },
) {}

const Errors = Schema.Union(
  RolloutStatusCapacityExceeded,
  RolloutStatusIntegrityConflict,
);

export const getBrainRolloutStatus = FunctionSpec.internalQuery({
  name: "getBrainRolloutStatus",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      now: NonNegativeInteger,
    }),
  returns: () => BrainRolloutStatus,
  error: () => Errors,
});

export default GroupSpec.make().addFunction(getBrainRolloutStatus);
