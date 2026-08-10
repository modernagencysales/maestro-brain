import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Forbidden, Unauthorized } from "../errors";
import {
  ConnectorSyncErrorTag,
  ConnectorSyncStateRow,
  TranscriptProvider,
} from "../tables/connectorSyncStates";

export class TranscriptSyncConnectionNotFound extends Schema.TaggedError<TranscriptSyncConnectionNotFound>()(
  "TranscriptSyncConnectionNotFound",
  {},
) {}
export class TranscriptSyncFenceError extends Schema.TaggedError<TranscriptSyncFenceError>()(
  "TranscriptSyncFenceError",
  {},
) {}

const errors = () =>
  Schema.Union(TranscriptSyncConnectionNotFound, TranscriptSyncFenceError);
const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);
const Cursor = Schema.NullOr(Schema.String);

export const syncTranscriptPage = FunctionSpec.internalAction({
  name: "syncTranscriptPage",
  args: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      expectedGeneration: NonNegativeInteger,
    }),
  returns: () =>
    Schema.Union(
      Schema.Struct({ kind: Schema.Literal("committed"), nextCursor: Cursor }),
      Schema.Struct({
        kind: Schema.Literal("failed"),
        errorTag: ConnectorSyncErrorTag,
      }),
    ),
});

export const claimTranscriptSyncPage = FunctionSpec.internalMutation({
  name: "claimTranscriptSyncPage",
  args: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      expectedGeneration: NonNegativeInteger,
      leaseId: Schema.String,
      now: NonNegativeInteger,
    }),
  returns: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      connectionKey: Schema.String,
      connectionGeneration: NonNegativeInteger,
      provider: TranscriptProvider,
      providerConfigKey: Schema.String,
      nangoConnectionId: Schema.String,
      cursor: Cursor,
      leaseId: Schema.String,
    }),
  error: () => errors(),
});

export const commitTranscriptSyncPage = FunctionSpec.internalMutation({
  name: "commitTranscriptSyncPage",
  args: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      expectedGeneration: NonNegativeInteger,
      expectedCursor: Cursor,
      leaseId: Schema.String,
      nextCursor: Cursor,
      discovered: NonNegativeInteger,
      ingested: NonNegativeInteger,
      duplicates: NonNegativeInteger,
      now: NonNegativeInteger,
    }),
  returns: () => ConnectorSyncStateRow,
  error: () => errors(),
});

export const failTranscriptSyncPage = FunctionSpec.internalMutation({
  name: "failTranscriptSyncPage",
  args: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      expectedGeneration: NonNegativeInteger,
      expectedCursor: Cursor,
      leaseId: Schema.String,
      errorTag: ConnectorSyncErrorTag,
      retryAfterMs: Schema.NullOr(NonNegativeInteger),
      now: NonNegativeInteger,
    }),
  returns: () => ConnectorSyncStateRow,
  error: () => errors(),
});

export const listTranscriptConnectionHealth = FunctionSpec.publicQuery({
  name: "listTranscriptConnectionHealth",
  args: () => Schema.Struct({}),
  returns: () =>
    Schema.Array(
      Schema.Struct({
        provider: TranscriptProvider,
        connectionKey: Schema.String,
        state: Schema.Literal(
          "authorizing",
          "syncing",
          "ready",
          "error",
          "reauthorizing",
          "revoked",
        ),
        lastSuccessAt: Schema.NullOr(NonNegativeInteger),
        cursorPresent: Schema.Boolean,
        callsDiscovered: NonNegativeInteger,
        callsIngested: NonNegativeInteger,
        callsRouted: NonNegativeInteger,
        callsAwaitingRouting: NonNegativeInteger,
        backfillComplete: Schema.Boolean,
        cleanupPending: Schema.Boolean,
        disconnectAvailable: Schema.Boolean,
        purgeRequested: Schema.Boolean,
        lastErrorTag: Schema.NullOr(ConnectorSyncErrorTag),
      }),
    ),
  error: () => Schema.Union(Unauthorized, Forbidden),
});

export default GroupSpec.make()
  .addFunction(claimTranscriptSyncPage)
  .addFunction(commitTranscriptSyncPage)
  .addFunction(failTranscriptSyncPage)
  .addFunction(listTranscriptConnectionHealth);
