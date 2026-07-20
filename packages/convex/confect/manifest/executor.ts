import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";
import {
  authorizeHeadlessOperation,
  reviewedHeadlessPolicyFor,
  type HeadlessOperationPolicy,
} from "../headless/authorizeOperation";
import type { HeadlessPrincipal } from "../headless/principal";
import {
  type IdempotencyKeyValidationError,
  validateCallerIdempotencyKey,
} from "../shared/idempotencyKey";

export type HeadlessSurface = "api" | "cli" | "mcp";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type HeadlessExecutorRequest = {
  readonly operationId: string;
  readonly surface: HeadlessSurface;
  readonly input: Record<string, JsonValue>;
  readonly idempotencyKey?: string;
};

export type AuthorizedHeadlessExecutorRequest = HeadlessExecutorRequest & {
  readonly principal: HeadlessPrincipal;
  readonly policy: HeadlessOperationPolicy;
};

export type HeadlessFailureResult = {
  readonly ok: false;
  readonly error: {
    readonly _tag:
      "Unauthorized" | "ValidationFailed" | "Forbidden" | "RateLimited";
    readonly message: string;
  };
};

type HeadlessManifestOperation = (typeof confectManifest.functions)[number];

export type HeadlessSuccessResult = {
  readonly ok: true;
  readonly operationId: HeadlessManifestOperation["operationId"];
  readonly result: JsonValue;
};

export type HeadlessExecutorResult =
  HeadlessSuccessResult | HeadlessFailureResult;

export type HeadlessExecutionAdapter = {
  readonly refs: Record<string, unknown>;
  readonly runQuery: (
    ref: unknown,
    input: Record<string, JsonValue>,
    operation: HeadlessManifestOperation,
  ) => unknown | Promise<unknown>;
  readonly runMutation: (
    ref: unknown,
    input: Record<string, JsonValue>,
    operation: HeadlessManifestOperation,
  ) => unknown | Promise<unknown>;
  readonly runAction: (
    ref: unknown,
    input: Record<string, JsonValue>,
    operation: HeadlessManifestOperation,
  ) => unknown | Promise<unknown>;
};

export const headlessFailure = (
  tag: HeadlessFailureResult["error"]["_tag"],
  message: string,
): HeadlessFailureResult => ({
  ok: false,
  error: {
    _tag: tag,
    message,
  },
});

const isLegacyCreateMarkdownOperation = (operationId: string): boolean =>
  operationId === "brain.pages.createMarkdown";

export const findHeadlessOperation = (
  operationId: string,
  surface: HeadlessSurface,
): HeadlessManifestOperation | undefined =>
  isLegacyCreateMarkdownOperation(operationId)
    ? undefined
    : confectManifest.functions.find(
        (operation) =>
          operation.operationId === operationId &&
          operation.surfaces.some((candidate: string) => candidate === surface),
      );

export const resolveHeadlessOperation = (
  request: HeadlessExecutorRequest,
):
  | { readonly ok: true; readonly operation: HeadlessManifestOperation }
  | HeadlessFailureResult => {
  const operation = findHeadlessOperation(request.operationId, request.surface);

  if (!operation) {
    return headlessFailure(
      "ValidationFailed",
      "Headless operation is not available.",
    );
  }

  return { ok: true, operation };
};

const isPlainObject = (
  value: object,
): value is { readonly [key: string]: unknown } => {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
};

const primitiveJsonTypes = new Set<string>(["boolean", "string"]);

const isJsonValue = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): value is JsonValue => {
  const primitiveResult = primitiveJsonResult(value);
  const result = primitiveResult ?? isObjectJsonValue(value as object, seen);

  return result;
};

const primitiveJsonResult = (value: unknown): boolean | undefined => {
  let result: boolean | undefined;

  if (value === null) {
    result = true;
  } else if (primitiveJsonTypes.has(typeof value)) {
    result = true;
  } else if (typeof value === "number") {
    result = Number.isFinite(value);
  } else if (typeof value !== "object") {
    result = false;
  }

  return result;
};

const isObjectJsonValue = (value: object, seen: WeakSet<object>): boolean => {
  let result = false;

  if (!seen.has(value)) {
    seen.add(value);
    result = Array.isArray(value)
      ? value.every((item: unknown) => isJsonValue(item, seen))
      : isPlainJsonObject(value, seen);
  }

  return result;
};

const isPlainJsonObject = (value: object, seen: WeakSet<object>): boolean =>
  isPlainObject(value) &&
  Object.values(value).every((item) => isJsonValue(item, seen));

const isJsonRecordObject = (
  value: object,
): value is Record<string, JsonValue> =>
  !Array.isArray(value) && isPlainObject(value) && isJsonValue(value);

const isNonNullObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const isJsonRecord = (value: unknown): value is Record<string, JsonValue> =>
  isNonNullObject(value) && isJsonRecordObject(value);

type PreparedHeadlessExecution = {
  readonly ok: true;
  readonly operation: HeadlessManifestOperation;
  readonly ref: unknown;
  readonly input: Record<string, JsonValue>;
};

type DispatchSuccess = {
  readonly ok: true;
  readonly result: unknown;
};

type DispatchResult = DispatchSuccess | HeadlessFailureResult;

type HeadlessOperationKind = "query" | "mutation" | "action";

const headlessOperationKinds = new Set<string>(["query", "mutation", "action"]);

const isHeadlessOperationKind = (kind: string): kind is HeadlessOperationKind =>
  headlessOperationKinds.has(kind);

