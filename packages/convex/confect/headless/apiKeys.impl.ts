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

export const revokeApiKeyForBrain = (
  input: PublicApiKeyServerContext & {
    readonly keyId: string;
    readonly nowMs: number;
  },
) =>
  Effect.gen(function* () {
    yield* requireAdmin(input.actor);
    yield* assertActiveBrainScope(input.serverScope);
    const reader = yield* DatabaseReader;
    const keys = yield* reader
      .table("apiKeys")
      .index("by_brain_status", (q) =>
        q
          .eq("workspaceId", input.serverScope.workspaceId)
          .eq("brainKey", input.serverScope.brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const key = requireExactlyOne(
      keys.filter(
        (candidate) =>
          candidate.id === input.keyId &&
          candidate.organizationId === input.serverScope.organizationId,
      ),
    );
    if (key === undefined) {
      return yield* Effect.fail(new ApiKeyNotFound({ keyId: input.keyId }));
    }
    const revoked = yield* Effect.try({
      try: () =>
        revokeBrainApiKey({ key, actor: input.actor, nowMs: input.nowMs }),
      catch: knownRevokeError,
    });
    const principal = yield* reader
      .table("servicePrincipals")
      .index("by_principal_key", (q) => q.eq("id", key.principalId ?? ""))
      .collect()
      .pipe(Effect.orDie, Effect.map(requireExactlyOne));
    const writer = yield* DatabaseWriter;
    if (principal !== undefined) {
      yield* writer
        .table("servicePrincipals")
        .patch(asGenericId<"servicePrincipals">(principal._id), {
          status: "revoked" as const,
          generation: principal.generation + 1,
          revokedAt: input.nowMs,
        })
        .pipe(Effect.orDie);
    }
    yield* writer
      .table("apiKeys")
      .patch(asGenericId<"apiKeys">(key._id), {
        status: revoked.status,
        revokedAt: revoked.revokedAt,
      })
      .pipe(Effect.orDie);
    return null;
  });

export const authenticateBrainKeyHash = (input: {
  readonly keyHash: string;
  readonly requiredScope: HeadlessApiKeyScope;
}): Effect.Effect<
  {
    readonly principal: HeadlessPrincipal;
    readonly keyHash: string;
    readonly keyId: string;
  },
  HeadlessAuthError,
  DatabaseReader
> =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const reader = yield* DatabaseReader;
    const keys = yield* reader
      .table("apiKeys")
      .index("by_key_hash", (q) => q.eq("keyHash", input.keyHash))
      .collect()
      .pipe(Effect.orDie);
    const key = requireExactlyOne(keys);
    if (key === undefined) {
      return yield* Effect.fail(
        authError("API_KEY_NOT_FOUND", "API key was not found."),
      );
    }
    const principalId = key.principalId;
    const principal =
      principalId === undefined
        ? null
        : ((yield* reader
            .table("servicePrincipals")
            .index("by_principal_key", (q) => q.eq("id", principalId))
            .collect()
            .pipe(Effect.map(requireExactlyOne), Effect.orDie)) ?? null);
    const rowVerification = verifyStoredKeyRow(
      key,
      principal,
      nowMs,
      input.requiredScope,
    );
    if (!rowVerification.ok) return yield* Effect.fail(rowVerification.error);
    const active = yield* assertActiveBrainScope({
      organizationId: rowVerification.organizationId ?? "",
      workspaceId: rowVerification.workspaceId,
      brainKey: rowVerification.brainKey ?? "",
    });
    if (
      key.organizationGeneration !== undefined &&
      key.organizationGeneration !==
        (active.organization.lifecycleGeneration ?? 0)
    )
      return yield* Effect.fail(
        authError("TENANT_INACTIVE", "Tenant generation changed."),
      );
    if (
      key.organizationRevocationGeneration !== undefined &&
      key.organizationRevocationGeneration !==
        (active.organization.revocationGeneration ?? 0)
    )
      return yield* Effect.fail(
        authError("TENANT_INACTIVE", "Tenant revocation changed."),
      );
    if (
      key.workspaceGeneration !== undefined &&
      key.workspaceGeneration !== (active.workspace.lifecycleGeneration ?? 0)
    )
      return yield* Effect.fail(
        authError("TENANT_INACTIVE", "Brain generation changed."),
      );
    if (
      key.workspaceRevocationGeneration !== undefined &&
      key.workspaceRevocationGeneration !==
        (active.workspace.revocationGeneration ?? 0)
    )
      return yield* Effect.fail(
        authError("TENANT_INACTIVE", "Brain revocation changed."),
      );
    const headlessPrincipal =
      headlessPrincipalFromVerification(rowVerification);
    if (headlessPrincipal === undefined) {
      return yield* Effect.fail(
        authError("API_KEY_FORBIDDEN", "API key is not a Brain principal."),
      );
    }
    return {
      principal: headlessPrincipal,
      keyHash: input.keyHash,
      keyId: key._id,
    };
  });

