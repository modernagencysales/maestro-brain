import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NonNegativeInteger } from "../brain/retrievalSchemas";

export const SlackPublicationTargetIntentRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  receiptId: Id("providerEventReceipts"),
  organizationKey: Schema.String,
  channelKey: Schema.String,
  sourceRevisionKey: Schema.String,
  status: Schema.Literal("pending", "retry_wait", "succeeded"),
  attemptCount: NonNegativeInteger,
  nextAttemptAt: NonNegativeInteger,
  lastErrorTag: Schema.NullOr(Schema.String),
  targetCount: NonNegativeInteger,
  completedAt: Schema.NullOr(NonNegativeInteger),
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => SlackPublicationTargetIntentRow)
  .index("by_receipt_id", ["receiptId"])
  .index("by_status_due", ["status", "nextAttemptAt", "organizationKey"]);
