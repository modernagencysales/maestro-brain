import { FunctionSpec, GroupSpec } from "@confect/core";
import { CanonicalCallTranscript } from "@maestro-template/integrations/transcripts/canonical";
import * as Schema from "effect/Schema";

import { Unauthorized, ValidationFailed } from "../errors";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "./_kit/capability";
import { SystemPrincipal } from "./_kit/principal";

export class TenantMismatch extends Schema.TaggedError<TenantMismatch>()(
  "TenantMismatch",
  { connectionKey: Schema.String },
) {}
export class ConnectionRevoked extends Schema.TaggedError<ConnectionRevoked>()(
  "ConnectionRevoked",
  { connectionKey: Schema.String },
) {}
export class DuplicateKeyConflict extends Schema.TaggedError<DuplicateKeyConflict>()(
  "DuplicateKeyConflict",
  { key: Schema.String },
) {}
export class RevisionOrderConflict extends Schema.TaggedError<RevisionOrderConflict>()(
  "RevisionOrderConflict",
  {
    unitKey: Schema.String,
    reason: Schema.Literal(
      "equal_order",
      "incompatible_order",
      "missing_current_order",
    ),
  },
) {}

export const IngestSourceAuthority = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("provider"),
    organizationKey: Schema.String,
    connectionKey: Schema.String,
    connectionGeneration: Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThan(0),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("manual_import"),
    organizationKey: Schema.String,
    actorId: Schema.String.pipe(Schema.minLength(1)),
  }),
);

export const ingestSourceUnitArgs = Schema.Struct({
  input: CanonicalCallTranscript,
  authority: IngestSourceAuthority,
  caller: SystemPrincipal,
  receivedAt: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
});
export const ingestSourceUnitReturns = Schema.Struct({
  outcome: Schema.Literal("inserted", "duplicate", "stale", "tombstone"),
  unitKey: Schema.String,
  unitRevisionKey: Schema.String,
  segmentCount: Schema.Number,
});
const ingestSourceUnitErrors = Schema.Union(
  Unauthorized,
  TenantMismatch,
  ConnectionRevoked,
  DuplicateKeyConflict,
  RevisionOrderConflict,
  ValidationFailed,
);

export const ingestSourceUnit = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "ingestSourceUnit",
    args: () => ingestSourceUnitArgs,
    returns: () => ingestSourceUnitReturns,
    error: () => ingestSourceUnitErrors,
  }),
  {
    namespace: "capabilities.ingestSourceUnit",
    name: "ingestSourceUnit",
    operationId: "capabilities.ingestSourceUnit.ingestSourceUnit",
    kind: "mutation",
    surfaces: ["workflow", "internal"],
    typedErrors: [
      "Unauthorized",
      "TenantMismatch",
      "ConnectionRevoked",
      "DuplicateKeyConflict",
      "RevisionOrderConflict",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "ingestSourceUnitArgs",
    returnsSchemaName: "ingestSourceUnitReturns",
    argsSchema: ingestSourceUnitArgs,
    returnsSchema: ingestSourceUnitReturns,
  },
);

export const manifest = collectContractManifest([ingestSourceUnit]);
export const schemaRegistry = collectContractSchemas([ingestSourceUnit]);
export default GroupSpec.make().addFunction(ingestSourceUnit.spec);
