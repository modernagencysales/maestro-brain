import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader, DatabaseWriter } from "../_generated/services";
import { Forbidden, Unauthorized, ValidationFailed } from "../errors";
import { asGenericId, loadCurrentUser } from "../access/handlerContext";
import {
  denialAuditReason,
  recordAccessAuditEvent,
  type PrivilegedAccessAuditEvent,
} from "../access/audit";
import { resolveEffectiveWorkspaceRole } from "../access/auth";
import type { Role } from "../access/roles";
import { extractIdentityBinding } from "../access/provisioning";
import apiKeysSpec from "./apiKeys.spec";
import {
  ApiKeyConflict,
  ApiKeyNotFound,
  ApiKeyRevoked,
  BrainApiKeyServerScope,
  HeadlessApiKeyScope,
  HeadlessAuthError,
  type HeadlessAuthErrorCode,
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
import { sha256Base64Url } from "../shared/tokenCrypto";
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

const authError = (
  code: HeadlessAuthErrorCode,
  message: string,
  authWorkCount?: number,
) =>
  new HeadlessAuthError({
    code,
    message,
    ...(authWorkCount === undefined ? {} : { authWorkCount }),
  });

const boundedAuditHash = (value: string): Effect.Effect<string> =>
  Effect.promise(() => sha256Base64Url(value)).pipe(
    Effect.map((hash) => hash.slice(0, 22)),
  );

const deniedApiKeyAuditSubject = (input: {
  readonly operation: "create" | "rotate" | "revoke";
  readonly value: string;
}): Effect.Effect<string> =>
  boundedAuditHash(`${input.operation}:${input.value}`).pipe(
    Effect.map((hash) => `api_key_denied_${input.operation}_${hash}`),
  );

const withAuthWorkCount = (
  error: HeadlessAuthError,
  authWorkCount: number,
): HeadlessAuthError =>
  new HeadlessAuthError({
    code: error.code,
    message: error.message,
    authWorkCount,
  });

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
  return new Forbidden({ reason: "Unable to create API key." });
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
  return new Forbidden({ reason: "Unable to revoke API key." });
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
  return new Forbidden({ reason: "Unable to rotate API key." });
};

