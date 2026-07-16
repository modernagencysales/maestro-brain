import { Ref } from "@confect/core";
import {
  ConnectSessionInvalid as NangoConnectSessionInvalid,
  ProviderUnavailable as NangoProviderUnavailable,
  createNangoProviderLayer,
  isUnsafeNangoConnectionId,
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
import { extractIdentityProfile } from "../access/provisioning";
import { roleAtLeast, type Role } from "../access/roles";
import { Forbidden, Unauthorized } from "../errors";
import slackConnections, {
  authorizeSlackConnectCompletion as authorizeSlackConnectCompletionSpec,
  claimSlackConnectAttempt as claimSlackConnectAttemptSpec,
  ConnectSessionInvalid,
  ConnectionAlreadyExists,
  finalizeSlackConnectAttempt as finalizeSlackConnectAttemptSpec,
  markSlackConnectAttemptFailed as markSlackConnectAttemptFailedSpec,
  prepareSlackConnectAttempt as prepareSlackConnectAttemptSpec,
  ProviderUnavailable,
  reconcileSlackConnectSessionExpiry as reconcileSlackConnectSessionExpirySpec,
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
  readonly _creationTime?: number;
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
  readonly teamId?: string | null | undefined;
  readonly apiAppId?: string | null | undefined;
  readonly botUserId?: string | null | undefined;
};

type RawIndexBuilder = {
  readonly eq: (field: string, value: unknown) => RawIndexBuilder;
};
type RawQuery = {
  readonly index: (
    name: string,
    range: (builder: RawIndexBuilder) => RawIndexBuilder,
  ) => RawQuery;
  readonly get: (
    id: GenericId<string>,
  ) => Effect.Effect<unknown | null, unknown>;
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

const isSecretShaped = isUnsafeNangoConnectionId;
const connectionKeyFor = (organizationKey: string) =>
  `slack_${organizationKey}`;

export const extractSlackIdentityProfile = (
  claims: Parameters<typeof extractIdentityProfile>[0],
) =>
  extractIdentityProfile(claims).pipe(
    Effect.mapError(() => new Unauthorized()),
  );

const sessionIdPattern = /^maestro-session-[A-Za-z0-9_-]{22,}$/;

const opaqueNangoOrganizationIdFor = (nonce: string) =>
  `nango-org-slack-${nonce}`;
const opaqueNangoEndUserIdFor = (nonce: string) => `nango-user-slack-${nonce}`;
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
      ? undefined
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
  readonly now: number;
}): Either.Either<
  { readonly status: "insert" | "idempotent" | "reauthorize" | "takeover" },
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
  if (current.status === "error" || current.attemptExpiresAt <= input.now) {
    return Either.right({ status: "takeover" as const });
  }
  return Either.left(
    new ConnectionAlreadyExists({ organizationKey: input.organizationKey }),
  );
};

export const slackConnectAttemptGenerationFor = (input: {
  readonly currentConnection: ProviderConnectionRow | null;
}): number => input.currentConnection?.connectionGeneration ?? 0;

export const slackConnectAttemptStatusFor = (input: {
  readonly currentConnection: ProviderConnectionRow | null;
}): "authorizing" | "reauthorizing" => {
  const row = input.currentConnection;
  if (row === null) return "authorizing";
  const hasEstablishedBinding =
    row.connectionGeneration > 0 ||
    row.teamId !== undefined ||
    row.apiAppId !== undefined ||
    row.botUserId !== undefined ||
    (row.nangoConnectionId !== undefined && row.nangoConnectionId !== null);
  return hasEstablishedBinding ? "reauthorizing" : "authorizing";
};

export const reconcileSlackConnectSessionExpiryPlan = (input: {
  readonly row: ProviderConnectionRow | null;
  readonly attemptId: string;
  readonly expectedConnectionGeneration: number;
  readonly providerExpiresAt: number;
  readonly localMaxExpiresAt: number;
  readonly now: number;
}): Either.Either<
  {
    readonly rowId: GenericId<"providerConnections">;
    readonly connectionKey: string;
    readonly attemptExpiresAt: number;
  },
  ConnectSessionInvalid | ProviderUnavailable
