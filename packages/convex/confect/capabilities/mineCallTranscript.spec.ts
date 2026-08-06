import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Unauthorized, ValidationFailed } from "../errors";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "./_kit/capability";
import { SystemPrincipal } from "./_kit/principal";
import { GatherMaintenanceContext } from "./gatherMaintenanceContext.spec";
import { MinedCall } from "./mineCallTranscript.domain";

export class TranscriptMiningFailed extends Schema.TaggedError<TranscriptMiningFailed>()(
  "TranscriptMiningFailed",
  { reason: Schema.Literal("policy", "provider", "output") },
) {}

const ModelReceipt = Schema.Struct({
  attemptKey: Schema.String,
  organizationId: Schema.String,
  workspaceSlug: Schema.String,
  provider: Schema.Literal("openrouter"),
  mode: Schema.Literal("fake", "test", "live"),
  model: Schema.String,
  region: Schema.Literal("us", "eu", "local"),
  state: Schema.Literal(
    "queued",
    "running",
    "succeeded",
    "retryable_failure",
    "permanent_failure",
    "cancelled",
  ),
  trustedInstructionVersion: Schema.String,
  toolSchemaVersion: Schema.String,
  schemaGeneration: Schema.Number,
  policyGeneration: Schema.Number,
  lifecycleGeneration: Schema.Number,
  redactionState: Schema.Literal("none", "redacted"),
  requestHash: Schema.String,
  responseHash: Schema.String,
  sourceHash: Schema.String,
  latencyMs: Schema.Number,
  usage: Schema.Struct({
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
    costCents: Schema.Number,
  }),
  generatedAt: Schema.String,
});

export const mineCallTranscriptArgs = Schema.Struct({
  context: GatherMaintenanceContext,
  attemptKey: Schema.String,
  caller: SystemPrincipal,
});
export const mineCallTranscriptReturns = Schema.Struct({
  output: MinedCall,
  receipt: ModelReceipt,
});
const errors = Schema.Union(
  Unauthorized,
  ValidationFailed,
  TranscriptMiningFailed,
);

export const mineCallTranscript = defineContractFunction(
  FunctionSpec.internalAction({
    name: "mineCallTranscript",
    args: () => mineCallTranscriptArgs,
    returns: () => mineCallTranscriptReturns,
    error: () => errors,
  }),
  {
    namespace: "capabilities.mineCallTranscript",
    name: "mineCallTranscript",
    operationId: "capabilities.mineCallTranscript.mineCallTranscript",
    kind: "action",
    surfaces: ["workflow", "internal"],
    typedErrors: ["Unauthorized", "ValidationFailed", "TranscriptMiningFailed"],
    idempotent: true,
    argsSchemaName: "mineCallTranscriptArgs",
    returnsSchemaName: "mineCallTranscriptReturns",
    argsSchema: mineCallTranscriptArgs,
    returnsSchema: mineCallTranscriptReturns,
  },
);

const functions = [mineCallTranscript] as const;
export const manifest = collectContractManifest(functions);
export const schemaRegistry = collectContractSchemas(functions);

export default GroupSpec.make().addFunction(mineCallTranscript.spec);
