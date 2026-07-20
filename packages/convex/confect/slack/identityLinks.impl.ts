import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader, DatabaseWriter } from "../_generated/services";
import { asGenericId, loadCurrentUser } from "../access/handlerContext";
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
      .get(asGenericId<"workspaces">(pending.workspaceId))
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
      .get(asGenericId<"organizations">(workspace.organizationId))
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
  });

export const consumeSlackIdentityLinkPlan = (input: {
  readonly pending: SlackIdentityBinding | null;
  readonly existingActiveForSlackIdentity: SlackIdentityBinding | null;
  readonly confirmation: {
    readonly teamId: string;
    readonly slackUserId: string;
  };
  readonly now: number;
}): Either.Either<
  {
    readonly binding: SlackIdentityBinding;
    readonly patch: {
      readonly bindingKey: string;
      readonly slackUserId: string;
      readonly status: "active";
      readonly verifiedAt: number;
      readonly updatedAt: number;
    };
  },
  ConsumeError
> => {
  const pending = input.pending;
  if (pending === null) return Either.left(new LinkExpired());
  if (pending.status === "revoked") return Either.left(new BindingRevoked());
  if (pending.status !== "pending_verification")
    return Either.left(new LinkReplay());
  if (pending.intentExpiresAt < input.now)
    return Either.left(new LinkExpired());
  if (pending.teamId !== input.confirmation.teamId) {
    return Either.left(new TeamMismatch());
  }
  if (
    input.existingActiveForSlackIdentity !== null &&
    input.existingActiveForSlackIdentity.userId !== pending.userId
  ) {
    return Either.left(new SlackIdentityAlreadyBound(input.confirmation));
  }
  const patch = {
    bindingKey: bindingKeyFor({
      organizationKey: pending.organizationKey,
      teamId: input.confirmation.teamId,
      slackUserId: input.confirmation.slackUserId,
    }),
    slackUserId: input.confirmation.slackUserId,
    status: "active" as const,
    verifiedAt: input.now,
    updatedAt: input.now,
  };
  return Either.right({ binding: { ...pending, ...patch }, patch });
};

const createSlackIdentityLinkIntent = FunctionImpl.make(
  databaseSchema,
  slackIdentityLinks,
  "createSlackIdentityLinkIntent",
  (input) =>
    Effect.gen(function* () {
      const { connection, workspace, user, workosSubject } =
        yield* resolveAuthorizedConnection(input);
      const result = createSlackIdentityLinkIntentPlan({
        organizationKey: connection.organizationKey,
        connectionKey: connection.connectionKey,
        connectionGeneration: connection.connectionGeneration,
        teamId: input.teamId,
        workspaceId: workspace._id,
        brainKey: workspace.brainKey,
        userId: user._id,
        workosSubject,
        nonceHash: input.nonceHash,
        now: input.now,
      });
      if (Either.isLeft(result)) return yield* Effect.fail(result.left);
      const planned = result.right;
      const writer = yield* DatabaseWriter;
      yield* slackIdentityBindingTable(writer)
        .insert(planned.row)
        .pipe(Effect.orDie);
      return {
        bindingKey: planned.row.bindingKey,
        status: "pending_verification" as const,
        teamId: planned.row.teamId,
        expiresAt: planned.row.intentExpiresAt,
        linkToken: planned.linkToken,
      };
    }),
);

const consumeSlackIdentityLink = FunctionImpl.make(
  databaseSchema,
  slackIdentityLinks,
  "consumeSlackIdentityLink",
  (input) =>
    Effect.gen(function* () {
      const pending = yield* findByNonceHash(input.nonceHash);
      const existingActiveForSlackIdentity =
        pending === null
          ? null
          : yield* findActiveSlackIdentity({
              organizationKey: pending.organizationKey,
              teamId: input.teamId,
              slackUserId: input.slackUserId,
            });
      if (pending !== null) {
        const currentConnection = yield* currentConnectionFor({
          connectionKey: pending.connectionKey,
          connectionGeneration: pending.connectionGeneration,
          teamId: pending.teamId,
        });
        if (currentConnection === undefined) {
          yield* revokeStaleConnectionBindings({
            connectionKey: pending.connectionKey,
            connectionGeneration: pending.connectionGeneration,
            now: input.now,
            reason: "connection_replaced",
          });
          return yield* Effect.fail(new LinkExpired());
        }
        yield* reauthorizePendingBindingOwner(pending);
      }
      const result = consumeSlackIdentityLinkPlan({
        pending,
        existingActiveForSlackIdentity,
        confirmation: { teamId: input.teamId, slackUserId: input.slackUserId },
        now: input.now,
      });
      if (Either.isLeft(result)) return yield* Effect.fail(result.left);
      if (pending === null) return yield* Effect.fail(new LinkExpired());
      const writer = yield* DatabaseWriter;
      yield* slackIdentityBindingTable(writer)
        .patch(pending._id, result.right.patch)
        .pipe(Effect.orDie);
      return {
        bindingKey: result.right.binding.bindingKey,
        status: "active" as const,
        teamId: result.right.binding.teamId,
        slackUserId: result.right.binding.slackUserId,
        bindingGeneration: result.right.binding.bindingGeneration,
      };
    }),
);

