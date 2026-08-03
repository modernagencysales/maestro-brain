import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Forbidden, Unauthorized, ValidationFailed } from "../errors";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import { BrainNotFound, LifecycleRevoked } from "./pageTree";

const BrainKey = Schema.String.pipe(
  Schema.pattern(/^br_[0-9A-HJKMNP-TV-Z]{26}$/),
);
const SourceKey = Schema.String.pipe(Schema.pattern(/^src_[a-f0-9]{64}$/));
const BrainSelector = Schema.Struct({ brainKey: BrainKey });
const SourceStatus = Schema.Literal("pending_review", "published", "rejected");
const SourceSummary = Schema.Struct({
  sourceKey: SourceKey,
  status: SourceStatus,
});

const PilotError = Schema.Union(
  Unauthorized,
  Forbidden,
  BrainNotFound,
  LifecycleRevoked,
  ValidationFailed,
);
const SubmitNoteArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({ title: Schema.String, markdown: Schema.String }),
);
const ReviewNoteArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({
    sourceKey: SourceKey,
    decision: Schema.Literal("approve", "reject"),
  }),
);
const SearchArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({ query: Schema.String }),
);
const SearchResult = Schema.Struct({
  sourceKey: SourceKey,
  citationKey: Schema.String,
  title: Schema.String,
  excerpt: Schema.String,
});
const SearchReturns = Schema.Struct({
  brainKey: BrainKey,
  results: Schema.Array(SearchResult),
});

const submitNote = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "submitNote",
    args: () => SubmitNoteArgs,
    returns: () => SourceSummary,
    error: () => PilotError,
  }),
  {
    namespace: "brain.pilot",
    name: "submitNote",
    operationId: "brain.pilot.submitNote",
    kind: "mutation",
    surfaces: ["web"],
    typedErrors: [
      "Unauthorized",
      "Forbidden",
      "BrainNotFound",
      "LifecycleRevoked",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "brain.pilot.submitNote.args",
    returnsSchemaName: "brain.pilot.submitNote.returns",
    argsSchema: SubmitNoteArgs,
    returnsSchema: SourceSummary,
  },
);

const reviewNote = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "reviewNote",
    args: () => ReviewNoteArgs,
    returns: () => SourceSummary,
    error: () => PilotError,
  }),
  {
    namespace: "brain.pilot",
    name: "reviewNote",
    operationId: "brain.pilot.reviewNote",
    kind: "mutation",
    surfaces: ["web"],
    typedErrors: [
      "Unauthorized",
      "Forbidden",
      "BrainNotFound",
      "LifecycleRevoked",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "brain.pilot.reviewNote.args",
    returnsSchemaName: "brain.pilot.reviewNote.returns",
    argsSchema: ReviewNoteArgs,
    returnsSchema: SourceSummary,
  },
);

const search = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "search",
    args: () => SearchArgs,
    returns: () => SearchReturns,
    error: () => PilotError,
  }),
  {
    namespace: "brain.pilot",
    name: "search",
    operationId: "brain.pilot.search",
    kind: "query",
    surfaces: ["web"],
    typedErrors: [
      "Unauthorized",
      "Forbidden",
      "BrainNotFound",
      "LifecycleRevoked",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "brain.pilot.search.args",
    returnsSchemaName: "brain.pilot.search.returns",
    argsSchema: SearchArgs,
    returnsSchema: SearchReturns,
  },
);

const contractFunctions = [submitNote, reviewNote, search] as const;

export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(submitNote.spec)
  .addFunction(reviewNote.spec)
  .addFunction(search.spec);
