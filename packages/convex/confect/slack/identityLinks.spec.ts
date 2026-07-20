import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { Forbidden, Unauthorized } from "../errors";

export class LinkExpired extends Schema.TaggedError<LinkExpired>()(
  "LinkExpired",
  {},
) {}

export class LinkReplay extends Schema.TaggedError<LinkReplay>()(
  "LinkReplay",
  {},
) {}

export class SlackIdentityAlreadyBound extends Schema.TaggedError<SlackIdentityAlreadyBound>()(
  "SlackIdentityAlreadyBound",
  { teamId: Schema.String, slackUserId: Schema.String },
) {}

export class TeamMismatch extends Schema.TaggedError<TeamMismatch>()(
  "TeamMismatch",
  {},
) {}

export class BindingRevoked extends Schema.TaggedError<BindingRevoked>()(
  "BindingRevoked",
  {},
) {}

const linkError = () =>
  Schema.Union(
    Unauthorized,
    Forbidden,
    LinkExpired,
    LinkReplay,
    SlackIdentityAlreadyBound,
    TeamMismatch,
    BindingRevoked,
  );

export const createSlackIdentityLinkIntent = FunctionSpec.publicMutation({
  name: "createSlackIdentityLinkIntent",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      connectionKey: Schema.String,
      connectionGeneration: Schema.Number,
      teamId: Schema.String,
      brainKey: Schema.optional(Schema.String),
      nonceHash: Schema.String,
      now: Schema.Number,
    }),
  returns: () =>
    Schema.Struct({
      bindingKey: Schema.String,
      status: Schema.Literal("pending_verification"),
      teamId: Schema.String,
      expiresAt: Schema.Number,
      linkToken: Schema.String,
    }),
  error: () => linkError(),
});

export const consumeSlackIdentityLink = FunctionSpec.internalMutation({
  name: "consumeSlackIdentityLink",
  args: () =>
    Schema.Struct({
      nonceHash: Schema.String,
      teamId: Schema.String,
      slackUserId: Schema.String,
      now: Schema.Number,
    }),
  returns: () =>
    Schema.Struct({
      bindingKey: Schema.String,
      status: Schema.Literal("active"),
      teamId: Schema.String,
      slackUserId: Schema.String,
      bindingGeneration: Schema.Number,
    }),
  error: () => linkError(),
});

export const revokeSlackIdentityLink = FunctionSpec.publicMutation({
  name: "revokeSlackIdentityLink",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      bindingKey: Schema.String,
      reason: Schema.String,
      now: Schema.Number,
    }),
  returns: () =>
    Schema.Struct({
      bindingKey: Schema.String,
      status: Schema.Literal("revoked"),
      revokedAt: Schema.Number,
    }),
  error: () => linkError(),
});

export const revokeSlackIdentityLinksForLifecycle =
  FunctionSpec.internalMutation({
    name: "revokeSlackIdentityLinksForLifecycle",
    args: () =>
      Schema.Struct({
        organizationKey: Schema.String,
        userId: Schema.optional(Schema.String),
        connectionKey: Schema.optional(Schema.String),
        connectionGeneration: Schema.optional(Schema.Number),
        reason: Schema.String,
        now: Schema.Number,
      }),
    returns: () => Schema.Struct({ revokedCount: Schema.Number }),
    error: () => linkError(),
  });

export const revokeSlackIdentityLinksForUserSuspended =
  FunctionSpec.internalMutation({
    name: "revokeSlackIdentityLinksForUserSuspended",
    args: () =>
      Schema.Struct({
        organizationKey: Schema.String,
        userId: Schema.String,
        now: Schema.Number,
      }),
    returns: () => Schema.Struct({ revokedCount: Schema.Number }),
    error: () => linkError(),
  });

export const revokeSlackIdentityLinksForMembershipSuspended =
  FunctionSpec.internalMutation({
    name: "revokeSlackIdentityLinksForMembershipSuspended",
    args: () =>
      Schema.Struct({
        organizationKey: Schema.String,
        userId: Schema.String,
        now: Schema.Number,
      }),
    returns: () => Schema.Struct({ revokedCount: Schema.Number }),
    error: () => linkError(),
  });

export const revokeSlackIdentityLinksForConnectionReplaced =
  FunctionSpec.internalMutation({
    name: "revokeSlackIdentityLinksForConnectionReplaced",
    args: () =>
      Schema.Struct({
        organizationKey: Schema.String,
        connectionKey: Schema.String,
        connectionGeneration: Schema.Number,
        now: Schema.Number,
      }),
    returns: () => Schema.Struct({ revokedCount: Schema.Number }),
    error: () => linkError(),
  });

export default GroupSpec.make()
  .addFunction(createSlackIdentityLinkIntent)
  .addFunction(consumeSlackIdentityLink)
  .addFunction(revokeSlackIdentityLink)
  .addFunction(revokeSlackIdentityLinksForLifecycle)
  .addFunction(revokeSlackIdentityLinksForUserSuspended)
  .addFunction(revokeSlackIdentityLinksForMembershipSuspended)
  .addFunction(revokeSlackIdentityLinksForConnectionReplaced);
