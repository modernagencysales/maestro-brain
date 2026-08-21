import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import { SystemPrincipal } from "../capabilities/_kit/principal";
import { Unauthorized, ValidationFailed } from "../errors";
import { PositiveInteger } from "./retrievalSchemas";

export class RetrievalOriginUnavailable extends Schema.TaggedError<RetrievalOriginUnavailable>()(
  "RetrievalOriginUnavailable",
  { sourceKey: Schema.String, revisionKey: Schema.String },
) {}

export class RetrievalPublicationConflict extends Schema.TaggedError<RetrievalPublicationConflict>()(
  "RetrievalPublicationConflict",
  { publicationSetKey: Schema.String },
) {}

export class RetrievalPublicationCapacityExceeded extends Schema.TaggedError<RetrievalPublicationCapacityExceeded>()(
  "RetrievalPublicationCapacityExceeded",
  { entryCount: Schema.Number, tokenCount: Schema.Number },
) {}

export const PublishPageRevisionArgs = Schema.Struct({
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  pageKey: Schema.String,
  revisionKey: Schema.String,
  authority: Schema.Literal("authoritative", "derived", "advisory"),
  authorityPolicyKey: Schema.String,
  policyGeneration: PositiveInteger,
  caller: SystemPrincipal,
  now: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
});

export const PublishPageRevisionReturns = Schema.Struct({
  outcome: Schema.Literal("published", "duplicate", "stale", "revoked"),
  publicationSetKey: Schema.optional(Schema.String),
  publicationGeneration: Schema.optional(PositiveInteger),
  entryCount: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  tokenCount: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
});

export const RebuildPageBatchArgs = Schema.Struct({
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  afterPageKey: Schema.optional(Schema.String),
  limit: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(1),
    Schema.lessThanOrEqualTo(5),
  ),
  caller: SystemPrincipal,
  now: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
});

export const RebuildPageBatchReturns = Schema.Struct({
  processed: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  published: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  nextAfterPageKey: Schema.optional(Schema.String),
  hasMore: Schema.Boolean,
});

const PublishRoutedRevisionArgs = Schema.Struct({
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  sourceRevisionKey: Schema.String,
  caller: SystemPrincipal,
  now: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
});

export const PublishSlackRevisionArgs = PublishRoutedRevisionArgs;
export const PublishTranscriptRevisionArgs = PublishRoutedRevisionArgs;

const Errors = Schema.Union(
  Unauthorized,
  ValidationFailed,
  RetrievalOriginUnavailable,
  RetrievalPublicationConflict,
  RetrievalPublicationCapacityExceeded,
);

export const publishPageRevision = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "publishPageRevision",
    args: () => PublishPageRevisionArgs,
    returns: () => PublishPageRevisionReturns,
    error: () => Errors,
  }),
  {
    namespace: "brain.retrievalPublication",
    name: "publishPageRevision",
    operationId: "brain.retrievalPublication.publishPageRevision",
    kind: "mutation",
    surfaces: ["workflow", "internal"],
    typedErrors: [
      "Unauthorized",
      "ValidationFailed",
      "RetrievalOriginUnavailable",
      "RetrievalPublicationConflict",
      "RetrievalPublicationCapacityExceeded",
    ],
    idempotent: true,
    argsSchemaName: "brain.retrievalPublication.publishPageRevision.args",
    returnsSchemaName: "brain.retrievalPublication.publishPageRevision.returns",
    argsSchema: PublishPageRevisionArgs,
    returnsSchema: PublishPageRevisionReturns,
  },
);

export const rebuildPageBatch = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "rebuildPageBatch",
    args: () => RebuildPageBatchArgs,
    returns: () => RebuildPageBatchReturns,
    error: () => Errors,
  }),
  {
    namespace: "brain.retrievalPublication",
    name: "rebuildPageBatch",
    operationId: "brain.retrievalPublication.rebuildPageBatch",
    kind: "mutation",
    surfaces: ["workflow", "internal"],
    typedErrors: [
      "Unauthorized",
      "ValidationFailed",
      "RetrievalOriginUnavailable",
      "RetrievalPublicationConflict",
      "RetrievalPublicationCapacityExceeded",
    ],
    idempotent: true,
    argsSchemaName: "brain.retrievalPublication.rebuildPageBatch.args",
    returnsSchemaName: "brain.retrievalPublication.rebuildPageBatch.returns",
    argsSchema: RebuildPageBatchArgs,
    returnsSchema: RebuildPageBatchReturns,
  },
);

export const publishSlackRevision = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "publishSlackRevision",
    args: () => PublishSlackRevisionArgs,
    returns: () => PublishPageRevisionReturns,
    error: () => Errors,
  }),
  {
    namespace: "brain.retrievalPublication",
    name: "publishSlackRevision",
    operationId: "brain.retrievalPublication.publishSlackRevision",
    kind: "mutation",
    surfaces: ["workflow", "internal"],
    typedErrors: [
      "Unauthorized",
      "ValidationFailed",
      "RetrievalOriginUnavailable",
      "RetrievalPublicationConflict",
      "RetrievalPublicationCapacityExceeded",
    ],
    idempotent: true,
    argsSchemaName: "brain.retrievalPublication.publishSlackRevision.args",
    returnsSchemaName:
      "brain.retrievalPublication.publishSlackRevision.returns",
    argsSchema: PublishSlackRevisionArgs,
    returnsSchema: PublishPageRevisionReturns,
  },
);

export const publishTranscriptRevision = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "publishTranscriptRevision",
    args: () => PublishTranscriptRevisionArgs,
    returns: () => PublishPageRevisionReturns,
    error: () => Errors,
  }),
  {
    namespace: "brain.retrievalPublication",
    name: "publishTranscriptRevision",
    operationId: "brain.retrievalPublication.publishTranscriptRevision",
    kind: "mutation",
    surfaces: ["workflow", "internal"],
    typedErrors: [
      "Unauthorized",
      "ValidationFailed",
      "RetrievalOriginUnavailable",
      "RetrievalPublicationConflict",
      "RetrievalPublicationCapacityExceeded",
    ],
    idempotent: true,
    argsSchemaName: "brain.retrievalPublication.publishTranscriptRevision.args",
    returnsSchemaName:
      "brain.retrievalPublication.publishTranscriptRevision.returns",
    argsSchema: PublishTranscriptRevisionArgs,
    returnsSchema: PublishPageRevisionReturns,
  },
);

export const manifest = collectContractManifest([
  publishPageRevision,
  rebuildPageBatch,
  publishSlackRevision,
  publishTranscriptRevision,
]);
export const schemaRegistry = collectContractSchemas([
  publishPageRevision,
  rebuildPageBatch,
  publishSlackRevision,
  publishTranscriptRevision,
]);

export default GroupSpec.make()
  .addFunction(publishPageRevision.spec)
  .addFunction(rebuildPageBatch.spec)
  .addFunction(publishSlackRevision.spec)
  .addFunction(publishTranscriptRevision.spec);
