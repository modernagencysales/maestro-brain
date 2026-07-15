import { Ref } from "@confect/core";
import {
  ConnectSessionInvalid as NangoConnectSessionInvalid,
  ProviderUnavailable as NangoProviderUnavailable,
  createFakeNangoClient,
} from "@maestro-template/integrations/nango/client";
import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import {
  Auth,
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
} from "../_generated/services";
import { asGenericId } from "../access/handlerContext";
import { roleAtLeast, type Role } from "../access/roles";
import { Forbidden, Unauthorized } from "../errors";
import slackConnections, {
  ConnectSessionInvalid,
  ConnectionAlreadyExists,
  ProviderUnavailable,
  TenantMismatch,
} from "./slackConnections.spec";

export type SlackConnectionStatus =
  | "not_connected"
  | "authorizing"
  | "verifying"
  | "active"
  | "error"
  | "reauthorizing";

export type SlackPrincipal = {
  readonly organizationKey: string;
  readonly role: Role;
};

export type SlackConnectionState = {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly status: SlackConnectionStatus;
  readonly nangoConnectionId?: string;
};

export type PendingSlackConnect = {
  readonly organizationKey: string;
  readonly connectSessionId: string;
  readonly connectSessionToken: string;
  readonly expiresAt: number;
  readonly providerConfigKey: "slack";
  readonly nangoEndUserId: string;
  readonly nangoOrganizationId: string;
  readonly correlationTag: string;
  readonly attemptId: string;
};

type SlackConnectionError =
  | Unauthorized
  | Forbidden
  | ConnectionAlreadyExists
  | ConnectSessionInvalid
  | ProviderUnavailable
  | TenantMismatch;

type ProviderConnectionRow = {
  readonly _id: GenericId<"providerConnections">;
  readonly provider: "nango";
  readonly providerConfigKey: "slack";
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly status:
    | "authorizing"
    | "verifying"
    | "active"
    | "error"
    | "reauthorizing"
    | "revoked";
  readonly connectSessionId: string;
  readonly nangoConnectionId?: string | null | undefined;
  readonly nangoEndUserId: string;
  readonly nangoOrganizationId: string;
  readonly correlationTag: string;
  readonly attemptId: string;
  readonly attemptExpiresAt: number;
  readonly completedAt?: number | null | undefined;
};

type RawIndexBuilder = {
  readonly eq: (field: string, value: unknown) => RawIndexBuilder;
};
type RawQuery = {
  readonly index: (
    name: string,
    range: (builder: RawIndexBuilder) => RawIndexBuilder,
  ) => RawQuery;
  readonly first: () => Effect.Effect<Option.Option<unknown>, unknown>;
  readonly take: (count: number) => Effect.Effect<readonly unknown[], unknown>;
};
type RawReader = {
  readonly table: (name: "providerConnections") => RawQuery;
};
type RawWriter = {
  readonly table: (name: "providerConnections") => {
    readonly insert: (
      row: Record<string, unknown>,
    ) => Effect.Effect<unknown, unknown>;
    readonly patch: (
      id: GenericId<"providerConnections">,
      patch: Record<string, unknown>,
    ) => Effect.Effect<unknown, unknown>;
  };
};
const providerReader = (reader: unknown): RawReader => reader as RawReader;
const providerWriter = (writer: unknown): RawWriter => writer as RawWriter;

const requireAdmin = (
  principal: SlackPrincipal | null,
): Either.Either<SlackPrincipal, Unauthorized | Forbidden> => {
  if (principal === null) return Either.left(new Unauthorized());
  if (!roleAtLeast(principal.role, "admin")) {
    return Either.left(
      new Forbidden({
        reason: "Slack connections require organization admin.",
      }),
    );
  }
  return Either.right(principal);
};

const isSecretShaped = (value: string): boolean =>
  /^(sk_|xox[a-z]-|nango_secret)/i.test(value);
const connectionKeyFor = (organizationKey: string) =>
  `slack_${organizationKey}`;
const attemptIdFor = (organizationKey: string, now: number) =>
  `attempt_${organizationKey}_${now}`;
const correlationTagFor = (organizationKey: string, now: number) =>
  `slack-connect:${organizationKey}:${now}`;