> => {
  const row = input.row;
  if (
    row === null ||
    row.attemptId !== input.attemptId ||
    row.connectionGeneration !== input.expectedConnectionGeneration ||
    (row.status !== "authorizing" && row.status !== "reauthorizing")
  ) {
    return Either.left(new ConnectSessionInvalid());
  }
  if (
    !Number.isFinite(input.providerExpiresAt) ||
    input.providerExpiresAt <= input.now ||
    input.providerExpiresAt > input.localMaxExpiresAt
  ) {
    return Either.left(new ProviderUnavailable());
  }
  return Either.right({
    rowId: row._id,
    connectionKey: row.connectionKey,
    attemptExpiresAt: input.providerExpiresAt,
  });
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
    (row.status !== "verifying" && row.attemptExpiresAt <= input.now) ||
    (row.status !== "authorizing" &&
      row.status !== "reauthorizing" &&
      !(
        row.status === "verifying" &&
        row.nangoConnectionId === input.connectionId
      )) ||
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

export const authorizeSlackConnectCompletionPlan = (input: {
  readonly row: ProviderConnectionRow;
  readonly connectionId: string;
  readonly currentOrganizationKey: string | null;
  readonly now: number;
}): Either.Either<
  {
    readonly organizationKey: string;
    readonly connectionGeneration: number;
    readonly nangoOrganizationId: string;
    readonly nangoEndUserId: string;
    readonly providerConfigKey: "slack";
    readonly correlationTag: string;
    readonly alreadyCompleted: boolean;
    readonly connectionKey: string;
    readonly status: "verifying";
  },
  Forbidden | TenantMismatch | ConnectSessionInvalid
> => {
  const row = input.row;
  if (input.currentOrganizationKey === null) {
    return Either.left(
      new Forbidden({
        reason: "Slack connections require organization admin.",
      }),
    );
  }
  if (input.currentOrganizationKey !== row.organizationKey) {
    return Either.left(new TenantMismatch());
  }
  if (row.status === "verifying") {
    if (row.nangoConnectionId !== input.connectionId) {
      return Either.left(new ConnectSessionInvalid());
    }
    return Either.right({
      organizationKey: row.organizationKey,
      connectionGeneration: row.connectionGeneration,
      nangoOrganizationId: row.nangoOrganizationId,
      nangoEndUserId: row.nangoEndUserId,
      providerConfigKey: row.providerConfigKey,
      correlationTag: row.correlationTag,
      alreadyCompleted: true,
      connectionKey: row.connectionKey,
      status: "verifying" as const,
    });
  }
  if (row.attemptExpiresAt <= input.now) {
    return Either.left(new ConnectSessionInvalid());
  }
  return Either.right({
    organizationKey: row.organizationKey,
    connectionGeneration: row.connectionGeneration,
    nangoOrganizationId: row.nangoOrganizationId,
    nangoEndUserId: row.nangoEndUserId,
    providerConfigKey: row.providerConfigKey,
    correlationTag: row.correlationTag,
    alreadyCompleted: false,
    connectionKey: row.connectionKey,
    status: "verifying" as const,
  });
};

const generatedRefs = {
  internal: {
    integrations: {
      slackConnections: {
        prepareSlackConnectAttempt: Ref.make(
          "integrations/slackConnections",
          prepareSlackConnectAttemptSpec,
        ),
        claimSlackConnectAttempt: Ref.make(
          "integrations/slackConnections",
          claimSlackConnectAttemptSpec,
        ),
        authorizeSlackConnectCompletion: Ref.make(
          "integrations/slackConnections",
          authorizeSlackConnectCompletionSpec,
        ),
        markSlackConnectAttemptFailed: Ref.make(
          "integrations/slackConnections",
          markSlackConnectAttemptFailedSpec,
        ),
        reconcileSlackConnectSessionExpiry: Ref.make(
          "integrations/slackConnections",
          reconcileSlackConnectSessionExpirySpec,
        ),
        finalizeSlackConnectAttempt: Ref.make(
          "integrations/slackConnections",
          finalizeSlackConnectAttemptSpec,
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
          row.status !== "revoked",
      ) ?? null
    );
  });

const mapNangoError = (error: unknown): SlackConnectionError => {
  if (error instanceof NangoConnectSessionInvalid)
    return new ConnectSessionInvalid();
  if (error instanceof NangoProviderUnavailable)
    return new ProviderUnavailable();
  return new ProviderUnavailable();
};

const loadNangoProvider = NangoProvider.pipe(
  Effect.provide(createNangoProviderLayer()),
);

const runSlackMutation = <Mutation extends Ref.AnyMutation>(
  runMutation: MutationRunner,
  mutation: Mutation,
  ...args: Ref.OptionalArgs<Mutation>
) =>
  runMutation(mutation, ...args).pipe(
    Effect.mapError((error): SlackConnectionError =>
      error instanceof Unauthorized ||
      error instanceof Forbidden ||
      error instanceof ConnectionAlreadyExists ||
      error instanceof ConnectSessionInvalid ||
      error instanceof ProviderUnavailable ||
      error instanceof TenantMismatch
        ? error
        : new ProviderUnavailable(),
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
      const attemptExpiresAt = now + 300_000;
      const attempt = yield* runSlackMutation(
        runMutation,
        generatedRefs.internal.integrations.slackConnections
          .prepareSlackConnectAttempt,
        {
          now,
          attemptExpiresAt,
          nonce: crypto.randomUUID().replace(/-/g, ""),
        },
      );
      const session = yield* Effect.gen(function* () {
        const nango = (yield* loadNangoProvider.pipe(
          Effect.mapError(() => new ProviderUnavailable()),
        )).clientFor({ now });
        return yield* Effect.tryPromise({
          try: () =>
            nango.createConnectSession({
              organizationKey: attempt.nangoOrganizationId,
              endUserId: attempt.nangoEndUserId,
              providerConfigKey: attempt.providerConfigKey,
              correlationTag: attempt.correlationTag,
              connectSessionId: attempt.connectSessionId,
            }),
          catch: mapNangoError,
        });
      }).pipe(
        Effect.tapError(() =>
          runSlackMutation(
            runMutation,
            generatedRefs.internal.integrations.slackConnections
              .markSlackConnectAttemptFailed,
            {
              connectSessionId: attempt.connectSessionId,
              expectedConnectionGeneration: attempt.connectionGeneration,
              now,
            },
          ).pipe(Effect.ignore),
        ),
      );
      yield* runSlackMutation(
        runMutation,
        generatedRefs.internal.integrations.slackConnections
          .reconcileSlackConnectSessionExpiry,
        {
          connectSessionId: attempt.connectSessionId,
          attemptId: attempt.attemptId,
          expectedConnectionGeneration: attempt.connectionGeneration,
          providerExpiresAt: session.expiresAt,
          localMaxExpiresAt: attemptExpiresAt,
          now,
        },
      ).pipe(
        Effect.tapError(() =>
          runSlackMutation(
            runMutation,
            generatedRefs.internal.integrations.slackConnections
              .markSlackConnectAttemptFailed,
            {
              connectSessionId: attempt.connectSessionId,
              expectedConnectionGeneration: attempt.connectionGeneration,
              now,
            },
          ).pipe(Effect.ignore),
        ),
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
      const authorization = yield* runSlackMutation(
        runMutation,
        generatedRefs.internal.integrations.slackConnections
          .authorizeSlackConnectCompletion,
        {
          connectSessionId: input.connectSessionId,
          connectionId: input.connectionId,
          now,
        },
      );
      if (authorization.alreadyCompleted) {
        return {
          connectionKey: authorization.connectionKey,
          status: authorization.status,
          connectionGeneration: authorization.connectionGeneration,
        };
      }
      const nango = (yield* loadNangoProvider.pipe(
        Effect.mapError(() => new ProviderUnavailable()),
      )).clientFor({ now });
      const metadata = yield* Effect.tryPromise({
        try: () =>
          nango.verifyConnectSession({
            connectSessionId: input.connectSessionId,
            connectionId: input.connectionId,
          }),
        catch: mapNangoError,
      });
      yield* runSlackMutation(
        runMutation,
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
      const finalizeNow = yield* Clock.currentTimeMillis;
      const finalized = yield* runSlackMutation(
        runMutation,
        generatedRefs.internal.integrations.slackConnections
          .finalizeSlackConnectAttempt,
        {
          connectSessionId: input.connectSessionId,
          connectionId: input.connectionId,
          expectedConnectionGeneration: authorization.connectionGeneration,
          now: finalizeNow,
        },
      );
      return {
        ...finalized,
        connectionGeneration: authorization.connectionGeneration,
      };
    }),
);

const prepareSlackConnectAttempt = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "prepareSlackConnectAttempt",
  (input) =>
    Effect.gen(function* () {
      const auth = yield* Auth;
      const rawIdentity = yield* auth.getUserIdentity.pipe(
        Effect.mapError(() => new Unauthorized()),
      );
      const identity = yield* extractSlackIdentityProfile(rawIdentity);
      const subject = identity.subject;
      const user = yield* (yield* DatabaseReader)
        .table("users")
        .index("by_subject", (q) => q.eq("subject", subject))
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
      const ids = makeSlackConnectAttemptIds({
        organizationKey,
        nonce: input.nonce,
        now: input.now,
      });
      const reservation = reserveSlackConnectAttemptPlan({
        organizationKey,
        connectSessionId: ids.connectSessionId,
        currentConnection: current,
        now: input.now,
      });
      if (Either.isLeft(reservation)) {
        return yield* Effect.fail(reservation.left);
      }
      const connectionKey =
        current?.connectionKey ?? connectionKeyFor(organizationKey);
      const connectionGeneration = slackConnectAttemptGenerationFor({
        currentConnection: current,
      });
      const row = {
        provider: "nango" as const,
        providerConfigKey: "slack" as const,
        organizationKey,
        connectionKey,
        connectionGeneration,
        status: slackConnectAttemptStatusFor({ currentConnection: current }),
        connectSessionId: ids.connectSessionId,
        nangoConnectionId: null,
        nangoEndUserId: ids.nangoEndUserId,
        nangoOrganizationId: ids.nangoOrganizationId,
        correlationTag: ids.correlationTag,
        attemptId: ids.attemptId,
        attemptExpiresAt: input.attemptExpiresAt,
        completedAt: null,
        updatedAt: input.now,
      };
      if (current === null) {
        yield* providerWriter(yield* DatabaseWriter)
          .table("providerConnections")
          .insert({ ...row, createdAt: input.now })
          .pipe(Effect.orDie);
      } else if (reservation.right.status !== "idempotent") {
        yield* providerWriter(yield* DatabaseWriter)
          .table("providerConnections")
          .patch(current._id, row)
          .pipe(Effect.orDie);
      }
      return {
        organizationKey,
        connectionKey,
        connectionGeneration,
        providerConfigKey: "slack" as const,
        ...ids,
      };
    }),
);

const markSlackConnectAttemptFailed = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "markSlackConnectAttemptFailed",
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
        row.connectionGeneration !== input.expectedConnectionGeneration ||
        (row.status !== "authorizing" && row.status !== "reauthorizing")
      ) {
        return yield* Effect.fail(new ConnectSessionInvalid());
      }
      yield* providerWriter(yield* DatabaseWriter)
        .table("providerConnections")
        .patch(row._id, {
          status: "error",
          completedAt: null,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
      return { connectionKey: row.connectionKey, status: "error" as const };
    }),
);

