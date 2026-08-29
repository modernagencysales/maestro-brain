import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";
import {
  MemberNotInWorkspace,
  NoRecoverableError,
  NotFound,
  StaleRevision,
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
const SyncError = Schema.Union([MutationError, StaleRevision]);
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
const ConnectionOrNull = Schema.NullOr(CurrentProviderConnectionDoc);
export const SlackChannelIds = Schema.Array(Schema.NonEmptyString).pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(1)),
);
const SlackSyncArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  channelIds: SlackChannelIds,
  lookbackDays: Schema.optional(Schema.Number),
});
const GoogleDriveSyncArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  driveId: Schema.NonEmptyString,
  rootFolderIds: Schema.Array(Schema.NonEmptyString).pipe(
    Schema.check(Schema.isMinLength(1)),
  ),
  allowlistGeneration: Schema.optional(Schema.Number),
});
const HubSpotSyncArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  portalId: Schema.NonEmptyString,
  allowlistGeneration: Schema.optional(Schema.Number),
});

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

const beginSlackOauth = FunctionSpec.publicAction({
  name: "beginSlackOauth",
  args: () => Schema.Struct({ workspaceId: Id("workspaces") }),
  returns: () =>
    Schema.Struct({
      connectSessionToken: Schema.NonEmptyString,
      expiresAt: Schema.Number,
      generation: Schema.Number,
    }),
  error: () => MutationError,
});

const beginProviderOauth = FunctionSpec.publicAction({
  name: "beginProviderOauth",
  args: () => WorkspaceProviderArgs,
  returns: () =>
    Schema.Struct({
      connectSessionToken: Schema.NonEmptyString,
      expiresAt: Schema.Number,
      generation: Schema.Number,
    }),
  error: () => MutationError,
});

const completeSlackOauth = FunctionSpec.publicAction({
  name: "completeSlackOauth",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      generation: Schema.Number,
      connectionId: Schema.NonEmptyString,
    }),
  returns: () => CurrentProviderConnectionDoc,
  error: () => MutationError,
});

const completeProviderOauth = FunctionSpec.publicAction({
  name: "completeProviderOauth",
  args: () =>
    Schema.Struct({
      ...WorkspaceProviderArgs.fields,
      generation: Schema.Number,
      connectionId: Schema.NonEmptyString,
    }),
  returns: () => CurrentProviderConnectionDoc,
  error: () => MutationError,
});

const discoverProviderScopes = FunctionSpec.publicAction({
  name: "discoverProviderScopes",
  args: () =>
    Schema.Struct({
      ...WorkspaceProviderArgs.fields,
      containerId: Schema.optional(Schema.NonEmptyString),
    }),
  returns: () =>
    Schema.Struct({
      provider: ProviderKey,
      containers: Schema.Array(
        Schema.Struct({
          id: Schema.NonEmptyString,
          label: Schema.NonEmptyString,
        }),
      ),
      scopes: Schema.Array(
        Schema.Struct({
          id: Schema.NonEmptyString,
          label: Schema.NonEmptyString,
          description: Schema.optional(Schema.NonEmptyString),
        }),
      ),
      resolvedContainerId: Schema.optional(Schema.NonEmptyString),
    }),
  error: () => MutationError,
});

const syncSlack = FunctionSpec.publicAction({
  name: "syncSlack",
  args: () => SlackSyncArgs,
  returns: () =>
    Schema.Struct({
      pageCount: Schema.Number,
      messageCount: Schema.Number,
      syncedAt: Schema.Number,
    }),
  error: () => SyncError,
});

const syncGoogleDrive = FunctionSpec.publicAction({
  name: "syncGoogleDrive",
  args: () => GoogleDriveSyncArgs,
  returns: () =>
    Schema.Struct({
      sourceCount: Schema.Number,
      syncedAt: Schema.Number,
    }),
  error: () => SyncError,
});

