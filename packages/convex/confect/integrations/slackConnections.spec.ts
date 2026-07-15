import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Forbidden, Unauthorized } from "../errors";

export class ConnectionAlreadyExists extends Schema.TaggedError<ConnectionAlreadyExists>()(
  "ConnectionAlreadyExists",
  { organizationKey: Schema.String },
) {}

export class ConnectSessionInvalid extends Schema.TaggedError<ConnectSessionInvalid>()(
  "ConnectSessionInvalid",
  {},
) {}

export class ProviderUnavailable extends Schema.TaggedError<ProviderUnavailable>()(
  "ProviderUnavailable",
  {},
) {}

export class TenantMismatch extends Schema.TaggedError<TenantMismatch>()(
  "TenantMismatch",
  {},
) {}

const beginSlackConnect = FunctionSpec.publicMutation({
  name: "beginSlackConnect",
  args: () => Schema.Struct({}),
  returns: () =>
    Schema.Struct({
      connectSessionToken: Schema.String,
      expiresAt: Schema.Number,
    }),
  error: () =>
    Schema.Union(
      Unauthorized,
      Forbidden,
      ConnectionAlreadyExists,
      ConnectSessionInvalid,
      ProviderUnavailable,
      TenantMismatch,
    ),
});

const completeSlackConnect = FunctionSpec.publicMutation({
  name: "completeSlackConnect",
  args: () =>
    Schema.Struct({
      connectionId: Schema.String,
      connectSessionId: Schema.String,
    }),
  returns: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      status: Schema.Literal("active", "error"),
    }),
  error: () =>
    Schema.Union(
      Unauthorized,
      Forbidden,
      ConnectionAlreadyExists,
      ConnectSessionInvalid,
      ProviderUnavailable,
      TenantMismatch,
    ),
});

export default GroupSpec.make()
  .addFunction(beginSlackConnect)
  .addFunction(completeSlackConnect);
