import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Forbidden, Unauthorized, ValidationFailed } from "../errors";
import { SubsystemDisabled } from "../ops/brainOperations.spec";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import { BrainNotFound, LifecycleRevoked, PageNotFound } from "./pageTree";
import { PageKey } from "./pageSchemas";
import { Id } from "../_generated/id";

const BrainKey = Schema.String;
const BrainSelector = Schema.Struct({ brainKey: BrainKey });
const CompatibilityMode = Schema.Literal("legacy");
export class CitationIntegrityFailure extends Schema.TaggedError<CitationIntegrityFailure>()(
  "CitationIntegrityFailure",
  {
    publicationSetKey: Schema.String,
    entryKey: Schema.String,
    reason: Schema.Literal(
      "origin_missing",
      "origin_mismatch",
      "passage_missing",
      "content_mismatch",
      "unsupported_origin",
    ),
  },
) {}
export class RetrievalCapacityExceeded extends Schema.TaggedError<RetrievalCapacityExceeded>()(
  "RetrievalCapacityExceeded",
  {
    resource: Schema.Literal(
      "active_slack_policies",
      "active_provider_connections",
      "corpus_health",
      "current_postings",
      "unclassified_postings",
      "revision_entries",
    ),
    limit: Schema.Number,
    observedAtLeast: Schema.Number,
  },
) {}
const Errors = Schema.Union(
  Unauthorized,
  Forbidden,
  BrainNotFound,
  LifecycleRevoked,
  PageNotFound,
  ValidationFailed,
  SubsystemDisabled,
  CitationIntegrityFailure,
  RetrievalCapacityExceeded,
);
const SearchArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({
    query: Schema.String,
    compatibilityMode: Schema.optional(CompatibilityMode),
  }),
);
export const SearchResult = Schema.Struct({
  sourceKey: Schema.String,
  sourceRevisionKey: Schema.String,
  entryKey: Schema.String,
  publicationSetKey: Schema.String,
  passageKey: Schema.String,
  startOffset: Schema.Number,
  endOffset: Schema.Number,
  contentHash: Schema.String,
  kind: Schema.Literal("source", "page", "projection"),
  unitKey: Schema.optional(Schema.String),
  segmentKey: Schema.optional(Schema.String),
  citationKey: Schema.String,
  title: Schema.String,
  excerpt: Schema.String,
  locator: Schema.optional(Schema.String),
  citationLabel: Schema.optional(Schema.String),
  permalink: Schema.optional(Schema.String),
  authority: Schema.Literal("authoritative", "derived", "advisory"),
  authorityPolicyKey: Schema.String,
  sourceModifiedAt: Schema.optional(Schema.Number),
  observedAt: Schema.Number,
  indexedAt: Schema.Number,
  freshness: Schema.Literal("current", "stale", "unknown"),
  truncated: Schema.Boolean,
  state: Schema.Literal("resolved"),
});
const Coverage = Schema.Struct({
  sourceKind: Schema.String,
  status: Schema.Literal("complete", "partial", "unavailable", "unknown"),
  freshness: Schema.Literal("current", "stale", "unknown"),
  lastSuccessfulAt: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
});
const Omission = Schema.Struct({ reason: Schema.String, count: Schema.Number });
const SearchReturns = Schema.Struct({
  brainKey: BrainKey,
  results: Schema.Array(SearchResult),
  coverage: Schema.Array(Coverage),
  omissions: Schema.Array(Omission),
});
const SourceGetArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({
    sourceRevisionKey: Schema.optional(Schema.String),
    entryKey: Schema.optional(Schema.String),
    publicationSetKey: Schema.optional(Schema.String),
    compatibilityMode: Schema.optional(CompatibilityMode),
  }),
);
const SourceGetReturns = Schema.extend(
  SearchResult,
  Schema.Struct({
    brainKey: BrainKey,
    revisionKey: Schema.String,
    status: Schema.String,
  }),
);
const ContextGetArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({
    question: Schema.optional(Schema.String),
    pageKeys: Schema.optional(Schema.Array(PageKey)),
    maxBytes: Schema.optional(Schema.Number),
    compatibilityMode: Schema.optional(CompatibilityMode),
  }),
);
const ContextReturns = Schema.Struct({
  requestId: Schema.String,
  organizationKey: Schema.String,
  brainKey: BrainKey,
  question: Schema.String,
  asOf: Schema.Number,
  freshness: Schema.optional(
    Schema.Struct({ status: Schema.Literal("current", "stale", "unknown") }),
  ),
  coverage: Schema.Array(Coverage),
  entries: Schema.Array(SearchResult),
  omissions: Schema.Array(Omission),
  conflicts: Schema.Array(
    Schema.Struct({
      subject: Schema.String,
      revisionKeys: Schema.Array(Schema.String),
      reason: Schema.String,
    }),
  ),
});
const AskArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({
    question: Schema.String,
    maxCitations: Schema.optional(Schema.Number),
  }),
);
const AskReturns = Schema.Unknown;
const HeadlessSelector = Schema.Struct({
  organizationId: Id("organizations"),
  workspaceId: Id("workspaces"),
});

