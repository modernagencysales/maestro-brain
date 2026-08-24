import { FunctionImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader } from "../_generated/services";
import { asGenericId } from "../access/handlerContext";
import { extractIdentityBinding } from "../access/provisioning";
import { roleAtLeast, type Role } from "../access/roles";
import { Forbidden, Unauthorized } from "../errors";
import slackConnections from "./slackConnections.spec";

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

export type ProviderConnectionRow = Readonly<{
  readonly _id: GenericId<"providerConnections">;
  readonly _creationTime?: number;
  readonly connectionKey: string;
  readonly provider: "nango";
  readonly providerConfigKey: "slack";
  readonly organizationKey: string;
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
}>;

type RawIndexBuilder = {
  readonly eq: (field: string, value: unknown) => RawIndexBuilder;
};
type RawQuery = {
  readonly index: (
    name: string,
    range: (builder: RawIndexBuilder) => RawIndexBuilder,
  ) => RawQuery;
  readonly take: (count: number) => Effect.Effect<readonly unknown[], unknown>;
};
type RawReader = {
  readonly table: (name: "providerConnections") => RawQuery;
};
const providerReader = (reader: unknown): RawReader => reader as RawReader;

export const extractSlackIdentityProfile = (
  claims: Parameters<typeof extractIdentityBinding>[0],
) =>
  extractIdentityBinding(claims).pipe(
    Effect.mapError(() => new Unauthorized()),
  );

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
      ? candidates.length === 1
        ? candidates[0]
        : undefined
      : candidates.find(
          (organization) =>
            organization.workosOrganizationId ===
            input.currentWorkosOrganizationId,
        );
  return current === undefined
    ? Either.left(
        new Forbidden({
          reason: "Slack connections require organization admin.",
        }),
      )
    : Either.right(current);
};

export const currentSlackConnectionFor = (organizationKey: string) =>
  Effect.gen(function* () {
    const rows = yield* providerReader(yield* DatabaseReader)
      .table("providerConnections")
      .index("by_organization", (query) =>
        query.eq("organizationKey", organizationKey),
      )
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

const currentSlackAdminOrganizationKey = Effect.gen(function* () {
  const identity = yield* (yield* Auth).getUserIdentity.pipe(
    Effect.mapError(() => new Unauthorized()),
    Effect.flatMap(extractSlackIdentityProfile),
  );
  const user = yield* (yield* DatabaseReader)
    .table("users")
    .index("by_subject", (query) =>
      query.eq("subject", identity.subject.trim()),
    )
    .first()
    .pipe(Effect.map(Option.getOrNull), Effect.orDie);
  if (user === null)
    return yield* Effect.fail(
      new Forbidden({ reason: "Provisioned user required." }),
    );
  const memberships = yield* (yield* DatabaseReader)
    .table("organizationMembers")
    .index("by_user", (query) => query.eq("userId", user._id))
    .take(10)
    .pipe(Effect.orDie);
  const organizations = new Map<string, SlackOrganizationRecord>();
  for (const membership of memberships) {
    const organization = yield* (yield* DatabaseReader)
      .table("organizations")
      .get(asGenericId<"organizations">(membership.organizationId))
      .pipe(Effect.orDie);
    if (organization !== null)
      organizations.set(membership.organizationId, organization);
  }
  const organization = yield* selectCurrentSlackOrganization({
    memberships,
    organizationsById: organizations,
    ...(typeof identity.workosOrganizationId === "string"
      ? { currentWorkosOrganizationId: identity.workosOrganizationId }
      : {}),
  });
  if (organization.agencyKey === undefined)
    return yield* Effect.fail(
      new Forbidden({ reason: "Active organization required." }),
    );
  return organization.agencyKey;
});

export const getSlackConnectionStatus = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "getSlackConnectionStatus",
  () =>
    Effect.gen(function* () {
      const organizationKey = yield* currentSlackAdminOrganizationKey;
      const current = yield* currentSlackConnectionFor(organizationKey);
      return current === null
        ? {
            connectionKey: null,
            status: "not_connected" as const,
            teamId: null,
          }
        : {
            connectionKey: current.connectionKey,
            status: current.status,
            teamId: current.teamId ?? null,
          };
    }),
);
