import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader, DatabaseWriter } from "../_generated/services";
import { Forbidden, Unauthorized, ValidationFailed } from "../errors";
import { asGenericId, loadCurrentUser } from "../access/handlerContext";
import { resolveEffectiveWorkspaceRole } from "../access/auth";
import type { Role } from "../access/roles";
import { extractIdentityProfile } from "../access/provisioning";
import apiKeysSpec, { PublicApiKeyListItemSchema } from "./apiKeys.spec";
import {
  ApiKeyConflict,
  ApiKeyNotFound,
  ApiKeyRevoked,
  BrainApiKeyServerScope,
  HeadlessApiKeyScope,
  HeadlessAuthError,
  PublicApiKeyMetadata,
  PublicBrainApiKeyCreateInput,
  ApiKeyExpiryInvalid,
  ApiKeyScopeInvalid,
  PublicBrainApiKeyCreateResult,
  createBrainApiKey,
  hashPresentedApiKey,
  parseBearerApiKey,
  revokeBrainApiKey,
  rotateBrainApiKey,
  type ApiKeyRow,
  type ServicePrincipalRow,
} from "./auth";
import {
  headlessPrincipalFromVerification,
  type HeadlessPrincipal,
} from "./principal";

export type PublicApiKeyListItem = PublicApiKeyMetadata & {
  readonly id: string;
};

export type PublicApiKeyServerContext = {
  readonly serverScope: BrainApiKeyServerScope;
  readonly actor: { readonly userId: string; readonly role: Role };
};

const authError = (code: HeadlessAuthError["code"], message: string) =>
  new HeadlessAuthError({ code, message });

const requireExactlyOne = <A>(rows: readonly A[]): A | undefined =>
  rows.length === 1 ? rows[0] : undefined;

const knownCreateError = (error: unknown) => {
  if (
    error instanceof Forbidden ||
    error instanceof ApiKeyScopeInvalid ||
    error instanceof ApiKeyExpiryInvalid ||
    error instanceof ApiKeyConflict
  ) {
    return error;
  }
  throw error;
};

const knownRevokeError = (error: unknown) => {
  if (
    error instanceof Forbidden ||
    error instanceof ApiKeyNotFound ||
    error instanceof ApiKeyRevoked ||
    error instanceof ApiKeyConflict
  ) {
    return error;
  }
  throw error;
};

const knownRotateError = (error: unknown) => {
  if (
    error instanceof Forbidden ||
    error instanceof ApiKeyNotFound ||
    error instanceof ApiKeyRevoked ||
    error instanceof ApiKeyExpiryInvalid ||
    error instanceof ApiKeyConflict
  ) {
    return error;
  }
  throw error;
};