export const beginSlackConnectPlan = (input: {
  readonly principal: SlackPrincipal | null;
  readonly existingConnection: SlackConnectionState | null;
  readonly now: number;
}): Either.Either<PendingSlackConnect, SlackConnectionError> =>
  Either.gen(function* () {
    const principal = yield* requireAdmin(input.principal);
    if (input.existingConnection?.status === "active") {
      return yield* Either.left(
        new ConnectionAlreadyExists({
          organizationKey: principal.organizationKey,
        }),
      );
    }
    return {
      organizationKey: principal.organizationKey,
      connectSessionId: `cs_${principal.organizationKey}_${input.now}`,
      connectSessionToken: `connect_public_${principal.organizationKey}_${input.now}`,
      expiresAt: input.now + 300_000,
      providerConfigKey: "slack" as const,
      nangoEndUserId: principal.organizationKey,
      nangoOrganizationId: principal.organizationKey,
      correlationTag: correlationTagFor(principal.organizationKey, input.now),
      attemptId: attemptIdFor(principal.organizationKey, input.now),
    };
  });

export const completeSlackConnectPlan = (input: {
  readonly principal: SlackPrincipal | null;
  readonly pending: PendingSlackConnect | null;
  readonly connectionId: string;
  readonly connectSessionId: string;
  readonly providerOrganizationKey: string;
}): Either.Either<
  {
    readonly connectionKey: string;
    readonly status: "verifying";
    readonly connectionGeneration: number;
  },
  SlackConnectionError
> =>
  Either.gen(function* () {
    const principal = yield* requireAdmin(input.principal);
    if (
      input.pending === null ||
      input.pending.connectSessionId !== input.connectSessionId ||
      isSecretShaped(input.connectionId) ||
      !input.connectionId.startsWith("conn_")
    ) {
      return yield* Either.left(new ConnectSessionInvalid());
    }
    if (
      input.pending.organizationKey !== principal.organizationKey ||
      input.providerOrganizationKey !== principal.organizationKey
    ) {
      return yield* Either.left(new TenantMismatch());
    }
    return {
      connectionKey: connectionKeyFor(principal.organizationKey),
      status: "verifying" as const,
      connectionGeneration: 0,
    };
  });

const internalMutationRef = (name: keyof typeof slackConnections.functions) =>
  Ref.make(
    "integrations/slackConnections",
    slackConnections.functions[name]!,
  ) as Ref.AnyMutation;

const generatedRefs = {
  internal: {
    integrations: {
      slackConnections: {
        prepareSlackConnectAttempt: internalMutationRef(
          "prepareSlackConnectAttempt",
        ),
        reserveSlackConnectAttempt: internalMutationRef(
          "reserveSlackConnectAttempt",
        ),
        claimSlackConnectAttempt: internalMutationRef(
          "claimSlackConnectAttempt",
        ),
        finalizeSlackConnectAttempt: internalMutationRef(
          "finalizeSlackConnectAttempt",
        ),
      },
    },
  },
};

const activeConnectionFor = (organizationKey: string) =>
  Effect.gen(function* () {
    const rows = yield* providerReader(yield* DatabaseReader)
      .table("providerConnections")
      .index("by_organization_provider_status", (q) =>
        q
          .eq("organizationKey", organizationKey)
          .eq("provider", "nango")
          .eq("providerConfigKey", "slack")
          .eq("status", "active"),
      )
      .take(2)
      .pipe(Effect.orDie);
    return (rows[0] ?? null) as ProviderConnectionRow | null;
  });

