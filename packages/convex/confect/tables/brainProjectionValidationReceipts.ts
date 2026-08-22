import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));
const NullableNumber = Schema.NullOr(NonNegativeNumber);
const NullableString = Schema.NullOr(Schema.String);
const NullableDigest = Schema.NullOr(ContentHash);

export const ProjectionValidationObligationState = Schema.Literal(
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

export const ProjectionValidationJobState = Schema.Literal(
  "pending",
  "retry_wait",
  "succeeded",
  "superseded",
  "revoked",
  "integrity_failure",
  "dead_letter",
);

const ObligationStateCount = Schema.Struct({
  state: ProjectionValidationObligationState,
  count: NonNegativeInteger,
});

const JobStateCount = Schema.Struct({
  state: ProjectionValidationJobState,
  count: NonNegativeInteger,
});

export const ProjectionValidationRequiredScope = Schema.Struct({
  requiredScopeIntentKey: Schema.String,
  intentGeneration: PositiveInteger,
  corpusKey: Schema.Literal("slack", "transcripts", "documents"),
  providerKind: Schema.Literal("slack", "transcript", "google_drive"),
  connectorScopeKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  controllingConfigurationDigest: ContentHash,
  reconciliationRunKey: Schema.String,
  reconciliationRunGeneration: PositiveInteger,
  reconciliationProviderHighWater: NullableString,
  reconciliationLedgerHighWater: NonNegativeNumber,
  reconciliationCompletionDigest: ContentHash,
  rebuildRunKey: NullableString,
  rebuildRunGeneration: NullableNumber,
  rebuildLedgerHighWater: NullableNumber,
  rebuildCatchupHighWater: NullableNumber,
  rebuildCompletionDigest: NullableDigest,
  healthUpdatedAt: NonNegativeInteger,
  lastObservedAt: NonNegativeInteger,
  lastPublishedAt: NonNegativeInteger,
  lastReconciledAt: NonNegativeInteger,
  obligationCounts: Schema.Array(ObligationStateCount).pipe(
    Schema.maxItems(12),
  ),
  publicationJobCounts: Schema.Array(JobStateCount).pipe(Schema.maxItems(7)),
});

export const BrainProjectionValidationReceiptRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  receiptKey: Schema.String.pipe(Schema.pattern(/^bpvr_[a-f0-9]{64}$/)),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  deploymentSha: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  projectionSchemaVersion: Schema.Literal("3"),
  projectionManifestVersion: Schema.Literal("2"),
  validatedMode: Schema.Literal("compatibility", "disabled"),
  validatedModeGeneration: NonNegativeInteger,
  projectionPopulationGeneration: PositiveInteger,
  subjectBackfillGeneration: PositiveInteger,
  subjectPopulationDigest: ContentHash,
  subjectCompletionDigest: ContentHash,
  fenceBackfillGeneration: PositiveInteger,
  fencePopulationDigest: ContentHash,
  fenceCompletionDigest: ContentHash,
  publicationSetKeys: Schema.Array(Schema.String).pipe(Schema.maxItems(100)),
  currentPublicationSetCount: NonNegativeInteger,
  retiredPublicationSetCount: NonNegativeInteger,
  publicationEntryCount: NonNegativeInteger,
  publicationTokenCount: NonNegativeInteger,
  publicationPopulationDigest: ContentHash,
  requiredScopeCount: PositiveInteger,
  requiredScopeManifest: Schema.Array(ProjectionValidationRequiredScope).pipe(
    Schema.maxItems(10),
  ),
  requiredScopeManifestDigest: ContentHash,
  obligationCount: NonNegativeInteger,
  obligationPopulationDigest: ContentHash,
  publicationJobCount: NonNegativeInteger,
  publicationJobCounts: Schema.Array(JobStateCount).pipe(Schema.maxItems(7)),
  publicationJobPopulationDigest: ContentHash,
  unresolvedSlackTargetResolutionIntentCount: Schema.optional(
    Schema.Literal(0),
  ),
  unresolvedSlackTargetResolutionIntentPopulationDigest:
    Schema.optional(ContentHash),
  activePublicationLeaseCount: Schema.Literal(0),
  repairEffectCount: NonNegativeInteger,
  repairEffectPopulationDigest: ContentHash,
  readinessSnapshotDigest: ContentHash,
  issuedAt: NonNegativeInteger,
  expiresAt: NonNegativeInteger,
  receiptDigest: ContentHash,
  consumedAt: Schema.NullOr(NonNegativeInteger),
  consumedModeGeneration: Schema.NullOr(PositiveInteger),
});

export default Table.make(() => BrainProjectionValidationReceiptRow)
  .index("by_receipt_key", ["receiptKey"])
  .index("by_workspace_brain_expiry", ["workspaceId", "brainKey", "expiresAt"]);