const idempotencyFailureFor = (
  operation: HeadlessManifestOperation,
  idempotencyKey: IdempotencyKeyValidationError | string | undefined,
): HeadlessFailureResult | undefined => {
  if (typeof idempotencyKey === "string") {
    return undefined;
  }

  if (idempotencyKey === undefined || idempotencyKey.reason === "missing") {
    if (operation.idempotent) {
      return undefined;
    }

    return headlessFailure(
      "ValidationFailed",
      `Operation ${operation.operationId} requires a nonblank idempotencyKey.`,
    );
  }

  return headlessFailure(
    "ValidationFailed",
    `Operation ${operation.operationId} received invalid idempotencyKey: ${idempotencyKey.message}`,
  );
};

const inputFailureFor = (
  operation: HeadlessManifestOperation,
  input: unknown,
): HeadlessFailureResult | undefined =>
  isJsonRecord(input)
    ? undefined
    : headlessFailure(
        "ValidationFailed",
        `Operation ${operation.operationId} received non-JSON-safe input.`,
      );

const refFailureFor = (
  operation: HeadlessManifestOperation,
  ref: unknown,
): HeadlessFailureResult | undefined =>
  ref
    ? undefined
    : headlessFailure(
        "ValidationFailed",
        "Headless operation is not available.",
      );

const inputWithIdempotencyKey = (
  input: Record<string, JsonValue>,
  idempotencyKey: string | undefined,
): Record<string, JsonValue> =>
  idempotencyKey === undefined ? input : { ...input, idempotencyKey };

const prepareHeadlessExecution = (
  adapter: HeadlessExecutionAdapter,
  request: HeadlessExecutorRequest,
): PreparedHeadlessExecution | HeadlessFailureResult => {
  const resolved = resolveHeadlessOperation(request);
  let result: PreparedHeadlessExecution | HeadlessFailureResult;

  if (resolved.ok) {
    const { operation } = resolved;
    const idempotencyKeyResult = validateCallerIdempotencyKey(
      request.idempotencyKey,
    );
    const idempotencyValidation = idempotencyKeyResult.ok
      ? idempotencyKeyResult.value
      : idempotencyKeyResult.error;
    const idempotencyKey = idempotencyKeyResult.ok
      ? idempotencyKeyResult.value
      : undefined;
    const ref = adapter.refs[operation.operationId];
    const validationFailure =
      idempotencyFailureFor(operation, idempotencyValidation) ??
      inputFailureFor(operation, request.input) ??
      refFailureFor(operation, ref);

    result =
      validationFailure ??
      ({
        ok: true,
        operation,
        ref,
        input: inputWithIdempotencyKey(request.input, idempotencyKey),
      } satisfies PreparedHeadlessExecution);
  } else {
    result = resolved;
  }

  return result;
};

const dispatchHeadlessOperation = async (
  adapter: HeadlessExecutionAdapter,
  execution: PreparedHeadlessExecution,
): Promise<DispatchResult> => {
  const operationKind: string = execution.operation.kind;
  const runner = isHeadlessOperationKind(operationKind)
    ? {
        query: adapter.runQuery,
        mutation: adapter.runMutation,
        action: adapter.runAction,
      }[operationKind]
    : undefined;
  const result =
    runner === undefined
      ? headlessFailure(
          "ValidationFailed",
          `Operation ${execution.operation.operationId} has unsupported kind ${operationKind}.`,
        )
      : ({
          ok: true,
          result: await runner(
            execution.ref,
            execution.input,
            execution.operation,
          ),
        } satisfies DispatchSuccess);

  return result;
};

const jsonResultFor = (
  operation: HeadlessManifestOperation,
  result: unknown,
): HeadlessExecutorResult =>
  isJsonValue(result)
    ? successResultFor(operation, result)
    : headlessFailure(
        "ValidationFailed",
        `Operation ${operation.operationId} returned a non-JSON-safe result.`,
      );

const successResultFor = (
  operation: HeadlessManifestOperation,
  result: JsonValue,
): HeadlessSuccessResult => ({
  ok: true,
  operationId: operation.operationId,
  result,
});

const completeHeadlessExecution = (
  execution: PreparedHeadlessExecution,
  dispatchResult: DispatchResult,
): HeadlessExecutorResult => {
  const result = dispatchResult.ok
    ? jsonResultFor(execution.operation, dispatchResult.result)
    : dispatchResult;

  return result;
};

export const executeHeadlessOperation = async (
  adapter: HeadlessExecutionAdapter,
  request: HeadlessExecutorRequest,
): Promise<HeadlessExecutorResult> => {
  const execution = prepareHeadlessExecution(adapter, request);
  const result = execution.ok
    ? completeHeadlessExecution(
        execution,
        await dispatchHeadlessOperation(adapter, execution),
      )
    : execution;

  return result;
};

export const executeAuthorizedHeadlessOperation = async (
  adapter: HeadlessExecutionAdapter,
  request: AuthorizedHeadlessExecutorRequest,
): Promise<HeadlessExecutorResult> => {
  const resolved = resolveHeadlessOperation(request);
  if (!resolved.ok) return resolved;
  if (
    reviewedHeadlessPolicyFor(request.operationId, [request.policy]) ===
    undefined
  ) {
    return headlessFailure("Forbidden", "Headless operation is not available.");
  }
  const authorization = authorizeHeadlessOperation({
    operationId: resolved.operation.operationId,
    principal: request.principal,
    operationInput: request.input,
    policy: request.policy,
  });
  if (!authorization.ok) return authorization;
  return executeHeadlessOperation(adapter, {
    operationId: request.operationId,
    surface: request.surface,
    input: authorization.input,
    ...(request.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: request.idempotencyKey }),
  });
};
