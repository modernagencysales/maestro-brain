import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { Forbidden, Unauthorized } from "../errors";
import { roleAtLeast, type Role } from "../access/roles";
import slackConnections, {
  ConnectSessionInvalid,
  ConnectionAlreadyExists,
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
};

type SlackConnectionError =
  | Unauthorized
  | Forbidden
  | ConnectionAlreadyExists
  | ConnectSessionInvalid
  | TenantMismatch;

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
  /^(sk_|xox[a-z]-)/i.test(value);
const connectionKeyFor = (organizationKey: string) =>
  `slack_${organizationKey}`;

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
    readonly status: "active";
    readonly connectionGeneration: number;
  },
  SlackConnectionError
> =>
  Either.gen(function* () {
    const principal = yield* requireAdmin(input.principal);
    if (
      input.pending === null ||
      input.pending.connectSessionId !== input.connectSessionId ||
      isSecretShaped(input.connectionId)
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
      status: "active",
      connectionGeneration: 1,
    };
  });

const beginSlackConnect = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "beginSlackConnect",
  () =>
    Effect.succeed({
      connectSessionToken: `connect_public_${"fixture"}`,
      expiresAt: 1_782_925_100_000,
    }),
);

const completeSlackConnect = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "completeSlackConnect",
  () =>
    Effect.succeed({
      connectionKey: "slack_fixture",
      status: "active" as const,
    }),
);

export default GroupImpl.make(databaseSchema, slackConnections).pipe(
  Layer.provide(beginSlackConnect),
  Layer.provide(completeSlackConnect),
  GroupImpl.finalize,
);
