import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NonNegativeInteger, PositiveInteger } from "../brain/retrievalSchemas";

export const SlackPublicationTargetIntentRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  receiptId: Id("providerEventReceipts"),
  organizationKey: Schema.String,
  channelKey: Schema.String,
  sourceRevisionKey: Schema.String,
  providerTargetResolutionIntentId: Schema.optional(
    Id("providerTargetResolutionIntents"),
  ),
  status: Schema.Literal("pending", "retry_wait", "succeeded"),
  attemptCount: NonNegativeInteger,
  nextAttemptAt: NonNegativeInteger,
  lastErrorTag: Schema.NullOr(Schema.String),
  resolutionGeneration: Schema.optional(PositiveInteger),
  linkageVersion: Schema.optional(Schema.Literal(1)),
  targetCount: NonNegativeInteger,
  targetDigest: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^sha256:[a-f0-9]{64}$/)),
  ),
  targets: Schema.optional(
    Schema.Array(
      Schema.Struct({
        workspaceId: Id("workspaces"),
        brainKey: Schema.String,
        jobKey: Schema.String.pipe(Schema.pattern(/^rjob_[a-f0-9]{64}$/)),
      }),
    ).pipe(Schema.maxItems(26)),
  ),
  completedAt: Schema.NullOr(NonNegativeInteger),
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => SlackPublicationTargetIntentRow)
  .index("by_receipt_id", ["receiptId"])
  .index("by_organization_channel_status", [
    "organizationKey",
    "channelKey",
    "status",
    "updatedAt",
  ])
  .index("by_status_due", ["status", "nextAttemptAt", "organizationKey"])
  .index("by_status_linkage_version", [
    "status",
    "linkageVersion",
    "nextAttemptAt",
  ]);