const verifyStoredKeyRow = (
  key: ApiKeyRow,
  principal: import("./auth").ServicePrincipalRow | null,
  nowMs: number,
  requiredScope: HeadlessApiKeyScope,
) => {
  if (key.status === "revoked" || key.revokedAt !== null) {
    return {
      ok: false as const,
      error: authError("API_KEY_REVOKED", "API key has been revoked."),
    };
  }
  if (
    key.status === "expired" ||
    (key.expiresAt !== null && key.expiresAt <= nowMs)
  ) {
    return {
      ok: false as const,
      error: authError("API_KEY_EXPIRED", "API key has expired."),
    };
  }
  if (principal == null) {
    return {
      ok: false as const,
      error: authError(
        "SERVICE_PRINCIPAL_MISSING",
        "Brain API keys require an active service principal.",
      ),
    };
  }
  if (principal.status !== "active" || principal.revokedAt !== null) {
    return {
      ok: false as const,
      error: authError(
        "SERVICE_PRINCIPAL_REVOKED",
        "Service principal has been revoked.",
      ),
    };
  }
  if (!key.scopes.includes(requiredScope)) {
    return {
      ok: false as const,
      error: authError(
        "API_KEY_FORBIDDEN",
        "API key does not include the required scope.",
      ),
    };
  }
  if (
    key.organizationId === undefined ||
    key.brainKey === undefined ||
    key.roleCeiling !== "viewer" ||
    key.principalId === undefined
  ) {
    return {
      ok: false as const,
      error: authError(
        "API_KEY_FORBIDDEN",
        "API key is not a Brain principal.",
      ),
    };
  }
  const scopes = key.scopes.filter(
    (scope): scope is HeadlessApiKeyScope =>
      scope === "brain:read" || scope === "brain:ask",
  );
  return {
    ok: true as const,
    organizationId: key.organizationId,
    workspaceId: key.workspaceId,
    brainKey: key.brainKey,
    roleCeiling: key.roleCeiling,
    keyId: key.id,
    principalId: key.principalId,
    scopes,
  };
};

export const authenticateBrainBearer = (input: {
  readonly authorization: string | undefined;
  readonly requiredScope: HeadlessApiKeyScope;
}) =>
  Effect.gen(function* () {
    const presented = parseBearerApiKey(input.authorization);
    if (presented instanceof HeadlessAuthError)
      return yield* Effect.fail(presented);
    const keyHash = yield* Effect.promise(() => hashPresentedApiKey(presented));
    return yield* authenticateBrainKeyHash({
      keyHash,
      requiredScope: input.requiredScope,
    });
  });

export const markApiKeyLastUsed = (input: {
  readonly keyId: string;
  readonly keyHash: string;
  readonly principalId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly brainKey: string;
}): Effect.Effect<void, never, DatabaseReader | DatabaseWriter> =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const reader = yield* DatabaseReader;
    const keys = yield* reader
      .table("apiKeys")
      .index("by_key_hash", (q) => q.eq("keyHash", input.keyHash))
      .collect()
      .pipe(Effect.orDie);
    const key = requireExactlyOne(keys);
    if (
      key === undefined ||
      key._id !== input.keyId ||
      key.keyHash !== input.keyHash ||
      key.principalId !== input.principalId ||
      key.organizationId !== input.organizationId ||
      key.workspaceId !== input.workspaceId ||
      key.brainKey !== input.brainKey ||
      key.status !== "active" ||
      key.revokedAt !== null ||
      (key.expiresAt !== null && key.expiresAt <= nowMs)
    ) {
      return;
    }
    const principal = yield* reader
      .table("servicePrincipals")
      .index("by_principal_key", (q) => q.eq("id", input.principalId))
      .collect()
      .pipe(Effect.map(requireExactlyOne), Effect.orDie);
    if (
      principal == null ||
      principal.id !== input.principalId ||
      principal.organizationId !== input.organizationId ||
      principal.workspaceId !== input.workspaceId ||
      principal.brainKey !== input.brainKey ||
      principal.status !== "active" ||
      principal.revokedAt !== null ||
      key.principalGeneration !== principal.generation
    ) {
      return;
    }
    const active = yield* assertActiveBrainScope({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
    }).pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (
      active === null ||
      (key.organizationGeneration !== undefined &&
        key.organizationGeneration !==
          (active.organization.lifecycleGeneration ?? 0)) ||
      (key.organizationRevocationGeneration !== undefined &&
        key.organizationRevocationGeneration !==
          (active.organization.revocationGeneration ?? 0)) ||
      (key.workspaceGeneration !== undefined &&
        key.workspaceGeneration !==
          (active.workspace.lifecycleGeneration ?? 0)) ||
      (key.workspaceRevocationGeneration !== undefined &&
        key.workspaceRevocationGeneration !==
          (active.workspace.revocationGeneration ?? 0))
    ) {
      return;
    }
    yield* (yield* DatabaseWriter)
      .table("apiKeys")
      .patch(asGenericId<"apiKeys">(key._id), { lastUsedAt: nowMs })
      .pipe(Effect.catchAll(() => Effect.void));
  });

const currentBrainContext = (brainKey: string) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const identity = yield* extractIdentityProfile(
      yield* auth.getUserIdentity.pipe(
        Effect.mapError(() => new Unauthorized()),
      ),
    );
    if (identity.workosOrganizationId === undefined)
      return yield* Effect.fail(new Unauthorized());
    const reader = yield* DatabaseReader;
    const user = yield* loadCurrentUser(reader);
    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", identity.workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const organization = requireExactlyOne(
      organizations.filter((row) => row.status === "active"),
    );
    if (organization === undefined)
      return yield* Effect.fail(new Unauthorized());
    const workspaces = yield* reader
      .table("workspaces")
      .index("by_organization", (q) => q.eq("organizationId", organization._id))
      .collect()
      .pipe(Effect.orDie);
    const workspace = requireExactlyOne(
      workspaces.filter(
        (row) => row.status === "active" && row.brainKey === brainKey,
      ),
    );
    if (workspace === undefined || workspace.brainKey === undefined)
      return yield* Effect.fail(new Unauthorized());
    const members = yield* reader
      .table("workspaceMembers")
