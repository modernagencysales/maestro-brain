import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  MemberNotInWorkspace,
  NotFound,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import { ApiKeyScope } from "./auth";

const Actor = Schema.Struct({
  ok: Schema.Literal(true),
  keyId: Schema.String,
  workspaceId: Id("workspaces"),
  userId: Id("users"),
});

const AuthFailure = Schema.Struct({
  ok: Schema.Literal(false),
  code: Schema.Literals([
    "API_KEY_MISSING",
    "API_KEY_NOT_FOUND",
    "API_KEY_REVOKED",
    "API_KEY_EXPIRED",
    "API_KEY_FORBIDDEN",
    "API_KEY_WORKSPACE_MISMATCH",
  ]),
  message: Schema.String,
});

const ContractsNamespace = Schema.String.check(
  Schema.isPattern(/^contracts-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/u),
);

const Sha256Base64Url = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u),
);

const LinkedKeyMetadata = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  displayPrefix: Schema.String,
  scopes: Schema.Array(ApiKeyScope),
  status: Schema.Literals(["active", "revoked", "expired"]),
  createdAt: Schema.Number,
  expiresAt: Schema.NullOr(Schema.Number),
  lastUsedAt: Schema.NullOr(Schema.Number),
});

const LinkedKeyError = Schema.Union([
  Unauthorized,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  NotFound,
  ValidationFailed,
]);

const createLinkedKey = FunctionSpec.publicMutation({
  name: "createLinkedKey",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      name: Schema.String,
    }),
  returns: () =>
    Schema.Struct({
      displayKey: Schema.String,
      key: LinkedKeyMetadata,
    }),
  error: () => LinkedKeyError,
});

const listLinkedKeys = FunctionSpec.publicQuery({
  name: "listLinkedKeys",
  args: () => Schema.Struct({ workspaceId: Id("workspaces") }),
  returns: () => Schema.Array(LinkedKeyMetadata),
  error: () => LinkedKeyError,
});

const revokeLinkedKey = FunctionSpec.publicMutation({
  name: "revokeLinkedKey",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      keyId: Schema.String,
    }),
  returns: () => Schema.Null,
  error: () => LinkedKeyError,
});

const SeededContractsActor = Schema.Struct({
  keyId: Schema.String,
  workspaceId: Id("workspaces"),
  userId: Id("users"),
});

const seedLocalContracts = FunctionSpec.internalMutation({
  name: "seedLocalContracts",
  args: () =>
    Schema.Struct({
      namespace: ContractsNamespace,
      primaryKeyHash: Sha256Base64Url,
      clientKeyHash: Sha256Base64Url,
      observerKeyHash: Sha256Base64Url,
    }),
  returns: () =>
    Schema.Struct({
      primary: SeededContractsActor,
      client: SeededContractsActor,
      observer: SeededContractsActor,
    }),
});

const resolve = FunctionSpec.internalQuery({
  name: "resolve",
  args: () =>
    Schema.Struct({
      keyHash: Schema.String,
      workspaceSlug: Schema.String,
      requiredScope: ApiKeyScope,
      nowMs: Schema.Number,
    }),
  returns: () => Schema.Union([Actor, AuthFailure]),
});

const resolveCredential = FunctionSpec.internalQuery({
  name: "resolveCredential",
  args: () =>
    Schema.Struct({
      keyHash: Schema.String,
      requiredScope: ApiKeyScope,
      nowMs: Schema.Number,
    }),
  returns: () => Schema.Union([Actor, AuthFailure]),
});

export default GroupSpec.make()
  .addFunction(createLinkedKey)
  .addFunction(listLinkedKeys)
  .addFunction(revokeLinkedKey)
  .addFunction(seedLocalContracts)
  .addFunction(resolve)
  .addFunction(resolveCredential);
