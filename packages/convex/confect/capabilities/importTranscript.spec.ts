import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Forbidden, NotFound, Unauthorized, ValidationFailed } from "../errors";
import { BrainNotFound, LifecycleRevoked } from "../brain/pageTree";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "./_kit/capability";
import {
  ConnectionRevoked,
  DuplicateKeyConflict,
  TenantMismatch,
} from "./ingestSourceUnit.spec";
import { StaleCallRoute } from "./routeCallToBrain.spec";

export const importTranscriptArgs = Schema.Struct({
  brainKey: Schema.String,
  format: Schema.Literal("json", "vtt", "srt", "txt", "markdown"),
  content: Schema.String,
  title: Schema.String,
  occurredAt: Schema.String,
  participantEmails: Schema.Array(Schema.String),
  targetBrainKey: Schema.optional(Schema.String),
});

export const importTranscriptReturns = Schema.Struct({
  outcome: Schema.Literal("inserted", "duplicate", "tombstone"),
  unitKey: Schema.String,
  unitRevisionKey: Schema.String,
  segmentCount: Schema.Number,
  routeOutcome: Schema.NullOr(
    Schema.Literal("routed", "awaiting_review", "mixed_client", "no_match"),
  ),
  brainKey: Schema.NullOr(Schema.String),
});

const errors = Schema.Union(
  Unauthorized,
  Forbidden,
  BrainNotFound,
  LifecycleRevoked,
  ValidationFailed,
  NotFound,
  TenantMismatch,
  ConnectionRevoked,
  DuplicateKeyConflict,
  StaleCallRoute,
);

export const importTranscript = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "importTranscript",
    args: () => importTranscriptArgs,
    returns: () => importTranscriptReturns,
    error: () => errors,
  }),
  {
    namespace: "capabilities.importTranscript",
    name: "importTranscript",
    operationId: "capabilities.importTranscript.importTranscript",
    kind: "mutation",
    surfaces: ["web"],
    typedErrors: [
      "Unauthorized",
      "Forbidden",
      "BrainNotFound",
      "LifecycleRevoked",
      "ValidationFailed",
      "NotFound",
      "TenantMismatch",
      "ConnectionRevoked",
      "DuplicateKeyConflict",
      "StaleCallRoute",
    ],
    idempotent: true,
    argsSchemaName: "importTranscriptArgs",
    returnsSchemaName: "importTranscriptReturns",
    argsSchema: importTranscriptArgs,
    returnsSchema: importTranscriptReturns,
  },
);

export const manifest = collectContractManifest([importTranscript]);
export const schemaRegistry = collectContractSchemas([importTranscript]);
export default GroupSpec.make().addFunction(importTranscript.spec);
