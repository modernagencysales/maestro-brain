import type { ApiKeyVerificationSuccess, HeadlessApiKeyScope } from "./auth";

export type HeadlessPrincipal = {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly roleCeiling: "viewer";
  readonly keyId: string;
  readonly principalId: string;
  readonly scopes: readonly HeadlessApiKeyScope[];
};

const isHeadlessScope = (scope: string): scope is HeadlessApiKeyScope =>
  scope === "brain:read" || scope === "brain:ask";

export const createHeadlessPrincipal = (
  input: HeadlessPrincipal,
): HeadlessPrincipal => input;

export const headlessPrincipalFromVerification = (
  verification: ApiKeyVerificationSuccess,
): HeadlessPrincipal | undefined => {
  if (
    verification.organizationId === undefined ||
    verification.brainKey === undefined ||
    verification.roleCeiling !== "viewer" ||
    verification.principalId === undefined ||
    !verification.scopes.every(isHeadlessScope)
  ) {
    return undefined;
  }

  return createHeadlessPrincipal({
    organizationId: verification.organizationId,
    workspaceId: verification.workspaceId,
    brainKey: verification.brainKey,
    roleCeiling: verification.roleCeiling,
    keyId: verification.keyId,
    principalId: verification.principalId,
    scopes: verification.scopes,
  });
};
