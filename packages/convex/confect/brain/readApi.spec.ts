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

const BrainKey = Schema.String;
const BrainSelector = Schema.Struct({ brainKey: BrainKey });
const Errors = Schema.Union(
  Unauthorized,
  Forbidden,
  BrainNotFound,
  LifecycleRevoked,
  PageNotFound,
  ValidationFailed,
  SubsystemDisabled,
);
const SearchArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({ query: Schema.String }),
);
const SearchResult = Schema.Struct({
  sourceKey: Schema.String,
  sourceRevisionKey: Schema.optional(Schema.String),
  citationKey: Schema.String,
  title: Schema.String,
  excerpt: Schema.String,
  locator: Schema.optional(Schema.String),
  citationLabel: Schema.optional(Schema.String),
  permalink: Schema.optional(Schema.String),
  freshness: Schema.optional(Schema.Literal("fresh")),
  state: Schema.optional(Schema.Literal("resolved")),
});
const SearchReturns = Schema.Struct({
  brainKey: BrainKey,
  results: Schema.Array(SearchResult),
});
const SourceGetArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({ sourceRevisionKey: Schema.String }),
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
    pageKeys: Schema.optional(Schema.Array(PageKey)),
    maxBytes: Schema.optional(Schema.Number),
  }),
);
const ContextReturns = Schema.Struct({
  brainKey: BrainKey,
  asOf: Schema.Number,
  freshness: Schema.Struct({ status: Schema.Literal("current") }),
  entries: Schema.Array(SearchResult),
});
const AskArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({
    question: Schema.String,
    maxCitations: Schema.optional(Schema.Number),
  }),
);
const AskReturns = Schema.Unknown;

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

const functions = [sourcesSearch, sourcesGet, contextGet, answersAsk] as const;
export const manifest = collectContractManifest(functions);
export const schemaRegistry = collectContractSchemas(functions);
export default GroupSpec.make()
  .addFunction(sourcesSearch.spec)
  .addFunction(sourcesGet.spec)
  .addFunction(contextGet.spec)
  .addFunction(answersAsk.spec);
