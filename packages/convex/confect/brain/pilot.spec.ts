import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Forbidden, Unauthorized, ValidationFailed } from "../errors";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import {
  BrainNotFound,
  LifecycleRevoked,
  PageNotFound,
  StaleRevision,
} from "./pageTree";
import { PageKey, RevisionKey, SiblingSlug, SortKey } from "./pageSchemas";

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
const ReviewQueueItem = Schema.Struct({
  sourceKey: SourceKey,
  title: Schema.String,
  submittedAt: Schema.Number,
  status: SourceStatus,
  route: Schema.NullOr(Schema.Literal("direct", "classify", "capture-only")),
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
  sourceRevisionKey: Schema.optional(RevisionKey),
  locator: Schema.optional(Schema.String),
  permalink: Schema.optional(Schema.String),
  freshness: Schema.optional(Schema.Literal("fresh", "stale")),
  state: Schema.optional(
    Schema.Literal("resolved", "redacted", "legacy_unresolved"),
  ),
});
const SearchReturns = Schema.Struct({
  brainKey: BrainKey,
  results: Schema.Array(SearchResult),
});
const ReviewQueueReturns = Schema.Struct({
  brainKey: BrainKey,
  items: Schema.Array(ReviewQueueItem),
});
export const AskEvidence = Schema.Struct({
  citationKey: Schema.String,
  pageKey: PageKey,
  revisionKey: RevisionKey,
  title: Schema.String,
  excerpt: Schema.String,
});
export const AskResponse = Schema.Union(
  Schema.Struct({
    status: Schema.Literal("answered"),
    answer: Schema.String,
    evidence: Schema.Array(AskEvidence),
  }),
  Schema.Struct({
    status: Schema.Literal("abstained"),
    reason: Schema.Literal("insufficient_evidence"),
    answer: Schema.Null,
    evidence: Schema.Array(AskEvidence),
  }),
);
export const AskReturns = Schema.Struct({
  brainKey: BrainKey,
  response: AskResponse,
});
const PageSummary = Schema.Struct({
  pageKey: PageKey,
  parentPageKey: Schema.NullOr(PageKey),
  siblingSlug: SiblingSlug,
  sortKey: SortKey,
  title: Schema.String,
  favorite: Schema.Boolean,
  status: Schema.Literal("active", "archived", "redacted", "purged"),
  currentRevisionKey: Schema.NullOr(RevisionKey),
  lifecycleGeneration: Schema.Number,
});
const UpdatePageArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({
    pageKey: PageKey,
    expectedCurrentRevisionKey: RevisionKey,
    markdown: Schema.String,
  }),
);
const PilotWriteError = Schema.Union(
  Unauthorized,
  Forbidden,
  BrainNotFound,
  LifecycleRevoked,
  PageNotFound,
  StaleRevision,
  ValidationFailed,
);

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

const listReviewQueue = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "listReviewQueue",
    args: () => BrainSelector,
    returns: () => ReviewQueueReturns,
    error: () => PilotError,
  }),
  {
    namespace: "brain.pilot",
    name: "listReviewQueue",
    operationId: "brain.pilot.listReviewQueue",
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
    argsSchemaName: "brain.pilot.listReviewQueue.args",
    returnsSchemaName: "brain.pilot.listReviewQueue.returns",
    argsSchema: BrainSelector,
    returnsSchema: ReviewQueueReturns,
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

const ask = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "ask",
    args: () => SearchArgs,
    returns: () => AskReturns,
    error: () => PilotError,
  }),
  {
    namespace: "brain.pilot",
    name: "ask",
    operationId: "brain.pilot.ask",
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
    argsSchemaName: "brain.pilot.ask.args",
    returnsSchemaName: "brain.pilot.ask.returns",
    argsSchema: SearchArgs,
    returnsSchema: AskReturns,
  },
);

const updatePage = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "updatePage",
    args: () => UpdatePageArgs,
    returns: () => PageSummary,
    error: () => PilotWriteError,
  }),
  {
    namespace: "brain.pilot",
    name: "updatePage",
    operationId: "brain.pilot.updatePage",
    kind: "mutation",
    surfaces: ["web"],
    typedErrors: [
      "Unauthorized",
      "Forbidden",
      "BrainNotFound",
      "LifecycleRevoked",
      "PageNotFound",
      "StaleRevision",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "brain.pilot.updatePage.args",
    returnsSchemaName: "brain.pilot.updatePage.returns",
    argsSchema: UpdatePageArgs,
    returnsSchema: PageSummary,
  },
);

const contractFunctions = [
  submitNote,
  reviewNote,
  listReviewQueue,
  search,
  ask,
  updatePage,
] as const;

export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(submitNote.spec)
  .addFunction(reviewNote.spec)
  .addFunction(listReviewQueue.spec)
  .addFunction(search.spec)
  .addFunction(ask.spec)
  .addFunction(updatePage.spec);
