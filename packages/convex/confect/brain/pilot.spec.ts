import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
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
const SourceKey = Schema.String.pipe(
  Schema.pattern(/^(?:src|sunit)_[a-f0-9]{64}$/),
);
const SourceRevisionKey = Schema.Union(
  RevisionKey,
  Schema.String.pipe(Schema.pattern(/^surev_[a-f0-9]{64}$/)),
);
const BrainSelector = Schema.Struct({ brainKey: BrainKey });
const SourceStatus = Schema.Literal("pending_review", "published", "rejected");
export const SourceSummary = Schema.Struct({
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
export const SubmitNoteArgs = Schema.extend(
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
  sourceRevisionKey: Schema.optional(SourceRevisionKey),
  locator: Schema.optional(Schema.String),
  citationLabel: Schema.optional(Schema.String),
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

const pilotTypedErrors = [
  "Unauthorized",
  "Forbidden",
  "BrainNotFound",
  "LifecycleRevoked",
  "ValidationFailed",
] as const;

const pilotContract = <Spec>(
  spec: Spec,
  input: {
    readonly name: string;
    readonly kind: "query" | "mutation";
    readonly idempotent: boolean;
    readonly argsSchema: Schema.Schema.Any;
    readonly returnsSchema: Schema.Schema.Any;
    readonly typedErrors?: readonly string[];
  },
) =>
  defineContractFunction(spec, {
    namespace: "brain.pilot",
    name: input.name,
    operationId: `brain.pilot.${input.name}`,
    kind: input.kind,
    surfaces: ["web"],
    typedErrors: input.typedErrors ?? pilotTypedErrors,
    idempotent: input.idempotent,
    argsSchemaName: `brain.pilot.${input.name}.args`,
    returnsSchemaName: `brain.pilot.${input.name}.returns`,
    argsSchema: input.argsSchema,
    returnsSchema: input.returnsSchema,
  });

const submitNote = pilotContract(
  FunctionSpec.publicMutation({
    name: "submitNote",
    args: () => SubmitNoteArgs,
    returns: () => SourceSummary,
    error: () => PilotError,
  }),
  {
    name: "submitNote",
    kind: "mutation",
    idempotent: false,
    argsSchema: SubmitNoteArgs,
    returnsSchema: SourceSummary,
  },
);

export const headlessSubmitNote = FunctionSpec.internalMutation({
  name: "headlessSubmitNote",
  args: () =>
    Schema.extend(
      SubmitNoteArgs,
      Schema.Struct({
        organizationId: Id("organizations"),
        workspaceId: Id("workspaces"),
        idempotencyKey: Schema.String,
      }),
    ),
  returns: () => SourceSummary,
  error: () => PilotError,
});

const reviewNote = pilotContract(
  FunctionSpec.publicMutation({
    name: "reviewNote",
    args: () => ReviewNoteArgs,
    returns: () => SourceSummary,
    error: () => PilotError,
  }),
  {
    name: "reviewNote",
    kind: "mutation",
    idempotent: false,
    argsSchema: ReviewNoteArgs,
    returnsSchema: SourceSummary,
  },
);

const listReviewQueue = pilotContract(
  FunctionSpec.publicQuery({
    name: "listReviewQueue",
    args: () => BrainSelector,
    returns: () => ReviewQueueReturns,
    error: () => PilotError,
  }),
  {
    name: "listReviewQueue",
    kind: "query",
    idempotent: true,
    argsSchema: BrainSelector,
    returnsSchema: ReviewQueueReturns,
  },
);

const search = pilotContract(
  FunctionSpec.publicQuery({
    name: "search",
    args: () => SearchArgs,
    returns: () => SearchReturns,
    error: () => PilotError,
  }),
  {
    name: "search",
    kind: "query",
    idempotent: true,
    argsSchema: SearchArgs,
    returnsSchema: SearchReturns,
  },
);

const ask = pilotContract(
  FunctionSpec.publicQuery({
    name: "ask",
    args: () => SearchArgs,
    returns: () => AskReturns,
    error: () => PilotError,
  }),
  {
    name: "ask",
    kind: "query",
    idempotent: true,
    argsSchema: SearchArgs,
    returnsSchema: AskReturns,
  },
);

const updatePage = pilotContract(
  FunctionSpec.publicMutation({
    name: "updatePage",
    args: () => UpdatePageArgs,
    returns: () => PageSummary,
    error: () => PilotWriteError,
  }),
  {
    name: "updatePage",
    kind: "mutation",
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
  .addFunction(headlessSubmitNote)
  .addFunction(reviewNote.spec)
  .addFunction(listReviewQueue.spec)
  .addFunction(search.spec)
  .addFunction(ask.spec)
  .addFunction(updatePage.spec);
