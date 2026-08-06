import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { NotFound, Unauthorized, ValidationFailed } from "../errors";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "./_kit/capability";
import { SystemPrincipal } from "./_kit/principal";

export class StaleCallRoute extends Schema.TaggedError<StaleCallRoute>()(
  "StaleCallRoute",
  { unitRevisionKey: Schema.String },
) {}

export const routeCallToBrainArgs = Schema.Struct({
  organizationKey: Schema.String,
  unitRevisionKey: Schema.String,
  explicitBrainKey: Schema.optional(Schema.String),
  recurringMeetingId: Schema.optional(Schema.String),
  agencyDomains: Schema.Array(Schema.String),
  caller: SystemPrincipal,
  routedAt: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
});
export const routeCallToBrainReturns = Schema.Struct({
  outcome: Schema.Literal(
    "routed",
    "awaiting_review",
    "mixed_client",
    "no_match",
  ),
  proposalKey: Schema.String,
  unitKey: Schema.String,
  unitRevisionKey: Schema.String,
  brainKey: Schema.NullOr(Schema.String),
  candidateBrainKeys: Schema.Array(Schema.String),
  reason: Schema.String,
  routeGeneration: Schema.Number,
});
const errors = Schema.Union(
  Unauthorized,
  NotFound,
  ValidationFailed,
  StaleCallRoute,
);

export const routeCallToBrain = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "routeCallToBrain",
    args: () => routeCallToBrainArgs,
    returns: () => routeCallToBrainReturns,
    error: () => errors,
  }),
  {
    namespace: "capabilities.routeCallToBrain",
    name: "routeCallToBrain",
    operationId: "capabilities.routeCallToBrain.routeCallToBrain",
    kind: "mutation",
    surfaces: ["workflow", "internal"],
    typedErrors: [
      "Unauthorized",
      "NotFound",
      "ValidationFailed",
      "StaleCallRoute",
    ],
    idempotent: true,
    argsSchemaName: "routeCallToBrainArgs",
    returnsSchemaName: "routeCallToBrainReturns",
    argsSchema: routeCallToBrainArgs,
    returnsSchema: routeCallToBrainReturns,
  },
);

export const manifest = collectContractManifest([routeCallToBrain]);
export const schemaRegistry = collectContractSchemas([routeCallToBrain]);
export default GroupSpec.make().addFunction(routeCallToBrain.spec);
