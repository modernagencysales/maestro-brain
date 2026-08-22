import {
  HeadlessAuthError,
  hashPresentedApiKey,
  parseBearerApiKey,
} from "./headless/auth";
import {
  authorizeHeadlessOperation,
  reviewedHeadlessPolicyFor,
  type HeadlessOperationPolicy,
} from "./headless/authorizeOperation";
import type { HeadlessPrincipal } from "./headless/principal";
import {
  type HeadlessExecutorRequest,
  type JsonValue,
} from "./manifest/executor";

export type TemplateApiRequestBody = {
  readonly workspaceSlug?: string;
  readonly input?: Record<string, JsonValue>;
  readonly idempotencyKey?: string;
};

type TemplateHttpFailure = {
  readonly ok: false;
  readonly error: {
    readonly _tag:
      "Unauthorized" | "Forbidden" | "ValidationFailed" | "RateLimited";
    readonly message: string;
  };
};

type ParsedTemplateApiRequestBody =
  | { readonly ok: true; readonly body: TemplateApiRequestBody }
  | TemplateHttpFailure;

type ExecutorRequestResult =
  | { readonly ok: true; readonly request: HeadlessExecutorRequest }
  | TemplateHttpFailure;

export type HeadlessBearerKeyHash =
  { readonly ok: true; readonly keyHash: string } | TemplateHttpFailure;

export type HeadlessBearerAuthentication =
  | {
      readonly ok: true;
      readonly principal: HeadlessPrincipal;
      readonly keyHash: string;
      readonly keyId?: string;
    }
  | TemplateHttpFailure;

const validationFailed = (message: string): TemplateHttpFailure => ({
  ok: false,
  error: {
    _tag: "ValidationFailed",
    message,
  },
});

const unauthorized = (): TemplateHttpFailure => ({
  ok: false,
  error: { _tag: "Unauthorized", message: "Unauthorized." },
});

const forbidden = (): TemplateHttpFailure => ({
  ok: false,
  error: { _tag: "Forbidden", message: "Forbidden." },
});

export const rateLimited = (
  message = "Rate limited.",
): TemplateHttpFailure => ({
  ok: false,
  error: { _tag: "RateLimited", message },
});

const authFailureFor = (error: HeadlessAuthError): TemplateHttpFailure =>
  error.code === "API_KEY_FORBIDDEN" ? forbidden() : unauthorized();
export const bearerKeyHashForRequest = async (
  authorization: string | undefined,
): Promise<HeadlessBearerKeyHash> => {
  const presented = parseBearerApiKey(authorization);
  if (presented instanceof HeadlessAuthError) return authFailureFor(presented);

  return { ok: true, keyHash: await hashPresentedApiKey(presented) };
};

export const authenticateBearerRequest = async (input: {
  readonly keyHash: string;
  readonly runAuthenticate: (keyHash: string) => Promise<unknown>;
}): Promise<HeadlessBearerAuthentication> => {
  try {
    return normalizeAuthenticatedPrincipal(
      await input.runAuthenticate(input.keyHash),
      input.keyHash,
    );
  } catch {
    return unauthorized();
  }
};

const normalizeAuthenticatedPrincipal = (
  value: unknown,
  fallbackKeyHash: string,
): HeadlessBearerAuthentication => {
  if (!isObjectRecord(value) || !isObjectRecord(value.principal)) {
    return unauthorized();
  }
  const principal = value.principal;
  if (
    typeof principal.organizationId !== "string" ||
    typeof principal.workspaceId !== "string" ||
    typeof principal.brainKey !== "string" ||
    principal.roleCeiling !== "viewer" ||
    typeof principal.keyId !== "string" ||
    typeof principal.principalId !== "string" ||
    !Array.isArray(principal.scopes) ||
    !principal.scopes.every(
      (scope) =>
        scope === "brain:read" ||
        scope === "brain:ask" ||
        scope === "brain:write",
    )
  ) {
    return unauthorized();
  }
  return {
    ok: true,
    principal: principal as HeadlessPrincipal,
    keyHash:
      typeof value.keyHash === "string" ? value.keyHash : fallbackKeyHash,
    ...(typeof value.keyId === "string" ? { keyId: value.keyId } : {}),
  };
};

export const authorizeOperationBeforeDecode = (input: {
  readonly operationId: string;
  readonly principal: HeadlessPrincipal;
  readonly policy?: HeadlessOperationPolicy;
}):
  | { readonly ok: true; readonly principal: HeadlessPrincipal }
  | TemplateHttpFailure => {
  const policy = input.policy ?? reviewedHeadlessPolicyFor(input.operationId);
  if (policy === undefined) return forbidden();
  if (!input.principal.scopes.includes(policy.requiredScope))
    return forbidden();
  return { ok: true, principal: input.principal };
};

export const readJsonBody = async (
  request: Request,
): Promise<ParsedTemplateApiRequestBody> => {
  let parsed: ParsedTemplateApiRequestBody = { ok: true, body: {} };

  if (hasJsonRequestBody(request)) {
    parsed = await parseJsonRequestBody(request);
  }

  return parsed;
};

const hasJsonRequestBody = (request: Request): boolean => {
  const contentType = request.headers.get("content-type") ?? "";
  return request.body !== null && contentType.includes("application/json");
};

const parseJsonRequestBody = async (
  request: Request,
): Promise<ParsedTemplateApiRequestBody> => {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return validationFailed("Request body must be valid JSON.");
  }

  return { ok: true, body: templateApiRequestBodyFrom(value) };
};

const templateApiRequestBodyFrom = (value: unknown): TemplateApiRequestBody => {
  if (!isObjectRecord(value)) return {};

  const input = isObjectRecord(value.input)
    ? { ...(value.input as Record<string, JsonValue>) }
    : {};
  for (const field of [
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
    "_id",
    "id",
  ] as const) {
    if (field in value) input[field] = value[field] as JsonValue;
  }
  return {
    input,
    ...(typeof value.idempotencyKey === "string"
      ? { idempotencyKey: value.idempotencyKey }
      : {}),
  };
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const authenticatedExecutorRequestFor = async (input: {
  readonly operationId: string;
  readonly principal: HeadlessPrincipal;
  readonly body: TemplateApiRequestBody;
  readonly policy?: HeadlessOperationPolicy;
}): Promise<ExecutorRequestResult> => {
  const policy = input.policy ?? reviewedHeadlessPolicyFor(input.operationId);
  const authorized = authorizeHeadlessOperation({
    operationId: input.operationId,
    principal: input.principal,
    operationInput: input.body.input ?? {},
    ...(policy === undefined ? {} : { policy }),
  });

  if (!authorized.ok) return authorized;

  return {
    ok: true,
    request: {
      operationId: input.operationId,
      surface: "api",
      input: authorized.input,
      ...(input.body.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: input.body.idempotencyKey }),
    },
  };
};

export const executorRequestFor = (
  operationId: string,
  body: TemplateApiRequestBody,
): ExecutorRequestResult => ({
  ok: true,
  request: {
    operationId,
    surface: "api",
    input: body.input ?? {},
    ...(body.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: body.idempotencyKey }),
  },
});
