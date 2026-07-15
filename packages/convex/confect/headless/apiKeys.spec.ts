import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Forbidden, Unauthorized } from "../errors";
import {
  ApiKeyExpiryInvalid,
  PublicApiKeyMetadataSchema,
  ApiKeyNotFound,
  ApiKeyRevoked,
  ApiKeyScopeInvalid,
} from "./auth";

const create = FunctionSpec.publicMutation({
  name: "create",
  args: () =>
    Schema.Struct({
      name: Schema.String,
      scopes: Schema.Array(Schema.String),
      expiresAt: Schema.Number,
    }),
  returns: () =>
    Schema.Struct({
      displayKey: Schema.String,
      key: PublicApiKeyMetadataSchema,
    }),
  error: () =>
    Schema.Union(
      Unauthorized,
      Forbidden,
      ApiKeyScopeInvalid,
      ApiKeyExpiryInvalid,
    ),
});

const list = FunctionSpec.publicQuery({
  name: "list",
  args: () => Schema.Struct({}),
  returns: () => Schema.Array(PublicApiKeyMetadataSchema),
  error: () => Schema.Union(Unauthorized, Forbidden),
});

const revoke = FunctionSpec.publicMutation({
  name: "revoke",
  args: () =>
    Schema.Struct({
      keyId: Schema.String,
    }),
  returns: () => Schema.Null,
  error: () =>
    Schema.Union(Unauthorized, Forbidden, ApiKeyNotFound, ApiKeyRevoked),
});

export default GroupSpec.make()
  .addFunction(create)
  .addFunction(list)
  .addFunction(revoke);
