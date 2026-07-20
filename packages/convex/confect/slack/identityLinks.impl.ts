import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader, DatabaseWriter } from "../_generated/services";
import { loadCurrentUser } from "../access/handlerContext";
import { roleAtLeast } from "../access/roles";
import { Forbidden, Unauthorized } from "../errors";
import type { SlackIdentityBindingRowValue } from "../tables/slackIdentityBindings";
import slackIdentityLinks, {
  BindingRevoked,
  LinkExpired,
  LinkReplay,
  SlackIdentityAlreadyBound,
  TeamMismatch,
} from "./identityLinks.spec";

export type SlackIdentityBinding = SlackIdentityBindingRowValue;

type ConsumeError =
  | LinkExpired
  | LinkReplay
  | SlackIdentityAlreadyBound
  | TeamMismatch
  | BindingRevoked;

type SlackIdentityBindingDoc = SlackIdentityBinding & { readonly _id: string };
type SlackIdentityIndexRange = {
  eq: (field: string, value: string | number) => SlackIdentityIndexRange;
};
type SlackIdentityBindingTable = {
  index: (
    name: string,
    range: (q: SlackIdentityIndexRange) => unknown,
  ) => {
    collect: () => Effect.Effect<readonly SlackIdentityBindingDoc[], unknown>;
    first: () => Effect.Effect<Option.Option<SlackIdentityBindingDoc>, unknown>;
  };
  insert: (row: SlackIdentityBinding) => Effect.Effect<unknown, unknown>;
  patch: (
    id: string,
    patch: Partial<SlackIdentityBinding>,
  ) => Effect.Effect<unknown, unknown>;
};

const slackIdentityBindingTable = (
  database: unknown,
): SlackIdentityBindingTable =>
  (
    database as {
      table: (name: "slackIdentityBindings") => SlackIdentityBindingTable;
    }
  ).table("slackIdentityBindings");

const pendingSlackUserIdFor = (userId: string, connectionGeneration: number) =>
  `pending:${userId}:${connectionGeneration}`;

const bindingKeyFor = (input: {
  readonly organizationKey: string;
  readonly teamId: string;
  readonly slackUserId: string;
}) =>
  `slackbind_${input.organizationKey}_${input.teamId}_${input.slackUserId.replace(/[^A-Za-z0-9_-]/g, "_")}`;

export const createSlackIdentityLinkIntentPlan = (input: {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly teamId: string;
  readonly workspaceId?: string | undefined;
  readonly brainKey?: string | undefined;
  readonly userId: string;
  readonly workosSubject: string;
  readonly nonceHash: string;
  readonly now: number;
}): Either.Either<
  { readonly row: SlackIdentityBinding; readonly linkToken: string },
  never
> => {
  const slackUserId = pendingSlackUserIdFor(
    input.userId,
    input.connectionGeneration,
  );
  const row: SlackIdentityBinding = {
    bindingKey: bindingKeyFor({ ...input, slackUserId }),
    organizationKey: input.organizationKey,
    connectionKey: input.connectionKey,
    connectionGeneration: input.connectionGeneration,
    teamId: input.teamId,
    workspaceId: input.workspaceId,
    brainKey: input.brainKey,
    slackUserId,
    userId: input.userId,
    workosSubject: input.workosSubject,
    status: "pending_verification",
    bindingGeneration: input.connectionGeneration,
    nonceHash: input.nonceHash,
    intentExpiresAt: input.now + 300,
    createdAt: input.now,
    updatedAt: input.now,
    verifiedAt: null,
    revokedAt: null,
    revokeReason: null,
  };
  return Either.right({
    row,
    linkToken: `slack-link:${input.organizationKey}:${input.teamId}:${input.nonceHash}`,
  });
};

const activeMembershipFor = (input: {
  readonly organizationId: string;
  readonly userId: string;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("organizationMembers")
      .index("by_organization_user", (q) =>
        q.eq("organizationId", input.organizationId).eq("userId", input.userId),
      )
      .collect()
      .pipe(Effect.orDie);
    return rows.find(
      (row) =>
        row.status === "active" &&
        row.acceptedAt !== null &&
        row.revokedAt === null,
    );
  });

const resolveAuthorizedConnection = (input: {
  readonly workspaceId: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly teamId: string;
  readonly brainKey?: string | undefined;
  readonly allowStaleConnection?: boolean;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const user = yield* loadCurrentUser(reader);
    if (user.status !== "active")
      return yield* new Forbidden({ reason: "Current user is suspended." });
    const auth = yield* Auth;
    const identity = yield* auth.getUserIdentity.pipe(
      Effect.mapError(() => new Unauthorized()),
    );
    const connections = yield* reader
      .table("providerConnections")
      .index("by_connection_key", (q) =>
        q.eq("connectionKey", input.connectionKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const connection = connections.find((row) =>
      input.allowStaleConnection
        ? row.connectionGeneration === input.connectionGeneration &&
          row.teamId === input.teamId
        : row.status === "active" &&
          row.connectionGeneration === input.connectionGeneration &&
          row.teamId === input.teamId,
    );
    if (connection === undefined)
      return yield* new Forbidden({
        reason: "Slack connection is not current.",
      });

    const workosOrganizationId = (
      identity as { readonly workosOrganizationId?: string }
    ).workosOrganizationId;
    if (workosOrganizationId === undefined) return yield* new Unauthorized();
    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", workosOrganizationId),
      )
