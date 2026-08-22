import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NonNegativeInteger, PositiveInteger } from "../brain/retrievalSchemas";

const EligibilityFenceSnapshot = Schema.Struct({
  kind: Schema.Literal(
    "lifecycle",
    "route",
    "policy",
    "scope",
    "allowlist",
    "connection",
  ),
  fenceKey: Schema.String,
  eligibilityGeneration: PositiveInteger,
  eligible: Schema.Boolean,
  controllerKey: Schema.String,
});

const AuthorityEnvelope = Schema.Struct({
  version: Schema.Literal(1),
  publicationSubjectKey: Schema.optional(Schema.String),
  subjectIncarnationKey: Schema.optional(Schema.String),
  connectorScopeKey: Schema.optional(Schema.String),
  configuration: Schema.Struct({
    requestGeneration: PositiveInteger,
    policyGeneration: Schema.optional(PositiveInteger),
    routeGeneration: Schema.optional(PositiveInteger),
    lifecycleGeneration: Schema.optional(PositiveInteger),
    connectionGeneration: Schema.optional(PositiveInteger),
  }),
  eligibilityFences: Schema.Array(EligibilityFenceSnapshot),
  observationFence: Schema.Struct({
    kind: Schema.Literal("revision", "rebuild"),
    key: Schema.String,
    generation: Schema.optional(PositiveInteger),
  }),
  targetResolutionIntentKey: Schema.optional(
    Id("slackPublicationTargetIntents"),
  ),
  targetResolutionGeneration: Schema.optional(PositiveInteger),
  repairOfJobKey: Schema.optional(Schema.String),
  supersedesJobKey: Schema.optional(Schema.String),
  authorityDigest: Schema.String.pipe(Schema.pattern(/^raud_[a-f0-9]{64}$/)),
  stableEffectKey: Schema.String.pipe(Schema.pattern(/^rfx_[a-f0-9]{64}$/)),
  capturedAt: NonNegativeInteger,
});

const PagePublicationPolicy = Schema.Struct({
  authority: Schema.Literal("authoritative", "derived", "advisory"),
  authorityPolicyKey: Schema.String,
  policyGeneration: PositiveInteger,
});
const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));
const RebuildCursor = Schema.Struct({
  phase: Schema.optional(
    Schema.Literal("scan", "catch_up", "set_difference", "close"),
  ),
  phaseHighWater: Schema.optional(NonNegativeNumber),
  afterSourceKey: Schema.optional(Schema.String),
  limit: PositiveInteger,
  discoveredCount: Schema.optional(NonNegativeInteger),
  publishedCount: Schema.optional(NonNegativeInteger),
});

export const RetrievalPublicationJobRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  jobKey: Schema.String.pipe(Schema.pattern(/^rjob_[a-f0-9]{64}$/)),
  originKind: Schema.Literal(
    "page",
    "page_rebuild",
    "slack",
    "transcript",
    "slack_rebuild",
    "transcript_rebuild",
  ),
  effectClass: Schema.optional(
    Schema.Literal(
      "direct_publication",
      "rebuild_batch",
      "attributed_repair",
      "migration_replacement",
    ),
  ),
  operation: Schema.optional(Schema.Literal("publish", "cleanup")),
  rebuildRunKey: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^rrun_[a-f0-9]{64}$/)),
  ),
  rebuildRunGeneration: Schema.optional(PositiveInteger),
  rebuildLedgerHighWater: Schema.optional(
    Schema.Number.pipe(Schema.greaterThanOrEqualTo(0)),
  ),
  rebuildPauseEpoch: Schema.optional(NonNegativeInteger),
  rebuildPredecessorDigest: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^sha256:[a-f0-9]{64}$/)),
  ),
  rebuildResultDigest: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^sha256:[a-f0-9]{64}$/)),
  ),
  parentRebuildJobKey: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^rjob_[a-f0-9]{64}$/)),
  ),
  sourceKey: Schema.String,
  sourceRevisionKey: Schema.String,
  requestGeneration: PositiveInteger,
  page: Schema.optional(PagePublicationPolicy),
  rebuild: Schema.optional(RebuildCursor),
  targetResolutionIntentKey: Schema.optional(
    Id("slackPublicationTargetIntents"),
  ),
  authorityDigest: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^raud_[a-f0-9]{64}$/)),
  ),
  authorityEnvelope: Schema.optional(AuthorityEnvelope),
  supersededByJobKey: Schema.optional(Schema.String),
  status: Schema.Literal(
    "pending",
    "retry_wait",
    "succeeded",
    "superseded",
    "revoked",
    "integrity_failure",
    "dead_letter",
  ),
  attemptCount: NonNegativeInteger,
  maxAttempts: PositiveInteger,
  nextAttemptAt: NonNegativeInteger,
  lastErrorTag: Schema.optional(Schema.String),
  completedAt: Schema.optional(NonNegativeInteger),
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => RetrievalPublicationJobRow)
  .index("by_job_key", ["jobKey"])
  .index("by_status_due_job", ["status", "nextAttemptAt", "jobKey"])
  .index("by_target_resolution_intent", ["targetResolutionIntentKey", "jobKey"])
  .index("by_rebuild_run_status", ["rebuildRunKey", "status", "jobKey"])
  .index("by_rebuild_run_predecessor", [
    "rebuildRunKey",
    "rebuildPredecessorDigest",
    "jobKey",
  ])
  .index("by_rebuild_parent_job", ["parentRebuildJobKey", "jobKey"])
  .index("by_rebuild_run_origin_operation_revision", [
    "rebuildRunKey",
    "originKind",
    "operation",
    "sourceRevisionKey",
    "jobKey",
  ])
  .index("by_rebuild_child_authority", [
    "rebuildRunKey",
    "originKind",
    "operation",
    "sourceRevisionKey",
    "authorityDigest",
    "jobKey",
  ])
  .index("by_workspace_brain_job", ["workspaceId", "brainKey", "jobKey"])
  .index("by_origin_target", [
    "workspaceId",
    "brainKey",
    "originKind",
    "sourceRevisionKey",
    "jobKey",
  ]);
