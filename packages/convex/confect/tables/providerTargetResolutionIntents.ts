import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));

export const ProviderTargetResolutionStatus = Schema.Literal(
  "pending",
  "retry_wait",
  "capacity_blocked",
  "succeeded",
  "policy_excluded",
  "stale",
  "integrity_failure",
);

export const ProviderTargetResolutionTarget = Schema.Struct({
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  jobKey: Schema.String.pipe(Schema.pattern(/^rjob_[a-f0-9]{64}$/)),
  authorityDigest: Schema.String.pipe(Schema.pattern(/^raud_[a-f0-9]{64}$/)),
  childIngestionObligationKey: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^iobl_[a-f0-9]{64}$/)),
  ),
});

export const ProviderTargetResolutionIntentRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  targetResolutionIntentKey: Schema.String.pipe(
    Schema.pattern(/^trsi_[a-f0-9]{64}$/),
  ),
  ingestionObligationKey: Schema.String.pipe(
    Schema.pattern(/^iobl_[a-f0-9]{64}$/),
  ),
  authorityKind: Schema.optional(
    Schema.Literal("reconciliation_page", "live_capture"),
  ),
  requiredScopeIntentKey: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^brsi_[a-f0-9]{64}$/)),
  ),
  pageChunkKey: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^cchunk_[a-f0-9]{64}$/)),
  ),
  pageEnvelopeKey: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^cenv_[a-f0-9]{64}$/)),
  ),
  reconciliationRunKey: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^crun_[a-f0-9]{64}$/)),
  ),
  runGeneration: Schema.optional(PositiveInteger),
  organizationKey: Schema.String,
  workspaceId: Schema.optional(Id("workspaces")),
  brainKey: Schema.optional(Schema.String),
  corpusKey: Schema.Literal("slack", "transcripts", "documents"),
  providerKind: Schema.Literal("slack", "transcript", "google_drive"),
  connectorScopeKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: Schema.optional(PositiveInteger),
  membershipKey: Schema.String,
  originKind: Schema.Literal("slack", "transcript", "document"),
  originKey: Schema.String,
  originRevisionKey: Schema.String,
  ledgerSequence: Schema.optional(NonNegativeNumber),
  captureKey: Schema.optional(Schema.String),
  capturedAt: Schema.optional(NonNegativeInteger),
  observationDigest: ContentHash,
  resolutionGeneration: PositiveInteger,
  authorityDigest: ContentHash,
  status: ProviderTargetResolutionStatus,
  attemptCount: NonNegativeInteger,
  nextAttemptAt: NonNegativeInteger,
  lastErrorTag: Schema.NullOr(Schema.String),
  targetCount: NonNegativeInteger,
  targetDigest: Schema.NullOr(ContentHash),
  targets: Schema.Array(ProviderTargetResolutionTarget).pipe(
    Schema.maxItems(100),
  ),
  completedAt: Schema.NullOr(NonNegativeInteger),
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => ProviderTargetResolutionIntentRow)
  .index("by_target_resolution_intent_key", ["targetResolutionIntentKey"])
  .index("by_ingestion_obligation_key", ["ingestionObligationKey"])
  .index("by_origin_revision", [
    "organizationKey",
    "originKind",
    "originRevisionKey",
  ])
  .index("by_status_due_intent", [
    "status",
    "nextAttemptAt",
    "targetResolutionIntentKey",
  ])
  .index("by_scope_status_due_intent", [
    "organizationKey",
    "connectorScopeKey",
    "connectionGeneration",
    "status",
    "nextAttemptAt",
    "targetResolutionIntentKey",
  ])
  .index("by_run_ledger_intent", [
    "reconciliationRunKey",
    "ledgerSequence",
    "targetResolutionIntentKey",
  ]);
