import { Ref } from "@confect/core";
import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
  QueryRunner,
} from "../_generated/services";
import type { ProviderConnectionRow } from "./slackConnections.impl";
import slackDirectory, {
  BotIdentityMismatch,
  ConnectionGenerationMismatch,
  ConnectionNotFound,
  ProviderRateLimited,
  ProviderUnavailable,
  commitInitialReconcileFailure,
  commitReconcileChannels,
  commitReconcileIdentity,
  readReconcileConnection,
} from "./slackDirectory.spec";
import type { SourceChannelRowValue } from "../tables/sourceChannels";

type SlackDirectoryConnection = Pick<
  ProviderConnectionRow,
  | "organizationKey"
  | "connectionKey"
  | "connectionGeneration"
  | "status"
  | "teamId"
  | "apiAppId"
  | "botUserId"
  | "nangoConnectionId"
> & { readonly _id?: GenericId<"providerConnections"> | string };

export type ProviderSlackChannel = {
  readonly id: string;
  readonly name: string;
  readonly is_member: boolean;
  readonly is_shared?: boolean | undefined;
  readonly is_ext_shared?: boolean | undefined;
  readonly is_archived?: boolean | undefined;
};

export type SlackDirectoryPage = {
  readonly channels: readonly ProviderSlackChannel[];
  readonly nextCursor: string | null;
};

export type SlackBotIdentity = {
  readonly teamId: string;
  readonly apiAppId: string;
  readonly botUserId: string;
};

export type SlackDirectoryProviderService = {
  readonly authTest: (input: {
    readonly connectionKey: string;
    readonly nangoConnectionId?: string | null | undefined;
  }) => Promise<SlackBotIdentity>;
  readonly listChannels: (input: {
    readonly connectionKey: string;
    readonly nangoConnectionId?: string | null | undefined;
    readonly cursor: string | null;
    readonly limit: number;
  }) => Promise<SlackDirectoryPage>;
};

type PlannedUpsert = Omit<
  SourceChannelRowValue,
  "firstDiscoveredAt" | "updatedAt" | "lastSeenAt"
> & {
  readonly rowId?: GenericId<"sourceChannels">;
  readonly firstDiscoveredAt: number;
  readonly updatedAt: number;
  readonly lastSeenAt: number;
};

const normalizeChannelName = (name: string) => name.trim().toLowerCase();
const channelKeyFor = (connectionKey: string, externalChannelId: string) =>
  `${connectionKey}:${externalChannelId}`;

const membershipStatusFor = (input: {
  readonly channel: ProviderSlackChannel;
  readonly existing?: SourceChannelRowValue | undefined;
}): SourceChannelRowValue["membershipStatus"] => {
  if (input.channel.is_archived === true) return "archived";
  if (!input.channel.is_member) {
    return input.existing?.isMember === true
      ? "access_lost"
      : "discovered_not_joined";
  }
  return input.existing?.membershipStatus === "joined_active"
    ? "joined_active"
    : "joined_needs_policy";
};

const validateReconcileConnection = (input: {
  readonly connectionKey: string;
  readonly expectedGeneration: number;
  readonly connection: SlackDirectoryConnection | null;
}): Either.Either<
  SlackDirectoryConnection,
  ConnectionNotFound | ConnectionGenerationMismatch | BotIdentityMismatch
> => {
  const connection = input.connection;
  if (connection === null || connection.status !== "active") {
    return Either.left(
      new ConnectionNotFound({ connectionKey: input.connectionKey }),
    );
  }
  if (connection.connectionGeneration !== input.expectedGeneration) {
    return Either.left(
      new ConnectionGenerationMismatch({
        connectionKey: input.connectionKey,
        expectedGeneration: input.expectedGeneration,
        actualGeneration: connection.connectionGeneration,
      }),
    );
  }
  if (!connection.teamId || !connection.apiAppId || !connection.botUserId) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  return Either.right(connection);
};

const validateActivationConnection = (input: {
  readonly connectionKey: string;
  readonly expectedGeneration: number;
  readonly connection: SlackDirectoryConnection | null;
}): Either.Either<
  SlackDirectoryConnection,
  ConnectionNotFound | ConnectionGenerationMismatch
> => {
  const connection = input.connection;
  if (
    connection === null ||
    !["verifying", "reauthorizing", "active"].includes(connection.status)
  ) {
    return Either.left(
      new ConnectionNotFound({ connectionKey: input.connectionKey }),
    );
  }
  if (connection.connectionGeneration !== input.expectedGeneration) {
    return Either.left(
      new ConnectionGenerationMismatch({
        connectionKey: input.connectionKey,
        expectedGeneration: input.expectedGeneration,
        actualGeneration: connection.connectionGeneration,
      }),
    );
  }
  return Either.right(connection);
};