const syncHubSpot = FunctionSpec.publicAction({
  name: "syncHubSpot",
  args: () => HubSpotSyncArgs,
  returns: () =>
    Schema.Struct({
      sourceCount: Schema.Number,
      syncedAt: Schema.Number,
    }),
  error: () => SyncError,
});

const recordProviderSync = FunctionSpec.internalMutation({
  name: "recordProviderSync",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      provider: ProviderKey,
      status: Schema.Literals(["syncing", "ready", "error"]),
      syncedAt: Schema.optional(Schema.Number),
      sourceCount: Schema.optional(Schema.Number),
      driveId: Schema.optional(Schema.NonEmptyString),
      rootFolderIds: Schema.optional(Schema.Array(Schema.NonEmptyString)),
      portalId: Schema.optional(Schema.NonEmptyString),
      allowlistGeneration: Schema.optional(Schema.Number),
      errorCode: Schema.optional(Schema.NonEmptyString),
    }),
  returns: () => CurrentProviderConnectionDoc,
  error: () => MutationError,
});

const recordSlackSync = FunctionSpec.internalMutation({
  name: "recordSlackSync",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      status: Schema.Literals(["syncing", "ready", "error"]),
      syncedAt: Schema.optional(Schema.Number),
      messageCount: Schema.optional(Schema.Number),
      pageCount: Schema.optional(Schema.Number),
      channelIds: Schema.optional(Schema.Array(Schema.NonEmptyString)),
      errorCode: Schema.optional(Schema.NonEmptyString),
    }),
  returns: () => CurrentProviderConnectionDoc,
  error: () => MutationError,
});

const connectionForSync = FunctionSpec.internalQuery({
  name: "connectionForSync",
  args: () => WorkspaceProviderArgs,
  returns: () => ConnectionOrNull,
  error: () => NoRecoverableError,
});

const syncSlackScheduled = FunctionSpec.internalAction({
  name: "syncSlackScheduled",
  args: () => SlackSyncArgs,
  returns: () =>
    Schema.Struct({
      pageCount: Schema.Number,
      messageCount: Schema.Number,
      syncedAt: Schema.Number,
    }),
  error: () => SyncError,
});

const syncGoogleDriveScheduled = FunctionSpec.internalAction({
  name: "syncGoogleDriveScheduled",
  args: () => GoogleDriveSyncArgs,
  returns: () =>
    Schema.Struct({ sourceCount: Schema.Number, syncedAt: Schema.Number }),
  error: () => SyncError,
});

const syncHubSpotScheduled = FunctionSpec.internalAction({
  name: "syncHubSpotScheduled",
  args: () => HubSpotSyncArgs,
  returns: () =>
    Schema.Struct({ sourceCount: Schema.Number, syncedAt: Schema.Number }),
  error: () => SyncError,
});

const dispatchScheduledSyncs = FunctionSpec.internalMutation({
  name: "dispatchScheduledSyncs",
  args: () => Schema.Struct({}),
  returns: () =>
    Schema.Struct({
      scheduledCount: Schema.Number,
      skippedCount: Schema.Number,
    }),
  error: () => Schema.Union([ValidationFailed]),
});

const contractFunctions = [list, begin, complete, revoke] as const;
export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(list.spec)
  .addFunction(begin.spec)
  .addFunction(beginSlackOauth)
  .addFunction(beginProviderOauth)
  .addFunction(completeSlackOauth)
  .addFunction(completeProviderOauth)
  .addFunction(discoverProviderScopes)
  .addFunction(syncSlack)
  .addFunction(syncGoogleDrive)
  .addFunction(syncHubSpot)
  .addFunction(syncSlackScheduled)
  .addFunction(syncGoogleDriveScheduled)
  .addFunction(syncHubSpotScheduled)
  .addFunction(connectionForSync)
  .addFunction(dispatchScheduledSyncs)
  .addFunction(recordSlackSync)
  .addFunction(recordProviderSync)
  .addFunction(complete.spec)
  .addFunction(revoke.spec)
  .addFunction(listForActor)
  .addFunction(beginForActor)
  .addFunction(completeForActor)
  .addFunction(revokeForActor);
