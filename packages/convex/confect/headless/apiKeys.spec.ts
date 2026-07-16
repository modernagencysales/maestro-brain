import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Forbidden, NoRecoverableError, Unauthorized } from "../errors";
import {
  ApiKeyConflict,
  ApiKeyExpiryInvalid,
  ApiKeyNotFound,
  ApiKeyRevoked,
  ApiKeyScopeInvalid,
  HeadlessApiKeyScope,
  HeadlessAuthError,
  PublicApiKeyMetadataSchema,
} from "./auth";

export const PublicApiKeyListItemSchema = Schema.extend(
  Schema.Struct({ id: Schema.String }),
  PublicApiKeyMetadataSchema,
);

const create = FunctionSpec.publicMutation({
  name: "create",
  args: () =>
    Schema.Struct({
      brainKey: Schema.String,
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
      ApiKeyConflict,
    ),
});

const list = FunctionSpec.publicQuery({
  name: "list",
  args: () => Schema.Struct({ brainKey: Schema.String }),
  returns: () => Schema.Array(PublicApiKeyListItemSchema),
  error: () => Schema.Union(Unauthorized, Forbidden),
});

const revoke = FunctionSpec.publicMutation({
  name: "revoke",
  args: () => Schema.Struct({ brainKey: Schema.String, keyId: Schema.String }),
  returns: () => Schema.Null,
  error: () =>
    Schema.Union(
      Unauthorized,
      Forbidden,
      ApiKeyNotFound,
      ApiKeyRevoked,
      ApiKeyConflict,
    ),
});

const rotate = FunctionSpec.publicMutation({
  name: "rotate",
  args: () =>
    Schema.Struct({
      brainKey: Schema.String,
      keyId: Schema.String,
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
      ApiKeyNotFound,
      ApiKeyRevoked,
      ApiKeyExpiryInvalid,
      ApiKeyConflict,
    ),
});

const authenticate = FunctionSpec.internalQuery({
  name: "authenticate",
  args: () =>
    Schema.Struct({
      keyHash: Schema.String,
      requiredScope: HeadlessApiKeyScope,
    }),
  returns: () =>
    Schema.Struct({
      principal: Schema.Struct({
        organizationId: Schema.String,
        workspaceId: Schema.String,
        brainKey: Schema.String,
        roleCeiling: Schema.Literal("viewer"),
        keyId: Schema.String,
        principalId: Schema.String,
        scopes: Schema.Array(HeadlessApiKeyScope),
      }),
      keyHash: Schema.String,
      keyId: Schema.String,
    }),
  error: () => HeadlessAuthError,
});

const markLastUsed = FunctionSpec.internalMutation({
  name: "markLastUsed",
  args: () =>
    Schema.Struct({
      keyId: Schema.String,
      keyHash: Schema.String,
      principalId: Schema.String,
      organizationId: Schema.String,
      workspaceId: Schema.String,
      brainKey: Schema.String,
    }),
  returns: () => Schema.Null,
  error: () => NoRecoverableError,
});

export default GroupSpec.make()
  .addFunction(create)
  .addFunction(list)
  .addFunction(revoke)
  .addFunction(rotate)
  .addFunction(authenticate)
  .addFunction(markLastUsed);
