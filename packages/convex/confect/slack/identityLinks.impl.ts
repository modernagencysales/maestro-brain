import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
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
  (input) => {
    const result = createSlackIdentityLinkIntentPlan({
      organizationKey: input.connectionKey.replace(/^slack_/, ""),
      connectionKey: input.connectionKey,
      connectionGeneration: input.connectionGeneration,
      teamId: input.teamId,
      userId: "current-user",
      workosSubject: "current-subject",
      nonceHash: input.nonceHash,
      now: input.now,
    });
    if (Either.isLeft(result)) return Effect.fail(result.left);
    const planned = result.right;
    return Effect.succeed({
      bindingKey: planned.row.bindingKey,
      status: "pending_verification" as const,
      teamId: planned.row.teamId,
      expiresAt: planned.row.intentExpiresAt,
      linkToken: planned.linkToken,
    });
  },
);

const consumeSlackIdentityLink = FunctionImpl.make(
  databaseSchema,
  slackIdentityLinks,
  "consumeSlackIdentityLink",
  (input) =>
    Effect.succeed({
      bindingKey: bindingKeyFor({
        organizationKey: "pending",
        teamId: input.teamId,
        slackUserId: input.slackUserId,
      }),
      status: "active" as const,
      teamId: input.teamId,
      slackUserId: input.slackUserId,
      bindingGeneration: 1,
    }),
);

const revokeSlackIdentityLink = FunctionImpl.make(
  databaseSchema,
  slackIdentityLinks,
  "revokeSlackIdentityLink",
  (input) =>
    Effect.succeed({
      bindingKey: input.bindingKey,
      status: "revoked" as const,
      revokedAt: input.now,
    }),
);

export default GroupImpl.make(databaseSchema, slackIdentityLinks).pipe(
  Layer.provide(createSlackIdentityLinkIntent),
  Layer.provide(consumeSlackIdentityLink),
  Layer.provide(revokeSlackIdentityLink),
  GroupImpl.finalize,
);
