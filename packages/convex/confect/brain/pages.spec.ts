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
  PageTreeConflict,
  StaleRevision,
} from "./pageTree";
import { PageKey, RevisionKey, SiblingSlug, SortKey } from "./pageSchemas";

const BrainKey = Schema.String.pipe(
  Schema.pattern(/^br_[0-9A-HJKMNP-TV-Z]{26}$/),
);
const BrainSelector = Schema.Struct({ brainKey: BrainKey });

const BrainPageReadError = Schema.Union(
  Unauthorized,
  Forbidden,
  BrainNotFound,
  PageNotFound,
  LifecycleRevoked,
  ValidationFailed,
);

const BrainPageWriteError = Schema.Union(
  BrainPageReadError,
  PageTreeConflict,
  StaleRevision,
);

// Contract check anchor: generated Confect tables expose brainPages.Doc to callers.
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

const PageDetail = Schema.Struct({
  page: PageSummary,
  markdown: Schema.String,
  editorSnapshotJson: Schema.optional(Schema.String),
  editorSnapshotVersion: Schema.optional(Schema.Number),
  updatedAt: Schema.Number,
});

const ListArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({ includeArchived: Schema.optional(Schema.Boolean) }),
);
const ListReturns = Schema.Struct({
  brainKey: BrainKey,
  asOf: Schema.Number,
  freshness: Schema.Struct({ status: Schema.Literal("current") }),
  pages: Schema.Array(PageSummary),
});
const GetArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({ pageKey: PageKey }),
);
const HistoryArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({
    pageKey: PageKey,
    cursor: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
  }),
);
const HistoryReturns = Schema.Struct({
  brainKey: BrainKey,
  pageKey: PageKey,
  asOf: Schema.Number,
  freshness: Schema.Struct({ status: Schema.Literal("current") }),
  revisions: Schema.Array(
    Schema.Struct({
      revisionKey: RevisionKey,
      priorRevisionKey: Schema.NullOr(RevisionKey),
      causation: Schema.String,
      createdAt: Schema.Number,
      lifecycleGeneration: Schema.Number,
    }),
  ),
});

const CreateArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({
    parentPageKey: Schema.NullOr(PageKey),
    siblingSlug: SiblingSlug,
    sortKey: SortKey,
    title: Schema.String,
    markdown: Schema.String,
    expectedCurrentRevisionKey: Schema.NullOr(RevisionKey),
  }),
);
const PageRevisionSelector = Schema.extend(
  BrainSelector,
  Schema.Struct({
    pageKey: PageKey,
    expectedCurrentRevisionKey: RevisionKey,
  }),
);
const RenameArgs = Schema.extend(
  PageRevisionSelector,
  Schema.Struct({ title: Schema.String }),
);
const MoveArgs = Schema.extend(
  PageRevisionSelector,
  Schema.Struct({
    parentPageKey: Schema.NullOr(PageKey),
    sortKey: SortKey,
  }),
);
const FavoriteArgs = Schema.extend(
  PageRevisionSelector,
  Schema.Struct({ favorite: Schema.Boolean }),
);
const ArchiveArgs = PageRevisionSelector;

export const RecordSnapshotArgs = Schema.Struct({
  brainKey: BrainKey,
  pageKey: PageKey,
  expectedCurrentRevisionKey: RevisionKey,
  snapshot: Schema.String,
  version: Schema.Number,
});

export const RecordSnapshotReturns = Schema.Struct({
  pageKey: PageKey,
  pageRevisionKey: RevisionKey,
  contentHash: Schema.String,
  savedAt: Schema.Number,
});

const pageReadErrors = [
  "Unauthorized",
  "Forbidden",
  "BrainNotFound",
  "PageNotFound",
  "LifecycleRevoked",
  "ValidationFailed",
] as const;
const pageWriteErrors = [
  ...pageReadErrors,
  "PageTreeConflict",
  "StaleRevision",
] as const;

const definePageQuery = <
  const Name extends string,
  Args extends Schema.Schema.AnyNoContext,
>(
  name: Name,
  args: Args,
  returns: Schema.Schema.AnyNoContext,
) =>
  defineContractFunction(
    FunctionSpec.publicQuery({
      name,
      args: () => args,
      returns: () => returns,
      error: () => BrainPageReadError,
    }),
    {
      namespace: "brain.pages",
      name,
      operationId: `brain.pages.${name}`,
      kind: "query",
      surfaces: ["web", "api", "mcp"],
      typedErrors: [...pageReadErrors],
      idempotent: true,
      argsSchemaName: `brain.pages.${name}.args`,
      returnsSchemaName: `brain.pages.${name}.returns`,
      argsSchema: args,
      returnsSchema: returns,
    },
  );

const definePageMutation = <
  const Name extends string,
  Args extends Schema.Schema.AnyNoContext,
>(
  name: Name,
  inputSchema: Args,
) =>
  defineContractFunction(
    FunctionSpec.publicMutation({
      name,
      args: () => inputSchema,
      returns: () => PageSummary,
      error: () => BrainPageWriteError,
    }),
    {
      namespace: "brain.pages",
      name,
      operationId: `brain.pages.${name}`,
      kind: "mutation",
      surfaces: ["web"],
      typedErrors: [...pageWriteErrors],
      idempotent: false,
      argsSchemaName: `brain.pages.${name}.args`,
      returnsSchemaName: `brain.pages.${name}.returns`,
      argsSchema: inputSchema,
      returnsSchema: PageSummary,
    },
  );

const list = definePageQuery("list", ListArgs, ListReturns);
const get = definePageQuery("get", GetArgs, PageDetail);
const history = definePageQuery("history", HistoryArgs, HistoryReturns);
const create = definePageMutation("create", CreateArgs);
const rename = definePageMutation("rename", RenameArgs);
const move = definePageMutation("move", MoveArgs);
const favorite = definePageMutation("favorite", FavoriteArgs);
const archive = definePageMutation("archive", ArchiveArgs);

const recordSnapshotInternal = FunctionSpec.internalMutation({
  name: "recordSnapshotInternal",
  args: () => RecordSnapshotArgs,
  returns: () => RecordSnapshotReturns,
  error: () => BrainPageWriteError,
});

const contractFunctions = [
  list,
  get,
  history,
  create,
  rename,
  move,
  favorite,
  archive,
] as const;

export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(list.spec)
  .addFunction(get.spec)
  .addFunction(history.spec)
  .addFunction(create.spec)
  .addFunction(rename.spec)
  .addFunction(move.spec)
  .addFunction(favorite.spec)
  .addFunction(archive.spec)
  .addFunction(recordSnapshotInternal);
