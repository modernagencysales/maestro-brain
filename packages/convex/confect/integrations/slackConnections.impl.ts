import { Ref } from "@confect/core";
import {
  ConnectSessionInvalid as NangoConnectSessionInvalid,
  ProviderUnavailable as NangoProviderUnavailable,
  createNangoProviderLayer,
  NangoProvider,
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

export type ProviderConnectionRow = {
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

const sessionIdPattern = /^maestro-session-[A-Za-z0-9_-]{22,}$/;

const opaqueNangoOrganizationIdFor = (nonce: string) =>
  `nango-org-${nonce.slice(-7)}`;
const opaqueNangoEndUserIdFor = (nonce: string) =>
  `nango-user-${nonce.slice(-7)}`;
const attemptIdFor = (connectSessionId: string) =>
  `attempt_${connectSessionId.replace(/^maestro-session-/, "")}`;
const connectSessionIdFor = (nonce: string) => `maestro-session-${nonce}`;
const correlationTagFor = (connectSessionId: string) =>
  `slack-connect:${connectSessionId}`;

export type SlackOrganizationMembership = {
  readonly organizationId: string;
  readonly role: Role;
  readonly status: string;
};

export type SlackOrganizationRecord = {
  readonly _id: unknown;
  readonly agencyKey?: string | undefined;
  readonly status: string;
  readonly workosOrganizationId?: string | undefined;
};

export const selectCurrentSlackOrganization = (input: {
  readonly memberships: readonly SlackOrganizationMembership[];
  readonly organizationsById: ReadonlyMap<string, SlackOrganizationRecord>;
  readonly currentWorkosOrganizationId?: string | undefined;
}): Either.Either<SlackOrganizationRecord, Forbidden> => {
  const candidates = input.memberships
    .filter(
      (membership) =>
        membership.status === "active" && roleAtLeast(membership.role, "admin"),
    )
    .map((membership) => input.organizationsById.get(membership.organizationId))
    .filter(
      (organization): organization is SlackOrganizationRecord =>
        organization !== undefined &&
        organization.status === "active" &&
        organization.agencyKey !== undefined,
    );
  const current =
    input.currentWorkosOrganizationId === undefined
      ? candidates[0]
      : candidates.find(
          (organization) =>
            organization.workosOrganizationId ===
            input.currentWorkosOrganizationId,
        );
  if (current === undefined) {
    return Either.left(
      new Forbidden({
        reason: "Slack connections require organization admin.",
      }),
    );
  }
  return Either.right(current);
};

export const makeSlackConnectAttemptIds = (input: {
  readonly organizationKey: string;
  readonly nonce: string;
  readonly now: number;
}) => {
  const connectSessionId = connectSessionIdFor(input.nonce);
  return {
    connectSessionId,
    nangoEndUserId: opaqueNangoEndUserIdFor(input.nonce),
    nangoOrganizationId: opaqueNangoOrganizationIdFor(input.nonce),
    correlationTag: correlationTagFor(connectSessionId),
    attemptId: attemptIdFor(connectSessionId),
  };
};

export const validateOpaqueSlackConnectIds = (input: {
  readonly connectSessionId: string;
  readonly nangoEndUserId: string;
  readonly nangoOrganizationId: string;
  readonly correlationTag: string;
  readonly organizationKey: string;
}): boolean =>
  sessionIdPattern.test(input.connectSessionId) &&
  !input.connectSessionId.includes(input.organizationKey) &&
  !input.nangoEndUserId.includes(input.organizationKey) &&
  !input.nangoOrganizationId.includes(input.organizationKey) &&
  input.correlationTag === correlationTagFor(input.connectSessionId);

export const beginSlackConnectPlan = (input: {
  readonly principal: SlackPrincipal | null;
  readonly existingConnection: SlackConnectionState | null;
  readonly now: number;
  readonly nonce?: string;
}): Either.Either<PendingSlackConnect, SlackConnectionError> =>
  Either.gen(function* () {
    const principal = yield* requireAdmin(input.principal);
    if (
      input.existingConnection !== null &&
      input.existingConnection.status !== "active"
    ) {
      return yield* Either.left(
        new ConnectionAlreadyExists({
          organizationKey: principal.organizationKey,
        }),
      );
    }
    const ids = makeSlackConnectAttemptIds({
      organizationKey: principal.organizationKey,
      nonce: input.nonce ?? `local-${input.now}-fallback-nonce`,
      now: input.now,
    });
    return {
      organizationKey: principal.organizationKey,
      connectSessionToken: `connect_public_${ids.connectSessionId}`,
      expiresAt: input.now + 300_000,
      providerConfigKey: "slack" as const,
      ...ids,
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
      input.connectionId.trim().length === 0
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

export const reserveSlackConnectAttemptPlan = (input: {
  readonly organizationKey: string;
  readonly connectSessionId: string;
  readonly currentConnection: ProviderConnectionRow | null;
}): Either.Either<
  { readonly status: "insert" | "idempotent" | "reauthorize" },
  ConnectionAlreadyExists
> => {
  const current = input.currentConnection;
  if (current === null) return Either.right({ status: "insert" as const });
  if (current.connectSessionId === input.connectSessionId) {
    return Either.right({ status: "idempotent" as const });
  }
  if (current.status === "active") {
    return Either.right({ status: "reauthorize" as const });
  }
  return Either.left(
    new ConnectionAlreadyExists({ organizationKey: input.organizationKey }),
  );
};

export const finalizeSlackConnectAttemptPlan = (input: {
  readonly row: ProviderConnectionRow | null;
  readonly connectionId: string;
  readonly expectedConnectionGeneration: number;
  readonly now: number;
}): Either.Either<
  {
    readonly connectionKey: string;
    readonly status: "verifying";
    readonly rowId: GenericId<"providerConnections">;
    readonly patch: {
      readonly status: "verifying";
      readonly nangoConnectionId: string;
      readonly completedAt: number;
      readonly updatedAt: number;
    };
  },
  ConnectSessionInvalid
> => {
  const row = input.row;
  if (
    row === null ||
    row.connectionGeneration !== input.expectedConnectionGeneration ||
    (row.status !== "authorizing" && row.status !== "reauthorizing") ||
    (row.nangoConnectionId !== undefined &&
      row.nangoConnectionId !== null &&
      row.nangoConnectionId !== input.connectionId)
  ) {
    return Either.left(new ConnectSessionInvalid());
  }
  return Either.right({
    rowId: row._id,
    connectionKey: row.connectionKey,
    status: "verifying" as const,
    patch: {
      status: "verifying" as const,
      nangoConnectionId: input.connectionId,
      completedAt: input.now,
      updatedAt: input.now,
    },
  });
};

const internalMutationRef = (name: keyof typeof slackConnections.functions) => {
  const mutation = slackConnections.functions[
    name
  ] as (typeof slackConnections.functions)[typeof name];
  return Ref.make("integrations/slackConnections", mutation) as Ref.AnyMutation;
};

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
        authorizeSlackConnectCompletion: internalMutationRef(
          "authorizeSlackConnectCompletion",
        ),
        finalizeSlackConnectAttempt: internalMutationRef(
          "finalizeSlackConnectAttempt",
        ),
      },
    },
  },
};

const currentConnectionFor = (organizationKey: string) =>
  Effect.gen(function* () {
    const rows = yield* providerReader(yield* DatabaseReader)
      .table("providerConnections")
      .index("by_organization", (q) => q.eq("organizationKey", organizationKey))
      .take(20)
      .pipe(Effect.orDie);
    return (
      (rows as readonly ProviderConnectionRow[]).find(
        (row) =>
          row.provider === "nango" &&
          row.providerConfigKey === "slack" &&
          row.status !== "revoked" &&
          row.status !== "error",
      ) ?? null
    );
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
      const memberships = yield* (yield* DatabaseReader)
        .table("organizationMembers")
        .index("by_user", (q) => q.eq("userId", user._id))
        .take(10)
        .pipe(Effect.orDie);
      const organizations = new Map<string, SlackOrganizationRecord>();
      for (const membership of memberships) {
        const organization = yield* (yield* DatabaseReader)
          .table("organizations")
          .get(asGenericId<"organizations">(membership.organizationId))
          .pipe(Effect.orDie);
        if (organization !== null) {
          organizations.set(membership.organizationId, organization);
        }
      }
      const organization = yield* selectCurrentSlackOrganization({
        memberships,
        organizationsById: organizations,
        ...(typeof identity.workosOrganizationId === "string"
          ? { currentWorkosOrganizationId: identity.workosOrganizationId }
          : {}),
      });
      const organizationKey = organization.agencyKey;
      if (organizationKey === undefined) {
        return yield* Effect.fail(
          new Forbidden({ reason: "Active organization required." }),
        );
      }
      const current = yield* currentConnectionFor(organizationKey);
      if (current !== null && current.status !== "active") {
        return yield* Effect.fail(
          new ConnectionAlreadyExists({ organizationKey }),
        );
      }
      const ids = makeSlackConnectAttemptIds({
        organizationKey,
        nonce: input.nonce,
        now: input.now,
      });
      return {
        organizationKey,
        connectionKey: connectionKeyFor(organizationKey),
        providerConfigKey: "slack" as const,
        ...ids,
      };
    }),
);