const apiKeyAuditEvent = (input: {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly subjectId: string;
  readonly operation: "create" | "rotate" | "revoke";
  readonly outcome: "success" | "denied";
  readonly brainKey: string;
  readonly scopes?: readonly string[];
  readonly reason?: string;
}): PrivilegedAccessAuditEvent => ({
  workspaceId: input.workspaceId,
  action: "apiKey.administered",
  actorUserId: input.actorUserId,
  subjectKind: "privilegedAction",
  subjectId: input.subjectId,
  metadata: {
    outcome: input.outcome,
    operation: input.operation,
    brainKey: input.brainKey,
    ...(input.scopes === undefined ? {} : { scopes: input.scopes.join(",") }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  },
});

const recordApiKeyAuditEvent = (input: {
  readonly event: PrivilegedAccessAuditEvent;
  readonly nowMs: number;
}): Effect.Effect<void, never, DatabaseWriter> =>
  DatabaseWriter.pipe(
    Effect.flatMap((writer) =>
      recordAccessAuditEvent(writer, input.event, input.nowMs),
    ),
  );

const requireAdminProbeKey: ApiKeyRow = {
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
};

const requireAdmin = (actor: { readonly role: Role }) =>
  Effect.try({
    try: () =>
      revokeBrainApiKey({
        key: requireAdminProbeKey,
        actor,
        nowMs: 0,
      }),
    catch: (error) =>
      error instanceof Forbidden
        ? error
        : new Forbidden({ reason: "Unable to verify API key administrator." }),
  }).pipe(
    Effect.catchAll((error) =>
      error.reason === "Only Brain admins may manage API keys."
        ? Effect.fail(error)
        : Effect.void,
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
    yield* requireAdmin(input.actor).pipe(
      Effect.catchAll((error) =>
        deniedApiKeyAuditSubject({
          operation: "create",
          value: input.publicInput.name,
        }).pipe(
          Effect.flatMap((subjectId) =>
            recordApiKeyAuditEvent({
              event: apiKeyAuditEvent({
                workspaceId: input.serverScope.workspaceId,
                actorUserId: input.actor.userId,
                subjectId,
                operation: "create",
                outcome: "denied",
                reason: denialAuditReason(error),
                brainKey: input.serverScope.brainKey,
              }),
              nowMs: input.nowMs,
            }),
          ),
          Effect.catchAllCause(() => Effect.void),
          Effect.flatMap(() => Effect.fail(error)),
        ),
      ),
    );
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
    yield* recordAccessAuditEvent(
      writer,
      apiKeyAuditEvent({
        workspaceId: input.serverScope.workspaceId,
        actorUserId: input.actor.userId,
        subjectId: created.key.displayPrefix,
        operation: "create",
        outcome: "success",
        brainKey: input.serverScope.brainKey,
        scopes: created.key.scopes,
      }),
      input.nowMs,
    );

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
): Effect.Effect<
  null,
  | Forbidden
  | ApiKeyNotFound
  | ApiKeyRevoked
  | ApiKeyConflict
  | HeadlessAuthError,
  DatabaseReader | DatabaseWriter
> =>
  Effect.gen(function* () {
    yield* assertActiveBrainScope(input.serverScope);
    yield* requireAdmin(input.actor).pipe(
      Effect.catchAll((error) =>
        deniedApiKeyAuditSubject({
          operation: "revoke",
          value: input.keyId,
        }).pipe(
          Effect.flatMap((subjectId) =>
            recordApiKeyAuditEvent({
              event: apiKeyAuditEvent({
                workspaceId: input.serverScope.workspaceId,
                actorUserId: input.actor.userId,
                subjectId,
                operation: "revoke",
                outcome: "denied",
                reason: denialAuditReason(error),
                brainKey: input.serverScope.brainKey,
              }),
              nowMs: input.nowMs,
            }),
          ),
          Effect.flatMap(() => Effect.fail(error)),
        ),
      ),
    );
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
    yield* recordAccessAuditEvent(
      writer,
      apiKeyAuditEvent({
        workspaceId: input.serverScope.workspaceId,
        actorUserId: input.actor.userId,
        subjectId: key.displayPrefix,
        operation: "revoke",
        outcome: "success",
        brainKey: input.serverScope.brainKey,
      }),
      input.nowMs,
    );
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
    const principalId = key?.principalId ?? "__missing_principal_probe__";
    const principal =
      (yield* reader
        .table("servicePrincipals")
        .index("by_principal_key", (q) => q.eq("id", principalId))
        .collect()
        .pipe(Effect.map(requireExactlyOne), Effect.orDie)) ?? null;
    const authWorkCount = 2;
    if (key === undefined) {
      return yield* Effect.fail(
        authError("API_KEY_NOT_FOUND", "API key was not found.", authWorkCount),
      );
    }
    const rowVerification = verifyStoredKeyRow(
      key,
      principal,
      nowMs,
      input.requiredScope,
    );
    if (!rowVerification.ok)
      return yield* Effect.fail(
        withAuthWorkCount(rowVerification.error, authWorkCount),
      );
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
  principal: ServicePrincipalRow | null,
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
  if (
    key.principalGeneration !== undefined &&
    key.principalGeneration !== principal.generation
  ) {
    return {
      ok: false as const,
      error: authError(
        "SERVICE_PRINCIPAL_REVOKED",
        "Service principal generation no longer matches the API key.",
      ),
    };
  }
  if (
    key.principalId !== principal.id ||
    key.organizationId === undefined ||
    key.organizationId !== principal.organizationId ||
    key.workspaceId !== principal.workspaceId ||
    key.brainKey === undefined ||
    key.brainKey !== principal.brainKey ||
    key.roleCeiling !== "viewer" ||
    principal.roleCeiling !== "viewer"
  ) {
    return {
      ok: false as const,
      error: authError(
        "API_KEY_FORBIDDEN",
        "API key principal binding does not match.",
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
    const identity = yield* extractIdentityBinding(
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
      .index("by_workspace_user", (q) =>
        q.eq("workspaceId", workspace._id).eq("userId", user._id),
      )
      .collect()
      .pipe(Effect.orDie);
    const organizationMembers = yield* reader
      .table("organizationMembers")
      .index("by_organization_user", (q) =>
        q.eq("organizationId", organization._id).eq("userId", user._id),
      )
      .collect()
      .pipe(Effect.orDie);
    const nowMs = yield* Clock.currentTimeMillis;
    const resolution = resolveEffectiveWorkspaceRole({
      nowMs,
      userId: user._id,
      workspace: {
        id: workspace._id,
        organizationId: organization._id,
        status: workspace.status,
      },
      organization: { id: organization._id, status: organization.status },
      workspaceMembers: members,
      organizationMembers,
      guestGrants: [],
    });
    if (!resolution.ok)
      return yield* Effect.fail(
        new Forbidden({ reason: "Workspace admin required." }),
      );
    return {
      serverScope: {
        organizationId: organization._id,
        workspaceId: workspace._id,
        brainKey: workspace.brainKey,
      },
      actor: { userId: user._id, role: resolution.role },
    };
  });

type GeneratedPublicError =
  | Forbidden
  | Unauthorized
  | ValidationFailed
  | HeadlessAuthError
  | ApiKeyScopeInvalid
  | ApiKeyExpiryInvalid
  | ApiKeyConflict
  | ApiKeyNotFound
  | ApiKeyRevoked;

const toPublicForbidden = (
  error: GeneratedPublicError,
): Forbidden | Unauthorized => {
  if (error instanceof HeadlessAuthError)
    return new Forbidden({ reason: "Brain scope is not available." });
  if (error instanceof Forbidden || error instanceof Unauthorized) return error;
  if (error instanceof ValidationFailed)
    return new Forbidden({ reason: error.message });
  return new Forbidden({ reason: "API key operation is not available." });
};

const toCreateError = (
  error: GeneratedPublicError,
):
  | Forbidden
  | Unauthorized
  | ApiKeyScopeInvalid
  | ApiKeyExpiryInvalid
  | ApiKeyConflict => {
  if (
    error instanceof ApiKeyScopeInvalid ||
    error instanceof ApiKeyExpiryInvalid ||
    error instanceof ApiKeyConflict
  ) {
    return error;
  }
  return toPublicForbidden(error);
};

const toRevokeError = (
  error: GeneratedPublicError,
):
  | Forbidden
  | Unauthorized
  | ApiKeyNotFound
  | ApiKeyRevoked
  | ApiKeyConflict => {
  if (
    error instanceof ApiKeyNotFound ||
    error instanceof ApiKeyRevoked ||
    error instanceof ApiKeyConflict
  ) {
    return error;
  }
  return toPublicForbidden(error);
};

const toRotateError = (
  error: GeneratedPublicError,
):
  | Forbidden
  | Unauthorized
  | ApiKeyNotFound
  | ApiKeyRevoked
  | ApiKeyExpiryInvalid
  | ApiKeyConflict => {
  if (
    error instanceof ApiKeyNotFound ||
    error instanceof ApiKeyRevoked ||
    error instanceof ApiKeyExpiryInvalid ||
    error instanceof ApiKeyConflict
  ) {
    return error;
  }
  return toPublicForbidden(error);
};

const create = FunctionImpl.make(
  databaseSchema,
  apiKeysSpec,
  "create",
  (input) =>
    Effect.gen(function* () {
      const context = yield* currentBrainContext(input.brainKey);
      const nowMs = yield* Clock.currentTimeMillis;
      return yield* createApiKeyForBrain({
        ...context,
        publicInput: input,
        nowMs,
      });
    }).pipe(Effect.mapError((error) => toCreateError(error))),
);

const list = FunctionImpl.make(databaseSchema, apiKeysSpec, "list", (input) =>
  currentBrainContext(input.brainKey).pipe(
    Effect.flatMap(listApiKeysForBrain),
    Effect.mapError((error) => toPublicForbidden(error)),
  ),
);

const revoke = FunctionImpl.make(
  databaseSchema,
  apiKeysSpec,
  "revoke",
  ({ brainKey, keyId }) =>
    Effect.gen(function* () {
      const context = yield* currentBrainContext(brainKey);
      const nowMs = yield* Clock.currentTimeMillis;
      return yield* revokeApiKeyForBrain({ ...context, keyId, nowMs });
    }).pipe(Effect.mapError((error) => toRevokeError(error))),
);

export const rotateApiKeyForBrain = (
  input: PublicApiKeyServerContext & {
    readonly keyId: string;
    readonly expiresAt: number;
    readonly nowMs: number;
    readonly randomBytes?: () => Uint8Array;
  },
): Effect.Effect<
  PublicBrainApiKeyCreateResult,
  | Forbidden
  | ApiKeyNotFound
  | ApiKeyRevoked
  | ApiKeyExpiryInvalid
  | ApiKeyConflict
  | HeadlessAuthError,
  DatabaseReader | DatabaseWriter
> =>
  Effect.gen(function* () {
    const { organization, workspace } = yield* assertActiveBrainScope(
      input.serverScope,
    );
    yield* requireAdmin(input.actor).pipe(
      Effect.catchAll((error) =>
        deniedApiKeyAuditSubject({
          operation: "rotate",
          value: input.keyId,
        }).pipe(
          Effect.flatMap((subjectId) =>
            recordApiKeyAuditEvent({
              event: apiKeyAuditEvent({
                workspaceId: input.serverScope.workspaceId,
                actorUserId: input.actor.userId,
                subjectId,
                operation: "rotate",
                outcome: "denied",
                reason: denialAuditReason(error),
                brainKey: input.serverScope.brainKey,
              }),
              nowMs: input.nowMs,
            }),
          ),
          Effect.flatMap(() => Effect.fail(error)),
        ),
      ),
    );
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
    const principal = yield* reader
      .table("servicePrincipals")
      .index("by_principal_key", (q) => q.eq("id", key.principalId ?? ""))
      .collect()
      .pipe(Effect.map(requireExactlyOne), Effect.orDie);
    if (principal === undefined) {
      return yield* Effect.fail(new ApiKeyNotFound({ keyId: input.keyId }));
    }
    const rotated = yield* Effect.tryPromise({
      try: () =>
        rotateBrainApiKey({
          key,
          principal,
          actor: input.actor,
          nowMs: input.nowMs,
          expiresAt: input.expiresAt,
          ...(input.randomBytes === undefined
            ? {}
            : { randomBytes: input.randomBytes }),
        }),
      catch: knownRotateError,
    });
    const hashMatches = yield* reader
      .table("apiKeys")
      .index("by_key_hash", (q) => q.eq("keyHash", rotated.key.keyHash))
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
      .patch(asGenericId<"servicePrincipals">(principal._id), {
        generation: rotated.principal.generation,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("apiKeys")
      .patch(asGenericId<"apiKeys">(key._id), {
        status: rotated.revokedKey.status,
        revokedAt: rotated.revokedKey.revokedAt,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("apiKeys")
      .insert({
        ...rotated.key,
        organizationGeneration: organization.lifecycleGeneration ?? 0,
        organizationRevocationGeneration:
          organization.revocationGeneration ?? 0,
        workspaceGeneration: workspace.lifecycleGeneration ?? 0,
        workspaceRevocationGeneration: workspace.revocationGeneration ?? 0,
      })
      .pipe(Effect.orDie);
    yield* recordAccessAuditEvent(
      writer,
      apiKeyAuditEvent({
        workspaceId: input.serverScope.workspaceId,
        actorUserId: input.actor.userId,
        subjectId: rotated.key.displayPrefix,
        operation: "rotate",
        outcome: "success",
        brainKey: input.serverScope.brainKey,
      }),
      input.nowMs,
    );
    return { displayKey: rotated.displayKey, key: publicMetadata(rotated.key) };
  });

const rotate = FunctionImpl.make(
  databaseSchema,
  apiKeysSpec,
  "rotate",
  ({ brainKey, keyId, expiresAt }) =>
    Effect.gen(function* () {
      const context = yield* currentBrainContext(brainKey);
      const nowMs = yield* Clock.currentTimeMillis;
      return yield* rotateApiKeyForBrain({
        ...context,
        keyId,
        expiresAt,
        nowMs,
      });
    }).pipe(Effect.mapError((error) => toRotateError(error))),
);

const authenticate = FunctionImpl.make(
  databaseSchema,
  apiKeysSpec,
  "authenticate",
  authenticateBrainKeyHash,
);

const markLastUsed = FunctionImpl.make(
  databaseSchema,
  apiKeysSpec,
  "markLastUsed",
  (input) => markApiKeyLastUsed(input).pipe(Effect.as(null)),
);

export default GroupImpl.make(databaseSchema, apiKeysSpec).pipe(
  Layer.provide(create),
  Layer.provide(list),
  Layer.provide(revoke),
  Layer.provide(rotate),
  Layer.provide(authenticate),
  Layer.provide(markLastUsed),
  GroupImpl.finalize,
);
