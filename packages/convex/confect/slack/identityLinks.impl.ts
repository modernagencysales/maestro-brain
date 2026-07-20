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
      .collect()
      .pipe(Effect.orDie);
    const organization = organizations.find(
      (row) =>
        row.status === "active" && row.agencyKey === connection.organizationKey,
    );
    if (organization === undefined)
      return yield* new Forbidden({
        reason: "Slack connection is outside the current organization.",
      });
    const workspaces = yield* reader
      .table("workspaces")
      .index("by_organization", (q) => q.eq("organizationId", organization._id))
      .collect()
      .pipe(Effect.orDie);
    const workspace = workspaces.find((row) => row._id === input.workspaceId);
    if (
      workspace === undefined ||
      workspace.organizationId !== organization._id ||
      (input.brainKey !== undefined && workspace.brainKey !== input.brainKey)
    )
      return yield* new Forbidden({ reason: "Slack link workspace mismatch." });
    const membership = yield* activeMembershipFor({
      organizationId: organization._id,
      userId: user._id,
    });
    const workspaceMembers = yield* reader
      .table("workspaceMembers")
      .index("by_workspace_user", (q) =>
        q.eq("workspaceId", input.workspaceId).eq("userId", user._id),
      )
      .collect()
      .pipe(Effect.orDie);
    const workspaceRole = workspaceMembers.find(
      (row) =>
        row.status === "active" &&
        row.acceptedAt !== null &&
        row.revokedAt === null &&
        row.deletedAt === null,
    )?.role;
    if (
      membership === undefined ||
      !workspaceRole ||
      !roleAtLeast(workspaceRole, "editor")
    )
      return yield* new Forbidden({
        reason: "Current user is not an active Brain editor.",
      });
    return { connection, workspace, user, workosSubject: identity.subject };
  });

const findByNonceHash = (nonceHash: string) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const row = yield* slackIdentityBindingTable(reader)
      .index("by_nonce_hash", (q) => q.eq("nonceHash", nonceHash))
      .first()
      .pipe(Effect.orDie);
    return Option.getOrNull(row) as SlackIdentityBindingDoc | null;
  });

const findActiveSlackIdentity = (input: {
  readonly organizationKey: string;
  readonly teamId: string;
  readonly slackUserId: string;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* slackIdentityBindingTable(reader)
      .index("by_exact_slack_identity_status", (q) =>
        q
          .eq("organizationKey", input.organizationKey)
          .eq("teamId", input.teamId)
          .eq("slackUserId", input.slackUserId)
          .eq("status", "active"),
      )
      .collect()
      .pipe(Effect.orDie);
    return (rows[0] as SlackIdentityBindingDoc | undefined) ?? null;
  });

const currentConnectionFor = (input: {
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly teamId: string;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("providerConnections")
      .index("by_connection_key", (q) =>
        q.eq("connectionKey", input.connectionKey),
      )
      .collect()
      .pipe(Effect.orDie);
    return rows.find(
      (row) =>
        row.status === "active" &&
        row.connectionGeneration === input.connectionGeneration &&
        row.teamId === input.teamId,
    );
  });

const revokeStaleConnectionBindings = (input: {
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly now: number;
  readonly reason: string;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const rows = (yield* slackIdentityBindingTable(reader)
      .index("by_connection_generation_status", (q) =>
        q
          .eq("connectionKey", input.connectionKey)
          .eq("connectionGeneration", input.connectionGeneration)
          .eq("status", "active"),
      )
      .collect()
      .pipe(Effect.orDie)).filter(
      (row) => row.connectionGeneration === input.connectionGeneration,
    );
    for (const row of rows) {
      yield* slackIdentityBindingTable(writer)
        .patch(row._id, {
          status: "revoked" as const,
          revokedAt: input.now,
          revokeReason: input.reason,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
    }
  });

const reauthorizePendingBindingOwner = (pending: SlackIdentityBindingDoc) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const users = yield* reader
      .table("users")
      .index("by_subject", (q) => q.eq("subject", pending.workosSubject))
      .collect()
      .pipe(Effect.orDie);
    const user = users.find(
      (row) => row._id === pending.userId && row.status === "active",
    );
    if (user === undefined)
      return yield* Effect.fail(
        new Forbidden({ reason: "Slack link owner is no longer active." }),
      );
    if (pending.workspaceId === undefined)
      return yield* Effect.fail(
        new Forbidden({ reason: "Slack link workspace is not bound." }),
      );
    const workspace = yield* reader
      .table("workspaces")
      .get(pending.workspaceId)
      .pipe(Effect.orDie);
    if (
      workspace.status !== "active" ||
      workspace.brainKey !== pending.brainKey
    )
      return yield* Effect.fail(
        new Forbidden({ reason: "Slack link workspace is no longer active." }),
      );
    const organization = yield* reader
      .table("organizations")
      .get(workspace.organizationId)
      .pipe(Effect.orDie);
    if (
      organization.status !== "active" ||
      organization.agencyKey !== pending.organizationKey
    )
      return yield* Effect.fail(
        new Forbidden({
          reason: "Slack link organization is no longer active.",
        }),
      );
    const membership = yield* activeMembershipFor({
      organizationId: organization._id,
      userId: pending.userId,
    });
    const workspaceMembers = yield* reader
      .table("workspaceMembers")
      .index("by_workspace_user", (q) =>
        q
          .eq("workspaceId", pending.workspaceId ?? "")
          .eq("userId", pending.userId),
      )
      .collect()
      .pipe(Effect.orDie);
    const workspaceRole = workspaceMembers.find(
      (row) =>
        row.status === "active" &&
        row.acceptedAt !== null &&
        row.revokedAt === null &&
        row.deletedAt === null,
    )?.role;
    if (
      membership === undefined ||
      !workspaceRole ||
      !roleAtLeast(workspaceRole, "editor")
    )
      return yield* Effect.fail(
        new Forbidden({ reason: "Slack link owner is no longer authorized." }),
      );
  });

const findByBindingKey = (bindingKey: string) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* slackIdentityBindingTable(reader)
      .index("by_binding_key", (q) => q.eq("bindingKey", bindingKey))
      .collect()
      .pipe(Effect.orDie);
    return (
      rows.find((row) => row.status === "active") ??
      (rows[0] as SlackIdentityBindingDoc | undefined) ??
      null
    );