const revokeSlackIdentityLink = FunctionImpl.make(
  databaseSchema,
  slackIdentityLinks,
  "revokeSlackIdentityLink",
  (input) =>
    Effect.gen(function* () {
      const binding = yield* findByBindingKey(input.bindingKey);
      if (binding === null || binding.status !== "active") {
        return yield* Effect.fail(new BindingRevoked());
      }
      const { user } = yield* resolveAuthorizedConnection({
        workspaceId: input.workspaceId,
        connectionKey: binding.connectionKey,
        connectionGeneration: binding.connectionGeneration,
        teamId: binding.teamId,
        brainKey: binding.brainKey,
        allowStaleConnection: true,
      });
      if (binding.userId !== user._id)
        return yield* new Forbidden({
          reason: "Slack binding belongs to another user.",
        });
      const writer = yield* DatabaseWriter;
      yield* slackIdentityBindingTable(writer)
        .patch(binding._id, {
          status: "revoked" as const,
          revokedAt: input.now,
          revokeReason: input.reason,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
      return {
        bindingKey: input.bindingKey,
        status: "revoked" as const,
        revokedAt: input.now,
      };
    }),
);

const revokeSlackIdentityLinksForLifecycle = FunctionImpl.make(
  databaseSchema,
  slackIdentityLinks,
  "revokeSlackIdentityLinksForLifecycle",
  (input) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const collectByUserStatus = (status: "active" | "pending_verification") =>
        slackIdentityBindingTable(reader)
          .index("by_organization_user_status", (q) =>
            q
              .eq("organizationKey", input.organizationKey)
              .eq("userId", input.userId ?? "")
              .eq("status", status),
          )
          .collect()
          .pipe(Effect.orDie);
      const collectByConnectionStatus = (
        status: "active" | "pending_verification",
      ) =>
        slackIdentityBindingTable(reader)
          .index("by_connection_generation_status", (q) =>
            q
              .eq("connectionKey", input.connectionKey ?? "")
              .eq("connectionGeneration", input.connectionGeneration ?? -1)
              .eq("status", status),
          )
          .collect()
          .pipe(Effect.orDie);
      const candidates =
        input.userId === undefined
          ? [
              ...(yield* collectByConnectionStatus("active")),
              ...(yield* collectByConnectionStatus("pending_verification")),
            ]
          : [
              ...(yield* collectByUserStatus("active")),
              ...(yield* collectByUserStatus("pending_verification")),
            ];
      let revokedCount = 0;
      for (const row of candidates.filter(
        (row) =>
          row.organizationKey === input.organizationKey &&
          (input.userId === undefined || row.userId === input.userId) &&
          (input.connectionKey === undefined ||
            row.connectionKey === input.connectionKey) &&
          (input.connectionGeneration === undefined ||
            row.connectionGeneration === input.connectionGeneration),
      )) {
        yield* slackIdentityBindingTable(writer)
          .patch(row._id, {
            status: "revoked" as const,
            revokedAt: input.now,
            revokeReason: input.reason,
            updatedAt: input.now,
          })
          .pipe(Effect.orDie);
        revokedCount += 1;
      }
      return { revokedCount };
    }),
);

export default GroupImpl.make(databaseSchema, slackIdentityLinks).pipe(
  Layer.provide(createSlackIdentityLinkIntent),
  Layer.provide(consumeSlackIdentityLink),
  Layer.provide(revokeSlackIdentityLink),
  Layer.provide(revokeSlackIdentityLinksForLifecycle),
  GroupImpl.finalize,
);
