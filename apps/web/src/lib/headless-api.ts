type HeadlessApiSuccess<Result> = Readonly<{
  ok: true;
  operationId: string;
  result: Result;
}>;

type HeadlessApiFailure = Readonly<{
  ok: false;
  error?: Readonly<{
    _tag?: string;
    code?: string;
    message?: string;
  }>;
}>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const requestBody = (input: {
  operationInput?: Record<string, unknown>;
  idempotencyKey?: string;
}) =>
  JSON.stringify({
    input: input.operationInput ?? {},
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey }),
  });

const isSuccessPayload = <Result>(
  response: Response,
  payload: unknown,
): payload is HeadlessApiSuccess<Result> =>
  response.ok &&
  isObject(payload) &&
  payload.ok === true &&
  "result" in payload;

const failureMessage = (response: Response, payload: unknown) => {
  const failure = isObject(payload)
    ? (payload as HeadlessApiFailure)
    : undefined;
  const tag = failure?.error?._tag ?? "HeadlessOperationFailed";
  const message = failure?.error?.message ?? `HTTP ${response.status}`;
  return `${tag}: ${message}`;
};

export const runIsolatedHeadlessOperation = async <Result>(input: {
  operationId: string;
  operationInput?: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<Result> => {
  const response = await fetch(
    `/__contracts/api/${encodeURIComponent(input.operationId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody(input),
    },
  );
  const payload: unknown = await response.json();
  if (isSuccessPayload<Result>(response, payload)) return payload.result;
  throw new Error(failureMessage(response, payload));
};
