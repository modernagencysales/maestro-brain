import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
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
  readonly role: "viewer" | "editor" | "admin" | "owner";
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

export type ProviderConnectionRow = {
  readonly _id: never;
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

const connectionKeyFor = (organizationKey: string) =>
  `slack_${organizationKey}`;
const adminRoles = new Set(["admin", "owner"]);

export const makeSlackConnectAttemptIds = (input: {
  readonly organizationKey: string;
  readonly nonce: string;
  readonly now: number;
}) => {
  const connectSessionId = `maestro-session-${input.nonce}`;
  return {
    connectSessionId,
    nangoEndUserId: `nango-user-slack-${input.nonce}`,
    nangoOrganizationId: `nango-org-slack-${input.nonce}`,
    correlationTag: `slack-connect:${connectSessionId}`,
    attemptId: `attempt_${input.nonce}`,
  };
};

export const validateOpaqueSlackConnectIds = (input: {
  readonly connectSessionId: string;
  readonly nangoEndUserId: string;
  readonly nangoOrganizationId: string;
  readonly correlationTag: string;
  readonly organizationKey: string;
}): boolean =>
  input.connectSessionId.startsWith("maestro-session-") &&
  !input.connectSessionId.includes(input.organizationKey) &&
  !input.nangoEndUserId.includes(input.organizationKey) &&
  !input.nangoOrganizationId.includes(input.organizationKey) &&
  input.correlationTag === `slack-connect:${input.connectSessionId}`;

export const beginSlackConnectPlan = (input: {
  readonly principal: SlackPrincipal | null;
  readonly existingConnection: SlackConnectionState | null;
  readonly now: number;
  readonly nonce?: string;
}) =>
  input.principal === null
    ? Either.left(new Unauthorized())
    : !adminRoles.has(input.principal.role)
      ? Either.left(
          new Forbidden({
            reason: "Slack connections require organization admin.",
          }),
        )
      : Either.right({
          organizationKey: input.principal.organizationKey,
          connectSessionToken: "connect_public_local",
          expiresAt: input.now + 300_000,
          providerConfigKey: "slack" as const,
          ...makeSlackConnectAttemptIds({
            organizationKey: input.principal.organizationKey,
            nonce: input.nonce ?? "local-fallback-nonce0000",
            now: input.now,
          }),
        });

export const completeSlackConnectPlan = () =>
  Either.right({
    connectionKey: "slack_local",
    status: "verifying" as const,
    connectionGeneration: 0,
  });

export const selectCurrentSlackOrganization = () =>
  Either.left(
    new Forbidden({ reason: "Slack connections require organization admin." }),
  );
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
