import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "./_kit/capability";
import { SystemPrincipal } from "./_kit/principal";
import { Unauthorized } from "../errors";

export const ClassificationMessage = Schema.Struct({
  sourceRevisionKey: Schema.String,
  authorLabel: Schema.String,
  providerTimestamp: Schema.String,
  canonicalText: Schema.String,
});
export const ClassificationTarget = Schema.Struct({
  workspaceId: Schema.String,
  organizationId: Schema.String,
  brainKey: Schema.String,
  displayName: Schema.String,
  routingDescription: Schema.optional(Schema.String),
});
const EvidenceQuote = Schema.Struct({
  sourceRevisionKey: Schema.String,
  quote: Schema.String,
});

export const ClassificationAuthority = Schema.Struct({
  workspaceId: Schema.String,
  organizationId: Schema.String,
  policyVersion: Schema.Number,
  lifecycleGeneration: Schema.Number,
  routeGeneration: Schema.Number,
  leaseGeneration: Schema.Number,
});

export const SourceUnitForClassification = Schema.Struct({
  workspaceId: Schema.String,
  organizationId: Schema.String,
  sourceUnitRevisionKey: Schema.String,
  sourceUnitHash: Schema.String,
  messages: Schema.Array(ClassificationMessage),
  policyVersion: Schema.Number,
  lifecycleGeneration: Schema.Number,
  routeGeneration: Schema.Number,
  leaseGeneration: Schema.Number,
});

export const ClassificationRequest = Schema.extend(
  SourceUnitForClassification,
  Schema.Struct({
    allowedTargets: Schema.Array(ClassificationTarget),
    authority: ClassificationAuthority,
  }),
);

export const classifySourceUnitArgs = Schema.Struct({
  request: ClassificationRequest,
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
);

const commitErrors = Schema.Union(
  classificationErrors,
  Schema.TaggedStruct("ReviewForbidden", {}),
  Schema.TaggedStruct("StaleGeneration", {}),
  Schema.TaggedStruct("DuplicateEffect", { effectKey: Schema.String }),
);
export const commitSourceRouteArgs = Schema.Struct({
  workspaceId: Schema.String,
  idempotencyKey: Schema.String,
  request: ClassificationRequest,
  output: classifySourceUnitReturns,
  review: Schema.Any,
  currentAuthority: Schema.Any,
  caller: SystemPrincipal,
});
export const commitSourceRouteReturns = Schema.Any;

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
    ],
    idempotent: true,
    argsSchemaName: "classifySourceUnitArgs",
    returnsSchemaName: "classifySourceUnitReturns",
    argsSchema: classifySourceUnitArgs,
    returnsSchema: classifySourceUnitReturns,
  },
);

export const commitSourceRoute = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "commitSourceRoute",
    args: () => commitSourceRouteArgs,
    returns: () => commitSourceRouteReturns,
    error: () => commitErrors,
  }),
  {
    namespace: "capabilities.classifySourceUnit",
    name: "commitSourceRoute",
    operationId: "capabilities.classifySourceUnit.commitSourceRoute",
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
    argsSchemaName: "commitSourceRouteArgs",
    returnsSchemaName: "commitSourceRouteReturns",
    argsSchema: commitSourceRouteArgs,
    returnsSchema: commitSourceRouteReturns,
  },
);

export const manifest = collectContractManifest([
  classifySourceUnit,
  commitSourceRoute,
]);
export const schemaRegistry = collectContractSchemas([
  classifySourceUnit,
  commitSourceRoute,
]);

export default GroupSpec.make()
  .addFunction(classifySourceUnit.spec)
  .addFunction(commitSourceRoute.spec);