const reserveSlackConnectAttempt = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "reserveSlackConnectAttempt",
  (input) =>
    Effect.gen(function* () {
      const current = yield* currentConnectionFor(input.organizationKey);
      const reservation = reserveSlackConnectAttemptPlan({
        organizationKey: input.organizationKey,
        connectSessionId: input.connectSessionId,
        currentConnection: current,
      });
      if (Either.isLeft(reservation))
        return yield* Effect.fail(reservation.left);
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
      if (current?.status === "active") {
        yield* providerWriter(yield* DatabaseWriter)
          .table("providerConnections")
          .patch(current._id, {
            status: "reauthorizing",
            connectSessionId: input.connectSessionId,
            nangoConnectionId: null,
            nangoEndUserId: input.nangoEndUserId,
            nangoOrganizationId: input.nangoOrganizationId,
            correlationTag: input.correlationTag,
            attemptId: input.attemptId,
            attemptExpiresAt: input.attemptExpiresAt,
            completedAt: null,
            updatedAt: input.now,
          })
          .pipe(Effect.orDie);
        return { connectionKey: current.connectionKey };
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
      if (isSecretShaped(input.connectionId)) {
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
        (row.status !== "authorizing" && row.status !== "reauthorizing") ||
        (row.nangoConnectionId !== undefined &&
          row.nangoConnectionId !== null &&
          row.nangoConnectionId !== input.connectionId)
      ) {
        return yield* Effect.fail(new ConnectSessionInvalid());
      }
      return { connectionKey: row.connectionKey, status: "verifying" as const };
    }),
);

