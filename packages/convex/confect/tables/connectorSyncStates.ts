import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const TranscriptProvider = Schema.Literal(
  "fireflies",
  "gong",
  "fathom",
  "granola",
);
export const ConnectorSyncStatus = Schema.Literal(
  "queued",
  "syncing",
  "ready",
  "retry_wait",
  "error",
  "revoked",
);
export const ConnectorSyncErrorTag = Schema.Literal(
  "ProviderRateLimited",
  "ProviderUnavailable",
  "PermanentDecodeFailure",
);

export const ConnectorSyncStateRow = Schema.Struct({
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: Schema.Number,
  provider: TranscriptProvider,
  status: ConnectorSyncStatus,
  cursor: Schema.NullOr(Schema.String),
  leaseId: Schema.NullOr(Schema.String),
  leaseExpiresAt: Schema.NullOr(Schema.Number),
  nextAttemptAt: Schema.Number,
  lastSuccessAt: Schema.NullOr(Schema.Number),
  callsDiscovered: Schema.Number,
  callsIngested: Schema.Number,
  duplicateCount: Schema.Number,
  failureCount: Schema.Number,
  lastErrorTag: Schema.NullOr(ConnectorSyncErrorTag),
  backfillComplete: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type ConnectorSyncStateRowValue = typeof ConnectorSyncStateRow.Type;

export default Table.make(() => ConnectorSyncStateRow)
  .index("by_connection", ["connectionKey"])
  .index("by_organization_provider", ["organizationKey", "provider"])
  .index("by_status_due", ["status", "nextAttemptAt", "updatedAt"]);
