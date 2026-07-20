import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

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
      connectionKey: Schema.String,
      connectionGeneration: Schema.Number,
      teamId: Schema.String,
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

export default GroupSpec.make()
  .addFunction(createSlackIdentityLinkIntent)
  .addFunction(consumeSlackIdentityLink)
  .addFunction(revokeSlackIdentityLink);