const authorizeSlackConnectCompletion = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "authorizeSlackConnectCompletion",
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
      const memberships = yield* (yield* DatabaseReader)
        .table("organizationMembers")
        .index("by_user", (q) => q.eq("userId", user._id))
        .take(10)
        .pipe(Effect.orDie);
      const organizations = new Map<string, SlackOrganizationRecord>();
      for (const membership of memberships) {
        const organization = yield* (yield* DatabaseReader)
          .table("organizations")
          .get(asGenericId<"organizations">(membership.organizationId))
          .pipe(Effect.orDie);
        if (organization !== null) {
          organizations.set(membership.organizationId, organization);
        }
      }
      const current = yield* selectCurrentSlackOrganization({
        memberships,
        organizationsById: organizations,
        ...(typeof identity.workosOrganizationId === "string"
          ? { currentWorkosOrganizationId: identity.workosOrganizationId }
          : {}),
      });
      if (current.agencyKey !== row.organizationKey) {
        return yield* Effect.fail(new TenantMismatch());
      }
      return {
        organizationKey: row.organizationKey,
        connectionGeneration: row.connectionGeneration,
      };
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
      const result = finalizeSlackConnectAttemptPlan({
        row,
        connectionId: input.connectionId,
        expectedConnectionGeneration: input.expectedConnectionGeneration,
        now: input.now,
      });
      if (Either.isLeft(result)) return yield* Effect.fail(result.left);
      yield* providerWriter(yield* DatabaseWriter)
        .table("providerConnections")
        .patch(result.right.rowId, result.right.patch)
        .pipe(Effect.orDie);
      return {
        connectionKey: result.right.connectionKey,
        status: result.right.status,
      };
    }),
);

const mapNangoError = (error: unknown): SlackConnectionError => {
  if (error instanceof NangoConnectSessionInvalid)
    return new ConnectSessionInvalid();
  if (error instanceof NangoProviderUnavailable)
    return new ProviderUnavailable();
  return new ProviderUnavailable();
};

const nangoProviderMode =
  process.env.NANGO_PROVIDER_MODE === "live" ? "live" : "test";
const loadNangoProvider = NangoProvider.pipe(
  Effect.provide(
    createNangoProviderLayer({
      mode: nangoProviderMode,
      env: process.env,
    }),
  ),
);

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
        { now, nonce: crypto.randomUUID().replace(/-/g, "") },
      );
      const nango = (yield* loadNangoProvider).clientFor({ now });
      const session = yield* Effect.tryPromise({
        try: () =>
          nango.createConnectSession({
            organizationKey: attempt.organizationKey,
            endUserId: attempt.nangoEndUserId,
            providerConfigKey: attempt.providerConfigKey,
            correlationTag: attempt.correlationTag,
            connectSessionId: attempt.connectSessionId,
          }),
        catch: mapNangoError,
      });
      yield* runMutation(
        generatedRefs.internal.integrations.slackConnections
          .reserveSlackConnectAttempt,
        {
          connectSessionId: attempt.connectSessionId,
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
      const runMutation = yield* MutationRunner;
      const authorization = yield* runMutation(
        generatedRefs.internal.integrations.slackConnections
          .authorizeSlackConnectCompletion,
        { connectSessionId: input.connectSessionId, now },
      );
      const nango = (yield* loadNangoProvider).clientFor({ now });
      const metadata = yield* Effect.tryPromise({
        try: () =>
          nango.verifyConnectSession({
            connectSessionId: input.connectSessionId,
            connectionId: input.connectionId,
          }),
        catch: mapNangoError,
      });
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
      const finalized = yield* runMutation(
        generatedRefs.internal.integrations.slackConnections
          .finalizeSlackConnectAttempt,
        {
          connectSessionId: input.connectSessionId,
          connectionId: input.connectionId,
          expectedConnectionGeneration: authorization.connectionGeneration,
          now,
        },
      );
      return {
        ...finalized,
        connectionGeneration: authorization.connectionGeneration,
      };
    }),
);

export default GroupImpl.make(databaseSchema, slackConnections).pipe(
  Layer.provide(beginSlackConnect),
  Layer.provide(completeSlackConnect),
  Layer.provide(prepareSlackConnectAttempt),
  Layer.provide(reserveSlackConnectAttempt),
  Layer.provide(claimSlackConnectAttempt),
  Layer.provide(authorizeSlackConnectCompletion),
  Layer.provide(finalizeSlackConnectAttempt),
  GroupImpl.finalize,
);
