import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NonNegativeInteger, PositiveInteger } from "../brain/retrievalSchemas";

const PagePublicationPolicy = Schema.Struct({
  authority: Schema.Literal("authoritative", "derived", "advisory"),
  authorityPolicyKey: Schema.String,
  policyGeneration: PositiveInteger,
});

export const RetrievalPublicationJobRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  jobKey: Schema.String.pipe(Schema.pattern(/^rjob_[a-f0-9]{64}$/)),
  originKind: Schema.Literal("page", "slack", "transcript"),
  sourceKey: Schema.String,
  sourceRevisionKey: Schema.String,
  requestGeneration: PositiveInteger,
  page: Schema.optional(PagePublicationPolicy),
  status: Schema.Literal(
    "pending",
    "retry_wait",
    "succeeded",
    "superseded",
    "revoked",
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
  .index("by_origin_target", [
    "workspaceId",
    "brainKey",
    "originKind",
    "sourceRevisionKey",
    "jobKey",
  ]);
