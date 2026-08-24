import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import workspaces from "../_generated/tables/workspaces";
import { Id } from "../_generated/id";
import {
  Forbidden,
  MemberNotInWorkspace,
  NoRecoverableError,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";

const frontendWorkspace = Schema.Struct({
  id: Id("workspaces"),
  slug: Schema.String,
  name: Schema.String,
});

const me = FunctionSpec.publicQuery({
  name: "me",
  args: () => Schema.Struct({}),
  returns: () =>
    Schema.Struct({
      id: Id("users"),
      email: Schema.String,
      name: Schema.String,
      image: Schema.Null,
      workspaces: Schema.Array(frontendWorkspace),
    }),
  error: () => Unauthorized,
});

const bySlug = FunctionSpec.publicQuery({
  name: "bySlug",
  args: () => Schema.Struct({ slug: Schema.String }),
  returns: () => Schema.NullOr(frontendWorkspace),
  error: () => Schema.Union([Unauthorized, MemberNotInWorkspace]),
});

const WorkspaceList = Schema.Array(workspaces.Doc);
const list = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "list",
    args: () => Schema.Struct({}),
    returns: () => WorkspaceList,
    error: () =>
      Schema.Union([Unauthorized, NoRecoverableError, ValidationFailed]),
  }),
  {
    namespace: "auth.workspaces",
    name: "list",
    operationId: "auth.workspaces.list",
    kind: "query",
    surfaces: ["web", "api"],
    typedErrors: ["Unauthorized", "ValidationFailed"],
    idempotent: true,
    argsSchemaName: "auth.workspaces.list.args",
    returnsSchemaName: "auth.workspaces.list.returns",
    argsSchema: Schema.Struct({}),
    returnsSchema: WorkspaceList,
  },
);

const listForActor = FunctionSpec.internalQuery({
  name: "listForActor",
  args: () => Schema.Struct({ userId: Id("users") }),
  returns: () => WorkspaceList,
  error: () => Schema.Union([NoRecoverableError, ValidationFailed]),
});

const WorkspaceName = Schema.String;
const WorkspaceSlug = Schema.String;
const WorkspaceMutationError = Schema.Union([
  Unauthorized,
  Forbidden,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  ValidationFailed,
]);

const slugAvailable = FunctionSpec.publicQuery({
  name: "slugAvailable",
  args: () => Schema.Struct({ slug: WorkspaceSlug }),
  returns: () => Schema.Struct({ available: Schema.Boolean }),
  error: () => Schema.Union([Unauthorized, ValidationFailed]),
});

const create = FunctionSpec.publicMutation({
  name: "create",
  args: () =>
    Schema.Struct({
      name: WorkspaceName,
      slug: WorkspaceSlug,
    }),
  returns: () => frontendWorkspace,
  error: () => WorkspaceMutationError,
});

const update = FunctionSpec.publicMutation({
  name: "update",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      name: WorkspaceName,
      slug: WorkspaceSlug,
    }),
  returns: () => frontendWorkspace,
  error: () => WorkspaceMutationError,
});

const contractFunctions = [list] as const;
export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(me)
  .addFunction(bySlug)
  .addFunction(list.spec)
  .addFunction(listForActor)
  .addFunction(slugAvailable)
  .addFunction(create)
  .addFunction(update);