const prepareSlackConnectAttempt = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "prepareSlackConnectAttempt",
  (input) =>
    Effect.gen(function* () {
      const auth = yield* Auth;
      const identity = yield* auth.getUserIdentity.pipe(
        Effect.mapError(() => new Unauthorized()),
      );
      if (identity === null) return yield* Effect.fail(new Unauthorized());
      const subject = identity.subject ?? identity.tokenIdentifier;
      if (subject === undefined || subject.trim().length === 0) {
        return yield* Effect.fail(new Unauthorized());
      }
      const user = yield* (yield* DatabaseReader)
        .table("users")
        .index("by_subject", (q) => q.eq("subject", subject.trim()))
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (user === null) {
        return yield* Effect.fail(
          new Forbidden({ reason: "Provisioned user required." }),
        );
      }
      const membership = yield* (yield* DatabaseReader)
        .table("organizationMembers")
        .index("by_user", (q) => q.eq("userId", user._id))
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        membership === null ||
        membership.status !== "active" ||
        !roleAtLeast(membership.role, "admin")
      ) {
        return yield* Effect.fail(
          new Forbidden({
            reason: "Slack connections require organization admin.",
          }),
        );
      }
      const organization = yield* (yield* DatabaseReader)
        .table("organizations")
        .get(asGenericId<"organizations">(membership.organizationId))
        .pipe(Effect.orDie);
      if (
        organization === null ||
        organization.status !== "active" ||
        organization.agencyKey === undefined
      ) {
        return yield* Effect.fail(
          new Forbidden({ reason: "Active organization required." }),
        );
      }
      const active = yield* activeConnectionFor(organization.agencyKey);
      if (active !== null) {
        return yield* Effect.fail(
          new ConnectionAlreadyExists({
            organizationKey: organization.agencyKey,
          }),
        );
      }
      return {
        organizationKey: organization.agencyKey,
        connectionKey: connectionKeyFor(organization.agencyKey),
        nangoEndUserId: organization.agencyKey,
        nangoOrganizationId: organization.agencyKey,
        providerConfigKey: "slack" as const,
        correlationTag: correlationTagFor(organization.agencyKey, input.now),
        attemptId: attemptIdFor(organization.agencyKey, input.now),
      };
    }),
);

const reserveSlackConnectAttempt = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "reserveSlackConnectAttempt",
  (input) =>
    Effect.gen(function* () {
      const active = yield* activeConnectionFor(input.organizationKey);
      if (active !== null) {
        return yield* Effect.fail(
          new ConnectionAlreadyExists({
            organizationKey: input.organizationKey,
          }),
        );
      }
      const bySession = yield* providerReader(yield* DatabaseReader)
        .table("providerConnections")
        .index("by_connect_session", (q) =>
          q.eq("connectSessionId", input.connectSessionId),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (bySession !== null) {
        return {
          connectionKey: (bySession as ProviderConnectionRow).connectionKey,
        };
      }
      yield* providerWriter(yield* DatabaseWriter)
        .table("providerConnections")
        .insert({
          provider: "nango",
          providerConfigKey: input.providerConfigKey,
          organizationKey: input.organizationKey,
          connectionKey: input.connectionKey,
          connectionGeneration: 0,
          status: "authorizing",
          connectSessionId: input.connectSessionId,
          nangoEndUserId: input.nangoEndUserId,
          nangoOrganizationId: input.nangoOrganizationId,
          correlationTag: input.correlationTag,
          attemptId: input.attemptId,
          attemptExpiresAt: input.attemptExpiresAt,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
      return { connectionKey: input.connectionKey };
    }),
);

const claimSlackConnectAttempt = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "claimSlackConnectAttempt",
  (input) =>
    Effect.gen(function* () {
      if (
        isSecretShaped(input.connectionId) ||
        !input.connectionId.startsWith("conn_")
      ) {
        return yield* Effect.fail(new ConnectSessionInvalid());
      }
      const row = (yield* providerReader(yield* DatabaseReader)
        .table("providerConnections")
        .index("by_connect_session", (q) =>
          q.eq("connectSessionId", input.connectSessionId),
        )
        .first()
        .pipe(
          Effect.map(Option.getOrNull),
          Effect.orDie,
        )) as ProviderConnectionRow | null;
      if (row === null || row.attemptExpiresAt <= input.now) {
        return yield* Effect.fail(new ConnectSessionInvalid());
      }
      if (
        row.organizationKey !== input.providerOrganizationKey ||
        row.nangoEndUserId !== input.providerEndUserId ||
        row.nangoOrganizationId !== input.providerOrganizationKey ||
        row.providerConfigKey !== input.providerConfigKey ||
        row.correlationTag !== input.correlationTag
      ) {
        return yield* Effect.fail(new TenantMismatch());
      }
      if (
        row.status === "verifying" &&
        row.nangoConnectionId === input.connectionId
      ) {
        return {
          connectionKey: row.connectionKey,
          status: "verifying" as const,
        };
      }
      if (
        row.status !== "authorizing" ||
        (row.nangoConnectionId !== undefined &&
          row.nangoConnectionId !== input.connectionId)
      ) {
        return yield* Effect.fail(new ConnectSessionInvalid());
      }
      yield* providerWriter(yield* DatabaseWriter)
        .table("providerConnections")
        .patch(row._id, {
          status: "verifying",
          nangoConnectionId: input.connectionId,
          completedAt: input.now,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
      return { connectionKey: row.connectionKey, status: "verifying" as const };
    }),
);

const finalizeSlackConnectAttempt = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "finalizeSlackConnectAttempt",
  (input) =>
    Effect.gen(function* () {
      const row = (yield* providerReader(yield* DatabaseReader)
        .table("providerConnections")
        .index("by_connect_session", (q) =>
          q.eq("connectSessionId", input.connectSessionId),
        )
        .first()
        .pipe(
          Effect.map(Option.getOrNull),
          Effect.orDie,
        )) as ProviderConnectionRow | null;
      if (
        row === null ||
        row.nangoConnectionId !== input.connectionId ||
        row.status !== "verifying"
      ) {
        return yield* Effect.fail(new ConnectSessionInvalid());
      }
      return { connectionKey: row.connectionKey, status: "verifying" as const };
    }),
);

const mapNangoError = (error: unknown): SlackConnectionError => {
  if (error instanceof NangoConnectSessionInvalid)
    return new ConnectSessionInvalid();
  if (error instanceof NangoProviderUnavailable)
    return new ProviderUnavailable();
  return new ProviderUnavailable();
};

const beginSlackConnect = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "beginSlackConnect",
  () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const runMutation = yield* MutationRunner;
      const attempt = yield* runMutation(
        generatedRefs.internal.integrations.slackConnections
          .prepareSlackConnectAttempt,
        { now },
      );
      const nango = createFakeNangoClient({ now });
      const session = yield* Effect.tryPromise({
        try: () =>
          nango.createConnectSession({
            organizationKey: attempt.organizationKey,
            endUserId: attempt.nangoEndUserId,
            providerConfigKey: attempt.providerConfigKey,
            correlationTag: attempt.correlationTag,
          }),
        catch: mapNangoError,
      });
      yield* runMutation(
        generatedRefs.internal.integrations.slackConnections
          .reserveSlackConnectAttempt,
        {
          connectSessionId: session.connectSessionId,
          organizationKey: attempt.organizationKey,
          connectionKey: attempt.connectionKey,
          nangoEndUserId: attempt.nangoEndUserId,
          nangoOrganizationId: attempt.nangoOrganizationId,
          providerConfigKey: attempt.providerConfigKey,
          correlationTag: attempt.correlationTag,
          attemptId: attempt.attemptId,
          attemptExpiresAt: session.expiresAt,
          now,
        },
      );
      return session;
    }),
);

