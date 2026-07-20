import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "./_kit/capability";
import { SystemPrincipal } from "./_kit/principal";
import { Unauthorized } from "../errors";

const Message = Schema.Struct({
  sourceRevisionKey: Schema.String,
  authorLabel: Schema.String,
  providerTimestamp: Schema.String,
  canonicalText: Schema.String,
});
const Target = Schema.Struct({
  brainKey: Schema.String,
  displayName: Schema.String,
  routingDescription: Schema.optional(Schema.String),
});
const EvidenceQuote = Schema.Struct({
  sourceRevisionKey: Schema.String,
  quote: Schema.String,
});

export const classifySourceUnitArgs = Schema.Struct({
  request: Schema.Struct({
    sourceUnitRevisionKey: Schema.String,
    sourceUnitHash: Schema.String,
    messages: Schema.Array(Message),
    policyVersion: Schema.Number,
    allowedTargets: Schema.Array(Target),
  }),
  caller: SystemPrincipal,
});

export const classifySourceUnitReturns = Schema.Struct({
  sourceUnitRevisionKey: Schema.String,
  sourceUnitHash: Schema.String,
  contentScope: Schema.Literal("single_target", "mixed_client", "no_target"),
  targetBrainKey: Schema.NullOr(Schema.String),
  confidence: Schema.Number,
  rationale: Schema.String,
  evidenceQuotes: Schema.Array(EvidenceQuote),
});

const classificationErrors = Schema.Union(
  Unauthorized,
  Schema.TaggedStruct("MalformedModelOutput", { message: Schema.String }),
  Schema.TaggedStruct("TargetNotAllowed", { targetBrainKey: Schema.String }),
  Schema.TaggedStruct("EvidenceMismatch", {}),
  Schema.TaggedStruct("ReviewForbidden", {}),
  Schema.TaggedStruct("StaleGeneration", {}),
  Schema.TaggedStruct("DuplicateEffect", { effectKey: Schema.String }),
);

export const classifySourceUnit = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "classifySourceUnit",
    args: () => classifySourceUnitArgs,
    returns: () => classifySourceUnitReturns,
    error: () => classificationErrors,
  }),
  {
    namespace: "capabilities.classifySourceUnit",
    name: "classifySourceUnit",
    operationId: "capabilities.classifySourceUnit.classifySourceUnit",
    kind: "mutation",
    surfaces: ["workflow", "internal"],
    typedErrors: [
      "Unauthorized",
      "MalformedModelOutput",
      "TargetNotAllowed",
      "EvidenceMismatch",
      "ReviewForbidden",
      "StaleGeneration",
      "DuplicateEffect",
    ],
    idempotent: true,
    argsSchemaName: "classifySourceUnitArgs",
    returnsSchemaName: "classifySourceUnitReturns",
    argsSchema: classifySourceUnitArgs,
    returnsSchema: classifySourceUnitReturns,
  },
);

export const manifest = collectContractManifest([classifySourceUnit]);
export const schemaRegistry = collectContractSchemas([classifySourceUnit]);

export default GroupSpec.make().addFunction(classifySourceUnit.spec);
