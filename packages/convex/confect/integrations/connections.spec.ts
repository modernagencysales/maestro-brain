import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";
import {
  MemberNotInWorkspace,
  NotFound,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import { providerKeys } from "./connectionLifecycle";
import { CurrentProviderConnectionRow } from "../tables/providerConnections";

const ProviderKey = Schema.Literals(providerKeys);
const CurrentProviderConnectionDoc = Schema.Struct({
  ...CurrentProviderConnectionRow.fields,
  _id: Id("providerConnections"),
  _creationTime: Schema.Number,
});
const AccessError = Schema.Union([
  Unauthorized,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  ValidationFailed,
]);
const MutationError = Schema.Union([AccessError, NotFound, ValidationFailed]);
const WorkspaceProviderArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  provider: ProviderKey,
});
const ActorWorkspaceArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  userId: Id("users"),
});
const ActorWorkspaceProviderArgs = Schema.Struct({
  ...WorkspaceProviderArgs.fields,
  userId: Id("users"),
});
const CompletionArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  provider: ProviderKey,
  generation: Schema.Number,
  completion: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("active"),
      connectionRef: Schema.NonEmptyString,
    }),
    Schema.Struct({
      status: Schema.Literal("error"),
      errorCode: Schema.NonEmptyString,
    }),
  ]),
});
const ActorCompletionArgs = Schema.Struct({
  ...CompletionArgs.fields,
  userId: Id("users"),
});
const RevokeArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  provider: ProviderKey,
  generation: Schema.Number,
});
const ActorRevokeArgs = Schema.Struct({
  ...RevokeArgs.fields,
  userId: Id("users"),
});
const ConnectionList = Schema.Array(CurrentProviderConnectionDoc);

const list = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "list",
    args: () => Schema.Struct({ workspaceId: Id("workspaces") }),
    returns: () => ConnectionList,
    error: () => AccessError,
  }),
  {
    namespace: "integrations.connections",
    name: "list",
    operationId: "integrations.connections.list",
    kind: "query",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "integrations.connections.list.args",
    returnsSchemaName: "integrations.connections.list.returns",
    argsSchema: Schema.Struct({ workspaceId: Id("workspaces") }),
    returnsSchema: ConnectionList,
  },
);

const begin = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "begin",
    args: () => WorkspaceProviderArgs,
    returns: () => CurrentProviderConnectionDoc,
    error: () => MutationError,
  }),
  {
    namespace: "integrations.connections",
    name: "begin",
    operationId: "integrations.connections.begin",
    kind: "mutation",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "integrations.connections.begin.args",
    returnsSchemaName: "integrations.connections.begin.returns",
    argsSchema: WorkspaceProviderArgs,
    returnsSchema: CurrentProviderConnectionDoc,
  },
);

const complete = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "complete",
    args: () => CompletionArgs,
    returns: () => CurrentProviderConnectionDoc,
    error: () => MutationError,
  }),
  {
    namespace: "integrations.connections",
    name: "complete",
    operationId: "integrations.connections.complete",
    kind: "mutation",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "integrations.connections.complete.args",
    returnsSchemaName: "integrations.connections.complete.returns",
    argsSchema: CompletionArgs,
    returnsSchema: CurrentProviderConnectionDoc,
  },
);

const revoke = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "revoke",
    args: () => RevokeArgs,
    returns: () => CurrentProviderConnectionDoc,
    error: () => MutationError,
  }),
  {
    namespace: "integrations.connections",
    name: "revoke",
    operationId: "integrations.connections.revoke",
    kind: "mutation",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "integrations.connections.revoke.args",
    returnsSchemaName: "integrations.connections.revoke.returns",
    argsSchema: RevokeArgs,
    returnsSchema: CurrentProviderConnectionDoc,
  },
);

const listForActor = FunctionSpec.internalQuery({
  name: "listForActor",
  args: () => ActorWorkspaceArgs,
  returns: () => ConnectionList,
  error: () => AccessError,
});
const beginForActor = FunctionSpec.internalMutation({
  name: "beginForActor",
  args: () => ActorWorkspaceProviderArgs,
  returns: () => CurrentProviderConnectionDoc,
  error: () => MutationError,
});
const completeForActor = FunctionSpec.internalMutation({
  name: "completeForActor",
  args: () => ActorCompletionArgs,
  returns: () => CurrentProviderConnectionDoc,
  error: () => MutationError,
});
const revokeForActor = FunctionSpec.internalMutation({
  name: "revokeForActor",
  args: () => ActorRevokeArgs,
  returns: () => CurrentProviderConnectionDoc,
  error: () => MutationError,
});

const contractFunctions = [list, begin, complete, revoke] as const;
export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(list.spec)
  .addFunction(begin.spec)
  .addFunction(complete.spec)
  .addFunction(revoke.spec)
  .addFunction(listForActor)
  .addFunction(beginForActor)
  .addFunction(completeForActor)
  .addFunction(revokeForActor);