const reconcileSlackConnectSessionExpiry = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "reconcileSlackConnectSessionExpiry",
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
      const result = reconcileSlackConnectSessionExpiryPlan({ row, ...input });
      if (Either.isLeft(result)) return yield* Effect.fail(result.left);
      yield* providerWriter(yield* DatabaseWriter)
        .table("providerConnections")
        .patch(result.right.rowId, {
          attemptExpiresAt: result.right.attemptExpiresAt,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
      return {
        connectionKey: result.right.connectionKey,
        attemptExpiresAt: result.right.attemptExpiresAt,
      };
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
      if (row === null) {
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
      yield* providerWriter(yield* DatabaseWriter)
        .table("providerConnections")
        .patch(row._id, {
          nangoConnectionId: input.connectionId,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
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
      const rawIdentity = yield* auth.getUserIdentity.pipe(
        Effect.mapError(() => new Unauthorized()),
      );
      const identity = yield* extractSlackIdentityProfile(rawIdentity);
      const subject = identity.subject;
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
      if (row === null) {
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
      const authorization = authorizeSlackConnectCompletionPlan({
        row,
        connectionId: input.connectionId,
        currentOrganizationKey: current.agencyKey ?? null,
        now: input.now,
      });
      if (Either.isLeft(authorization)) {
        return yield* Effect.fail(authorization.left);
      }
      return authorization.right;
    }),
);

const finalizeSlackConnectAttempt = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "finalizeSlackConnectAttempt",
  (input) =>
    Effect.gen(function* () {
      const auth = yield* Auth;
      const rawIdentity = yield* auth.getUserIdentity.pipe(
        Effect.mapError(() => new Unauthorized()),
      );
      const identity = yield* extractSlackIdentityProfile(rawIdentity);
      const subject = identity.subject;
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
      if (row === null) return yield* Effect.fail(new ConnectSessionInvalid());
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

export default GroupImpl.make(databaseSchema, slackConnections).pipe(
  Layer.provide(beginSlackConnect),
  Layer.provide(completeSlackConnect),
  Layer.provide(prepareSlackConnectAttempt),
  Layer.provide(markSlackConnectAttemptFailed),
  Layer.provide(reconcileSlackConnectSessionExpiry),
  Layer.provide(claimSlackConnectAttempt),
  Layer.provide(authorizeSlackConnectCompletion),
  Layer.provide(finalizeSlackConnectAttempt),
  GroupImpl.finalize,
);