const query = <
  const Name extends string,
  Args extends Schema.Schema.AnyNoContext,
  Returns extends Schema.Schema.AnyNoContext,
>(
  name: Name,
  operationId: string,
  args: Args,
  returns: Returns,
) =>
  defineContractFunction(
    FunctionSpec.publicQuery({
      name,
      args: () => args,
      returns: () => returns,
      error: () => Errors,
    }),
    {
      namespace: "brain.readApi",
      name,
      operationId,
      kind: "query",
      surfaces: ["api", "mcp"],
      typedErrors: [
        "Unauthorized",
        "Forbidden",
        "BrainNotFound",
        "LifecycleRevoked",
        "PageNotFound",
        "ValidationFailed",
        "SubsystemDisabled",
        "CitationIntegrityFailure",
        "RetrievalCapacityExceeded",
      ],
      idempotent: true,
      argsSchemaName: `brain.readApi.${name}.args`,
      returnsSchemaName: `brain.readApi.${name}.returns`,
      argsSchema: args,
      returnsSchema: returns,
    },
  );

export const sourcesSearch = query(
  "sourcesSearch",
  "brain.sources.search",
  SearchArgs,
  SearchReturns,
);
export const sourcesGet = query(
  "sourcesGet",
  "brain.sources.get",
  SourceGetArgs,
  SourceGetReturns,
);
export const contextGet = query(
  "contextGet",
  "brain.context.get",
  ContextGetArgs,
  ContextReturns,
);
export const answersAsk = query(
  "answersAsk",
  "brain.answers.ask",
  AskArgs,
  AskReturns,
);

export const headlessSourcesSearch = FunctionSpec.internalQuery({
  name: "headlessSourcesSearch",
  args: () => Schema.extend(SearchArgs, HeadlessSelector),
  returns: () => SearchReturns,
  error: () => Errors,
});
export const headlessSourcesGet = FunctionSpec.internalQuery({
  name: "headlessSourcesGet",
  args: () => Schema.extend(SourceGetArgs, HeadlessSelector),
  returns: () => SourceGetReturns,
  error: () => Errors,
});
export const headlessContextGet = FunctionSpec.internalQuery({
  name: "headlessContextGet",
  args: () => Schema.extend(ContextGetArgs, HeadlessSelector),
  returns: () => ContextReturns,
  error: () => Errors,
});
export const headlessAnswersAsk = FunctionSpec.internalQuery({
  name: "headlessAnswersAsk",
  args: () => Schema.extend(AskArgs, HeadlessSelector),
  returns: () => AskReturns,
  error: () => Errors,
});
export const validationSourcesSearch = FunctionSpec.internalQuery({
  name: "validationSourcesSearch",
  args: () => Schema.extend(SearchArgs, HeadlessSelector),
  returns: () => SearchReturns,
  error: () => Errors,
});
export const validationSourcesGet = FunctionSpec.internalQuery({
  name: "validationSourcesGet",
  args: () => Schema.extend(SourceGetArgs, HeadlessSelector),
  returns: () => SourceGetReturns,
  error: () => Errors,
});
export const validationContextGet = FunctionSpec.internalQuery({
  name: "validationContextGet",
  args: () => Schema.extend(ContextGetArgs, HeadlessSelector),
  returns: () => ContextReturns,
  error: () => Errors,
});

const functions = [sourcesSearch, sourcesGet, contextGet, answersAsk] as const;
export const manifest = collectContractManifest(functions);
export const schemaRegistry = collectContractSchemas(functions);
export default GroupSpec.make()
  .addFunction(sourcesSearch.spec)
  .addFunction(sourcesGet.spec)
  .addFunction(contextGet.spec)
  .addFunction(answersAsk.spec)
  .addFunction(headlessSourcesSearch)
  .addFunction(headlessSourcesGet)
  .addFunction(headlessContextGet)
  .addFunction(headlessAnswersAsk)
  .addFunction(validationSourcesSearch)
  .addFunction(validationSourcesGet)
  .addFunction(validationContextGet);
