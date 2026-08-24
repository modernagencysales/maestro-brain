import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import {
  MemberNotInWorkspace,
  NotFound,
  StaleRevision,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import { Id } from "../_generated/id";
import brainPages from "../_generated/tables/brainPages";
import pageRevisions from "../_generated/tables/pageRevisions";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";

const BrainPageError = Schema.Union([
  Unauthorized,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  NotFound,
  ValidationFailed,
]);

const BrainPageWriteError = Schema.Union([
  BrainPageError,
  ValidationFailed,
  StaleRevision,
]);

const ListArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  includeArchived: Schema.optional(Schema.Boolean),
});

const ListReturns = Schema.Array(brainPages.Doc);

const CreateMarkdownArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  slug: Schema.String,
  title: Schema.String,
  markdown: Schema.String,
  parentPageId: Schema.optional(Schema.NullOr(Id("brainPages"))),
  sortKey: Schema.optional(Schema.String),
});

const CreateMarkdownReturns = Id("brainPages");

const PageDetailArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  pageId: Id("brainPages"),
});

const UpdateMarkdownArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  pageId: Id("brainPages"),
  markdown: Schema.String,
  expectedUpdatedAt: Schema.Number,
});

const HistoryArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  pageId: Id("brainPages"),
  limit: Schema.optional(Schema.Number),
});

const HistoryReturns = Schema.Array(pageRevisions.Doc);

const PageRevisionArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  pageId: Id("brainPages"),
  expectedUpdatedAt: Schema.Number,
});

const RenameArgs = Schema.Struct({
  ...PageRevisionArgs.fields,
  title: Schema.String,
});

const MoveArgs = Schema.Struct({
  ...PageRevisionArgs.fields,
  parentPageId: Schema.NullOr(Id("brainPages")),
  sortKey: Schema.String,
});

const FavoriteArgs = Schema.Struct({
  ...PageRevisionArgs.fields,
  favorite: Schema.Boolean,
});

const RestoreArgs = Schema.Struct({
  ...PageRevisionArgs.fields,
  revisionUpdatedAt: Schema.Number,
});

export const RecordSnapshotArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  pageId: Id("brainPages"),
  snapshot: Schema.String,
  version: Schema.Number,
});

export const RecordSnapshotReturns = Schema.Struct({
  ok: Schema.Literal(true),
});

const list = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "list",
    args: () => ListArgs,
    returns: () => ListReturns,
    error: () => BrainPageError,
  }),
  {
    namespace: "brain.pages",
    name: "list",
    operationId: "brain.pages.list",
    kind: "query",
    surfaces: ["web"],
    typedErrors: ["Unauthorized", "MemberNotInWorkspace", "WorkspaceNotFound"],
    idempotent: true,
    argsSchemaName: "brain.pages.list.args",
    returnsSchemaName: "brain.pages.list.returns",
    argsSchema: ListArgs,
    returnsSchema: ListReturns,
  },
);

const get = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "get",
    args: () => PageDetailArgs,
    returns: () => brainPages.Doc,
    error: () => BrainPageError,
  }),
  {
    namespace: "brain.pages",
    name: "get",
    operationId: "brain.pages.get",
    kind: "query",
    surfaces: ["web"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "brain.pages.get.args",
    returnsSchemaName: "brain.pages.get.returns",
    argsSchema: PageDetailArgs,
    returnsSchema: brainPages.Doc,
  },
);

const createMarkdown = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "createMarkdown",
    args: () => CreateMarkdownArgs,
    returns: () => CreateMarkdownReturns,
    error: () => BrainPageWriteError,
  }),
  {
    namespace: "brain.pages",
    name: "createMarkdown",
    operationId: "brain.pages.createMarkdown",
    kind: "mutation",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "brain.pages.createMarkdown.args",
    returnsSchemaName: "brain.pages.createMarkdown.returns",
    argsSchema: CreateMarkdownArgs,
    returnsSchema: CreateMarkdownReturns,
  },
);

const updateMarkdown = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "updateMarkdown",
    args: () => UpdateMarkdownArgs,
    returns: () => brainPages.Doc,
    error: () => BrainPageWriteError,
  }),
  {
    namespace: "brain.pages",
    name: "updateMarkdown",
    operationId: "brain.pages.updateMarkdown",
    kind: "mutation",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
      "StaleRevision",
    ],
    idempotent: false,
    argsSchemaName: "brain.pages.updateMarkdown.args",
    returnsSchemaName: "brain.pages.updateMarkdown.returns",
    argsSchema: UpdateMarkdownArgs,
    returnsSchema: brainPages.Doc,
  },
);

const history = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "history",
    args: () => HistoryArgs,
    returns: () => HistoryReturns,
    error: () => BrainPageError,
  }),
  {
    namespace: "brain.pages",
    name: "history",
    operationId: "brain.pages.history",
    kind: "query",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "brain.pages.history.args",
    returnsSchemaName: "brain.pages.history.returns",
    argsSchema: HistoryArgs,
    returnsSchema: HistoryReturns,
  },
);

const pageWriteErrors = [
  "Unauthorized",
  "MemberNotInWorkspace",
  "WorkspaceNotFound",
  "NotFound",
  "ValidationFailed",
  "StaleRevision",
] as const;

const definePageMutation = <
  const Name extends "rename" | "move" | "favorite" | "archive" | "restore",
  Args extends Schema.Codec<unknown, unknown>,
>(
  name: Name,
  inputSchema: Args,
) =>
  defineContractFunction(
    FunctionSpec.publicMutation({
      name,
      args: () => inputSchema,
      returns: () => brainPages.Doc,
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
      returnsSchema: brainPages.Doc,
    },
  );

const rename = definePageMutation("rename", RenameArgs);
const move = definePageMutation("move", MoveArgs);
const favorite = definePageMutation("favorite", FavoriteArgs);
const archive = definePageMutation("archive", PageRevisionArgs);
const restore = definePageMutation("restore", RestoreArgs);

const recordSnapshotInternal = FunctionSpec.internalMutation({
  name: "recordSnapshotInternal",
  args: () => RecordSnapshotArgs,
  returns: () => RecordSnapshotReturns,
  error: () => Schema.Union([NotFound, ValidationFailed]),
});

const contractFunctions = [
  list,
  get,
  history,
  createMarkdown,
  updateMarkdown,
  rename,
  move,
  favorite,
  archive,
  restore,
] as const;

export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(list.spec)
  .addFunction(get.spec)
  .addFunction(history.spec)
  .addFunction(createMarkdown.spec)
  .addFunction(updateMarkdown.spec)
  .addFunction(rename.spec)
  .addFunction(move.spec)
  .addFunction(favorite.spec)
  .addFunction(archive.spec)
  .addFunction(restore.spec)
  .addFunction(recordSnapshotInternal);
