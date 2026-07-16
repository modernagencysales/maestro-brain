import {
  HeadlessAuthError,
  hashPresentedApiKey,
  parseBearerApiKey,
} from "./headless/auth";
import {
  authorizeHeadlessOperation,
  reviewedHeadlessPolicyFor,
} from "./headless/authorizeOperation";
import type { HeadlessPrincipal } from "./headless/principal";
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
      (scope) => scope === "brain:read" || scope === "brain:ask",
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
}):
  | { readonly ok: true; readonly principal: HeadlessPrincipal }
  | TemplateHttpFailure => {
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
    ...(typeof value.workspaceSlug === "string"
      ? { workspaceSlug: value.workspaceSlug }
      : {}),
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

export const executorRequestFor = (
  operationId: string,
  body: TemplateApiRequestBody,
): ExecutorRequestResult => {
  const input = body.input ?? {};
  const result =
    operationId === "brain.pages.createMarkdown"
      ? createMarkdownExecutorRequest(operationId, body, input)
      : genericExecutorRequest(operationId, body, input);

  return result;
};

const genericExecutorRequest = (
  operationId: string,
  body: TemplateApiRequestBody,
  input: Record<string, JsonValue>,
): ExecutorRequestResult => ({
  ok: true,
  request: {
    operationId,
    surface: "api",
    input,
    ...(body.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: body.idempotencyKey }),
  },
});

const createMarkdownExecutorRequest = (
  operationId: string,
  body: TemplateApiRequestBody,
  input: Record<string, JsonValue>,
): ExecutorRequestResult => {
  let result: ExecutorRequestResult | undefined =
    createMarkdownIdempotencyFailure(body);

  if (result === undefined) {
    result = createMarkdownExecutorRequestWithIdempotency(
      operationId,
      body,
      input,
    );
  }

  return result;
};

const createMarkdownIdempotencyFailure = (
  body: TemplateApiRequestBody,
): TemplateHttpFailure | undefined => {
  const hasInvalidIdempotencyKey =
    body.idempotencyKey?.trim() === "" || body.idempotencyKey === undefined;
  return hasInvalidIdempotencyKey
    ? validationFailed(
        "Operation brain.pages.createMarkdown requires a nonblank idempotencyKey.",
      )
    : undefined;
};

const createMarkdownExecutorRequestWithIdempotency = (
  operationId: string,
  body: TemplateApiRequestBody,
  input: Record<string, JsonValue>,
): ExecutorRequestResult => {
  const workspaceId = createMarkdownWorkspaceId(body, input);
  const result: ExecutorRequestResult = workspaceId
    ? createMarkdownExecutorRequestWithWorkspace(
        operationId,
        body,
        input,
        workspaceId,
      )
    : validationFailed(
        "Operation brain.pages.createMarkdown requires input.workspaceId or a known workspaceSlug.",
      );

  return result;
};

const createMarkdownWorkspaceId = (
  body: TemplateApiRequestBody,
  input: Record<string, JsonValue>,
): string | undefined =>
  typeof input.workspaceId === "string" && input.workspaceId.trim()
    ? input.workspaceId.trim()
    : body.workspaceSlug === undefined
      ? undefined
      : workspaceSlugToId(body.workspaceSlug);

const createMarkdownExecutorRequestWithWorkspace = (
  operationId: string,
  body: TemplateApiRequestBody,
  input: Record<string, JsonValue>,
  workspaceId: string,
): ExecutorRequestResult => {
  const fields = requiredCreateMarkdownInputs(operationId, input);
  const result: ExecutorRequestResult = fields.ok
    ? {
        ok: true,
        request: {
          operationId,
          surface: "api",
          input: {
            workspaceId,
            ...fields.values,
          },
          ...(body.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: body.idempotencyKey }),
        },
      }
    : fields;

  return result;
};

const requiredCreateMarkdownInputs = (
  operationId: string,
  input: Record<string, JsonValue>,
):
  | { readonly ok: true; readonly values: CreateMarkdownInputs }
  | TemplateHttpFailure => {
  const invalidField = createMarkdownInputFields.find(
    (field) => !hasRequiredStringInput(input, field),
  );
  const result =
    invalidField === undefined
      ? {
          ok: true as const,
          values: {
            slug: input.slug as string,
            title: input.title as string,
            markdown: input.markdown as string,
          },
        }
      : validationFailed(
          `Operation ${operationId} requires nonblank input.${invalidField}.`,
        );

  return result;
};

const hasRequiredStringInput = (
  input: Record<string, JsonValue>,
  field: keyof CreateMarkdownInputs,
): boolean => {
  const value = input[field];
  const result = typeof value === "string" ? value.trim().length > 0 : false;

  return result;
};
