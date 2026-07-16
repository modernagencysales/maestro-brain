import {
  HeadlessAuthError,
  parseBearerApiKey,
  verifyApiKey,
  type ApiKeyRow,
  type ServicePrincipalRow,
} from "./headless/auth";
import {
  authorizeHeadlessOperation,
  reviewedHeadlessPolicyFor,
} from "./headless/authorizeOperation";
import {
  headlessPrincipalFromVerification,
  type HeadlessPrincipal,
} from "./headless/principal";
import {
  type HeadlessExecutorRequest,
  type JsonValue,
} from "./manifest/executor";

export type TemplateApiRequestBody = {
  readonly input?: Record<string, JsonValue>;
  readonly idempotencyKey?: string;
};

type TemplateHttpFailure = {
  readonly ok: false;
  readonly error: {
    readonly _tag: "Unauthorized" | "Forbidden" | "ValidationFailed";
    readonly message: string;
  };
};

type ParsedTemplateApiRequestBody =
  | { readonly ok: true; readonly body: TemplateApiRequestBody }
  | TemplateHttpFailure;

type ExecutorRequestResult =
  | { readonly ok: true; readonly request: HeadlessExecutorRequest }
  | TemplateHttpFailure;

export type HeadlessBearerAuthContext = {
  readonly authorization: string | undefined;
  readonly keys?: readonly ApiKeyRow[];
  readonly principals?: readonly ServicePrincipalRow[];
  readonly nowMs: number;
};

export type HeadlessBearerAuthentication =
  | { readonly ok: true; readonly principal: HeadlessPrincipal }
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

const authFailureFor = (error: HeadlessAuthError): TemplateHttpFailure =>
  error.code === "API_KEY_FORBIDDEN" ? forbidden() : unauthorized();

export const authenticateBearerRequest = async (
  input: HeadlessBearerAuthContext,
): Promise<HeadlessBearerAuthentication> => {
  const presented = parseBearerApiKey(input.authorization);
  if (presented instanceof HeadlessAuthError) return authFailureFor(presented);

  const verification = await verifyApiKey({
    presentedKey: presented,
    keys: input.keys ?? [],
    principals: input.principals ?? [],
    nowMs: input.nowMs,
    requiredScope: "brain:read",
  });
  if (!verification.ok) return authFailureFor(verification.error);

  const principal = headlessPrincipalFromVerification(verification);
  return principal === undefined ? unauthorized() : { ok: true, principal };
};

export const authorizeOperationBeforeDecode = (input: {
  readonly operationId: string;
  readonly principal: HeadlessPrincipal;
}): HeadlessBearerAuthentication => {
  const policy = reviewedHeadlessPolicyFor(input.operationId);
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

  return {
    ...(isObjectRecord(value.input)
      ? { input: value.input as Record<string, JsonValue> }
      : {}),
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
}): Promise<ExecutorRequestResult> => {
  const policy = reviewedHeadlessPolicyFor(input.operationId);
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
