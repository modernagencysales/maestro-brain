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
import { extractIdentityProfile } from "../access/provisioning";
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
