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

export const beginSlackConnectPlan = () =>
  Either.left(new ProviderUnavailable());
export const completeSlackConnectPlan = () =>
  Either.left(new ConnectSessionInvalid());
export const reserveSlackConnectAttemptPlan = () =>
  Either.right({ status: "insert" as const });
export const slackConnectAttemptGenerationFor = () => 0;
export const slackConnectAttemptStatusFor = () => "authorizing" as const;
export const reconcileSlackConnectSessionExpiryPlan = () =>
  Either.left(new ConnectSessionInvalid());
export const finalizeSlackConnectAttemptPlan = () =>
  Either.left(new ConnectSessionInvalid());
export const authorizeSlackConnectCompletionPlan = () =>
  Either.left(new ConnectSessionInvalid());

const beginSlackConnect = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "beginSlackConnect",
  () => Effect.fail(new ProviderUnavailable()),
);
const completeSlackConnect = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "completeSlackConnect",
  () => Effect.fail(new ConnectSessionInvalid()),
);
const prepareSlackConnectAttempt = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "prepareSlackConnectAttempt",
  () => Effect.fail(new ProviderUnavailable()),
);
const markSlackConnectAttemptFailed = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "markSlackConnectAttemptFailed",
  () => Effect.fail(new ConnectSessionInvalid()),
);
const reconcileSlackConnectSessionExpiry = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "reconcileSlackConnectSessionExpiry",
  () => Effect.fail(new ConnectSessionInvalid()),
);
const claimSlackConnectAttempt = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "claimSlackConnectAttempt",
  () => Effect.fail(new ConnectSessionInvalid()),
);
const authorizeSlackConnectCompletion = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "authorizeSlackConnectCompletion",
  () => Effect.fail(new ConnectSessionInvalid()),
);
const finalizeSlackConnectAttempt = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "finalizeSlackConnectAttempt",
  () => Effect.fail(new ConnectSessionInvalid()),
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
