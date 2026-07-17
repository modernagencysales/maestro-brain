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
