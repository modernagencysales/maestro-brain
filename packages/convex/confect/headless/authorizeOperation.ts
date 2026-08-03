import type { HeadlessApiKeyScope } from "./auth";
import type { HeadlessPrincipal } from "./principal";
import type { JsonValue } from "../manifest/executor";

export type HeadlessOperationPolicy = {
  readonly operationId: string;
  readonly headless: true;
  readonly requiredScope: HeadlessApiKeyScope;
};

export type HeadlessAuthorizationFailure = {
  readonly ok: false;
  readonly error: {
    readonly _tag: "Forbidden" | "ValidationFailed";
    readonly message: string;
  };
};

export type HeadlessAuthorizationSuccess = {
  readonly ok: true;
  readonly input: Record<string, JsonValue>;
};

export type HeadlessAuthorizationResult =
  HeadlessAuthorizationSuccess | HeadlessAuthorizationFailure;

const reviewedHeadlessPolicies = [
  {
    operationId: "brain.pages.list",
    headless: true,
    requiredScope: "brain:read",
  },
  {
    operationId: "brain.pages.get",
    headless: true,
    requiredScope: "brain:read",
  },
  {
    operationId: "brain.pages.history",
    headless: true,
    requiredScope: "brain:read",
  },
  {
    operationId: "brain.sources.search",
    headless: true,
    requiredScope: "brain:read",
  },
  {
    operationId: "brain.sources.get",
    headless: true,
    requiredScope: "brain:read",
  },
  {
    operationId: "brain.context.get",
    headless: true,
    requiredScope: "brain:read",
  },
  {
    operationId: "brain.answers.ask",
    headless: true,
    requiredScope: "brain:ask",
  },
] as const satisfies readonly HeadlessOperationPolicy[];

const tenantInputFields = new Set([
  "organizationId",
  "organizationKey",
  "agencyKey",
  "workspaceId",
  "workspaceKey",
  "workspaceSlug",
  "brainId",
  "brainKey",
  "userId",
  "memberId",
  "keyId",
  "apiKeyId",
  "_id",
  "id",
]);

const forbidden = (): HeadlessAuthorizationFailure => ({
  ok: false,
  error: {
    _tag: "Forbidden",
    message: `Headless operation is not available.`,
  },
});

const validationFailed = (): HeadlessAuthorizationFailure => ({
  ok: false,
  error: {
    _tag: "ValidationFailed",
    message:
      "Headless requests must derive tenant and Brain scope from the bearer key.",
  },
});

export const reviewedHeadlessPolicyFor = (
  operationId: string,
  policies: readonly HeadlessOperationPolicy[] = reviewedHeadlessPolicies,
): HeadlessOperationPolicy | undefined =>
  policies.find((policy) => policy.operationId === operationId);

export const containsTenantInputField = (value: JsonValue): boolean => {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsTenantInputField);

  return Object.entries(value).some(
    ([field, nested]) =>
      tenantInputFields.has(field) || containsTenantInputField(nested),
  );
};

export const authorizeHeadlessOperation = (input: {
  readonly operationId: string;
  readonly principal: HeadlessPrincipal;
  readonly operationInput: Record<string, JsonValue>;
  readonly policy?: HeadlessOperationPolicy;
}): HeadlessAuthorizationResult => {
  const policy = input.policy ?? reviewedHeadlessPolicyFor(input.operationId);
  if (policy === undefined) return forbidden();
  if (containsTenantInputField(input.operationInput)) return validationFailed();
  if (!input.principal.scopes.includes(policy.requiredScope)) {
    return forbidden();
  }

  return {
    ok: true,
    input: {
      ...input.operationInput,
      organizationId: input.principal.organizationId,
      workspaceId: input.principal.workspaceId,
      brainKey: input.principal.brainKey,
    },
  };
};