const completeSlackConnect = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "completeSlackConnect",
  (input) =>
    Effect.gen(function* () {
      if (isSecretShaped(input.connectionId)) {
        return yield* Effect.fail(new ConnectSessionInvalid());
      }
      const now = yield* Clock.currentTimeMillis;
      const nango = createFakeNangoClient({ now });
      const metadata = yield* Effect.tryPromise({
        try: () =>
          nango.verifyConnectSession({
            connectSessionId: input.connectSessionId,
            connectionId: input.connectionId,
          }),
        catch: mapNangoError,
      });
      const runMutation = yield* MutationRunner;
      yield* runMutation(
        generatedRefs.internal.integrations.slackConnections
          .claimSlackConnectAttempt,
        {
          connectSessionId: input.connectSessionId,
          connectionId: input.connectionId,
          providerOrganizationKey: metadata.organizationKey,
          providerEndUserId: metadata.endUserId,
          providerConfigKey: metadata.providerConfigKey,
          correlationTag: metadata.correlationTag,
          now,
        },
      );
      return yield* runMutation(
        generatedRefs.internal.integrations.slackConnections
          .finalizeSlackConnectAttempt,
        {
          connectSessionId: input.connectSessionId,
          connectionId: input.connectionId,
          now,
        },
      );
    }),
);

export default GroupImpl.make(databaseSchema, slackConnections).pipe(
  Layer.provide(beginSlackConnect),
  Layer.provide(completeSlackConnect),
  Layer.provide(prepareSlackConnectAttempt),
  Layer.provide(reserveSlackConnectAttempt),
  Layer.provide(claimSlackConnectAttempt),
  Layer.provide(finalizeSlackConnectAttempt),
  GroupImpl.finalize,
);