const requireAdmin = (actor: { readonly role: Role }) =>
  Effect.try({
    try: () =>
      revokeBrainApiKey({
        key: {
          id: "probe",
          principalId: "probe",
          organizationId: "probe",
          workspaceId: "probe",
          brainKey: "probe",
          name: "probe",
          keyHash: "probe",
          displayPrefix: "probe",
          scopes: ["brain:read"],
          principalGeneration: 1,
          roleCeiling: "viewer",
          status: "revoked",
          createdByUserId: "probe",
          createdAt: 0,
          expiresAt: 1,
          revokedAt: 0,
          lastUsedAt: null,
        },
        actor,
        nowMs: 0,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catchAll((error) =>
      error instanceof Forbidden ? Effect.fail(error) : Effect.void,
    ),
    Effect.asVoid,
  );

const assertActiveBrainScope = (scope: BrainApiKeyServerScope) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const organizations = yield* reader
      .table("organizations")
      .index("by_status", (q) => q.eq("status", "active"))
      .collect()
      .pipe(Effect.orDie);
    const organization = requireExactlyOne(
      organizations.filter((row) => row._id === scope.organizationId),
    );
    if (organization === undefined) {
      return yield* Effect.fail(
        authError("TENANT_INACTIVE", "Tenant is inactive."),
      );
    }
    const workspaces = yield* reader
      .table("workspaces")
      .index("by_organization_brain_key", (q) =>
        q
          .eq("organizationId", scope.organizationId)
          .eq("brainKey", scope.brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const workspace = requireExactlyOne(
      workspaces.filter(
        (row) => row._id === scope.workspaceId && row.status === "active",
      ),
    );
    if (workspace === undefined) {
      return yield* Effect.fail(
        authError("TENANT_INACTIVE", "Tenant is inactive."),
      );
    }
    return { organization, workspace };
  });

const publicMetadata = (key: ApiKeyRow): PublicApiKeyListItem => ({
  id: key.id,
  name: key.name,
  displayPrefix: key.displayPrefix,
  scopes: key.scopes.filter(
    (scope): scope is HeadlessApiKeyScope =>
      scope === "brain:read" || scope === "brain:ask",
  ),
  roleCeiling: "viewer",
  status: key.status,
  createdAt: key.createdAt,
  expiresAt: key.expiresAt,
});

export const createApiKeyForBrain = (
  input: PublicApiKeyServerContext & {
    readonly publicInput: Omit<
      PublicBrainApiKeyCreateInput,
      "actor" | "nowMs"
    > & {
      readonly randomBytes?: () => Uint8Array;
    };
    readonly nowMs: number;
  },
): Effect.Effect<
  PublicBrainApiKeyCreateResult,
  | Forbidden
  | ApiKeyScopeInvalid
  | ApiKeyExpiryInvalid
  | ApiKeyConflict
  | HeadlessAuthError,
  DatabaseReader | DatabaseWriter
> =>
  Effect.gen(function* () {
    yield* requireAdmin(input.actor);
    const { organization, workspace } = yield* assertActiveBrainScope(
      input.serverScope,
    );
    const existing = yield* (yield* DatabaseReader)
      .table("apiKeys")
      .index("by_brain_status", (q) =>
        q
          .eq("workspaceId", input.serverScope.workspaceId)
          .eq("brainKey", input.serverScope.brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    if (
      existing.some(
        (key) =>
          key.organizationId === input.serverScope.organizationId &&
          key.name === input.publicInput.name &&
          key.status === "active" &&
          key.revokedAt === null,
      )
    ) {
      return yield* Effect.fail(
        new ApiKeyConflict({ reason: "Active API key name already exists." }),
      );
    }
    const created = yield* Effect.tryPromise({
      try: () =>
        createBrainApiKey({
          ...input.serverScope,
          name: input.publicInput.name,
          scopes: input.publicInput.scopes,
          actor: input.actor,
          nowMs: input.nowMs,
          expiresAt: input.publicInput.expiresAt,
          ...(input.publicInput.randomBytes === undefined
            ? {}
            : { randomBytes: input.publicInput.randomBytes }),
        }),
      catch: knownCreateError,
    });
    const hashMatches = yield* (yield* DatabaseReader)
      .table("apiKeys")
      .index("by_key_hash", (q) => q.eq("keyHash", created.key.keyHash))
      .collect()
      .pipe(Effect.orDie);
    if (hashMatches.length > 0) {
      return yield* Effect.fail(
        new ApiKeyConflict({ reason: "API key hash collision." }),
      );
    }
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("servicePrincipals")
      .insert(created.principal)
      .pipe(Effect.orDie);
    yield* writer
      .table("apiKeys")
      .insert({
        ...created.key,
        principalId: created.principal.id,
        organizationGeneration: organization.lifecycleGeneration ?? 0,
        organizationRevocationGeneration:
          organization.revocationGeneration ?? 0,
        workspaceGeneration: workspace.lifecycleGeneration ?? 0,
        workspaceRevocationGeneration: workspace.revocationGeneration ?? 0,
      })
      .pipe(Effect.orDie);

    return {
      displayKey: created.displayKey,
      key: {
        name: created.key.name,
        displayPrefix: created.key.displayPrefix,
        scopes: created.key.scopes,
        roleCeiling: created.key.roleCeiling,
        status: created.key.status,
        createdAt: created.key.createdAt,
        expiresAt: created.key.expiresAt,
      },
    };
  });

export const listApiKeysForBrain = (input: PublicApiKeyServerContext) =>
  Effect.gen(function* () {
    yield* requireAdmin(input.actor);
    yield* assertActiveBrainScope(input.serverScope);
    const rows = yield* (yield* DatabaseReader)
      .table("apiKeys")
      .index("by_brain_status", (q) =>
        q
          .eq("workspaceId", input.serverScope.workspaceId)
          .eq("brainKey", input.serverScope.brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    return rows
      .filter((row) => row.organizationId === input.serverScope.organizationId)
      .map(publicMetadata);
  });