const directoryProviderError = (error: unknown) =>
  error instanceof ProviderRateLimited || error instanceof BotIdentityMismatch
    ? error
    : new ProviderUnavailable();

const verifyBotIdentity = (input: {
  readonly connectionKey: string;
  readonly connection: SlackDirectoryConnection;
  readonly providerIdentity: SlackBotIdentity;
}): Either.Either<void, BotIdentityMismatch> => {
  if (
    input.providerIdentity.teamId !== input.connection.teamId ||
    input.providerIdentity.apiAppId !== input.connection.apiAppId ||
    input.providerIdentity.botUserId !== input.connection.botUserId
  ) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  return Either.right(undefined);
};

const hasDuplicateActiveBinding = (input: {
  readonly connectionKey: string;
  readonly providerIdentity: SlackBotIdentity;
  readonly activeConnections: readonly SlackDirectoryConnection[];
}) =>
  input.activeConnections.some(
    (connection) =>
      connection.connectionKey !== input.connectionKey &&
      connection.status === "active" &&
      connection.teamId === input.providerIdentity.teamId &&
      connection.apiAppId === input.providerIdentity.apiAppId &&
      connection.botUserId === input.providerIdentity.botUserId,
  );

export const activateSlackConnectionPlan = (input: {
  readonly connectionKey: string;
  readonly expectedGeneration: number;
  readonly connection: SlackDirectoryConnection | null;
  readonly providerIdentity: SlackBotIdentity;
  readonly activeConnections?: readonly SlackDirectoryConnection[];
  readonly now: number;
}): Either.Either<
  {
    readonly connection: SlackDirectoryConnection;
    readonly patch: Record<string, unknown>;
  },
  ConnectionNotFound | ConnectionGenerationMismatch | BotIdentityMismatch
> => {
  const validated = validateActivationConnection(input);
  if (Either.isLeft(validated)) return Either.left(validated.left);
  const connection = validated.right;
  if (
    hasDuplicateActiveBinding({
      connectionKey: input.connectionKey,
      providerIdentity: input.providerIdentity,
      activeConnections: input.activeConnections ?? [],
    })
  ) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  if (connection.status === "active") {
    const verified = verifyBotIdentity({
      connectionKey: input.connectionKey,
      connection,
      providerIdentity: input.providerIdentity,
    });
    if (Either.isLeft(verified)) return Either.left(verified.left);
    return Either.right({ connection, patch: { updatedAt: input.now } });
  }
  if (
    connection.status === "reauthorizing" &&
    connection.teamId !== input.providerIdentity.teamId
  ) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  if (
    connection.status === "reauthorizing" &&
    connection.apiAppId !== input.providerIdentity.apiAppId
  ) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  if (
    connection.status === "reauthorizing" &&
    connection.botUserId !== input.providerIdentity.botUserId
  ) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  const nextGeneration =
    connection.status === "reauthorizing"
      ? connection.connectionGeneration + 1
      : connection.connectionGeneration;
  const patch = {
    status: "active" as const,
    connectionGeneration: nextGeneration,
    teamId: input.providerIdentity.teamId,
    apiAppId: input.providerIdentity.apiAppId,
    botUserId: input.providerIdentity.botUserId,
    errorReason: null,
    updatedAt: input.now,
  };
  return Either.right({
    patch,
    connection: {
      ...connection,
      ...patch,
    },
  });
};

export const revokeSlackConnectionPlan = (input: {
  readonly connectionKey: string;
  readonly connection: SlackDirectoryConnection | null;
  readonly reason: "team_or_app_or_bot_changed" | "disconnect_or_uninstall";
  readonly now: number;
}): Either.Either<
  {
    readonly connectionPatch: Record<string, unknown>;
    readonly syncPatch: Record<string, unknown>;
    readonly audit: {
      readonly connectionKey: string;
      readonly connectionGeneration: number;
      readonly reason: string;
      readonly recordedAt: number;
    };
  },
  ConnectionNotFound
> => {
  const connection = input.connection;
  if (connection === null || connection.status === "revoked") {
    return Either.left(
      new ConnectionNotFound({ connectionKey: input.connectionKey }),
    );
  }
  return Either.right({
    connectionPatch: {
      status: "revoked" as const,
      errorReason: `replacement:${input.reason}`,
      updatedAt: input.now,
    },
    syncPatch: {
      status: "access_lost" as const,
      leaseId: null,
      leaseExpiresAt: null,
      updatedAt: input.now,
      replacementAudit: {
        connectionKey: input.connectionKey,
        connectionGeneration: connection.connectionGeneration,
        reason: input.reason,
        recordedAt: input.now,
      },
    },
    audit: {
      connectionKey: input.connectionKey,
      connectionGeneration: connection.connectionGeneration,
      reason: input.reason,
      recordedAt: input.now,
    },
  });
};
