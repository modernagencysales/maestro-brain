import * as Either from "effect/Either";

import type { WorkspaceRole } from "../../providers/workspace";
import type { PublicApiKeySettingsMetadata } from "./api-keys";

export type ApiKeyMutationResult<T> = T | Either.Either<T, unknown>;

export type ApiKeyMutations = {
  readonly create: (args: {
    readonly brainKey: string;
    readonly name: string;
    readonly scopes: readonly ("brain:read" | "brain:ask")[];
    readonly expiresAt: number;
  }) => Promise<
    ApiKeyMutationResult<{
      readonly displayKey: string;
      readonly key: PublicApiKeySettingsMetadata;
    }>
  >;
  readonly rotate: (args: {
    readonly brainKey: string;
    readonly keyId: string;
    readonly expiresAt: number;
  }) => Promise<
    ApiKeyMutationResult<{
      readonly displayKey: string;
      readonly key: PublicApiKeySettingsMetadata;
    }>
  >;
  readonly revoke: (args: {
    readonly brainKey: string;
    readonly keyId: string;
  }) => Promise<ApiKeyMutationResult<null>>;
};

export type ApiKeySettingsAdapter = {
  readonly role: WorkspaceRole;
  readonly brainKey: string;
  readonly canAdministerKeys: boolean;
  readonly createKey: (input: {
    readonly name: string;
    readonly scopes: readonly ("brain:read" | "brain:ask")[];
    readonly expiresAt: number;
  }) => Promise<string>;
  readonly rotateKey: (input: {
    readonly keyId: string;
    readonly expiresAt: number;
  }) => Promise<string>;
  readonly revokeKey: (input: { readonly keyId: string }) => Promise<void>;
};

export const createApiKeySettingsAdapter = ({
  role,
  brainKey,
  mutations,
}: {
  readonly role: WorkspaceRole;
  readonly brainKey: string;
  readonly mutations: ApiKeyMutations;
}): ApiKeySettingsAdapter => {
  const canAdministerKeys = role === "admin" || role === "owner";
  const requireAdmin = () => {
    if (!canAdministerKeys) {
      throw new Error("API key administration requires admin or owner role.");
    }
  };

  return {
    role,
    brainKey,
    canAdministerKeys,
    createKey: async ({ name, scopes, expiresAt }) => {
      requireAdmin();
      const result = unwrapMutationResult(
        await mutations.create({ brainKey, name, scopes, expiresAt }),
      );
      return result.displayKey;
    },
    rotateKey: async ({ keyId, expiresAt }) => {
      requireAdmin();
      const result = unwrapMutationResult(
        await mutations.rotate({ brainKey, keyId, expiresAt }),
      );
      return result.displayKey;
    },
    revokeKey: async ({ keyId }) => {
      requireAdmin();
      unwrapMutationResult(await mutations.revoke({ brainKey, keyId }));
    },
  };
};

const unwrapMutationResult = <T>(result: ApiKeyMutationResult<T>): T => {
  if (Either.isEither(result)) {
    if (Either.isLeft(result)) throw result.left;
    return result.right;
  }

  return result;
};
