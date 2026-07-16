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
    readonly _tag: "ValidationFailed";
    readonly message: string;
  };
};

type ParsedTemplateApiRequestBody =
  | { readonly ok: true; readonly body: TemplateApiRequestBody }
  | TemplateHttpFailure;

type ExecutorRequestResult =
  | { readonly ok: true; readonly request: HeadlessExecutorRequest }
  | TemplateHttpFailure;

const validationFailed = (message: string): TemplateHttpFailure => ({
  ok: false,
  error: {
    _tag: "ValidationFailed",
    message,
  },
});

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
  return genericExecutorRequest(operationId, body, input);
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
