import type { HeadlessExecutorRequest } from "./manifest/executor";
import { validateCallerIdempotencyKey } from "./shared/idempotencyKey";
import { sha256Hex } from "./shared/sha256";

const operationId = "brain.notes.submit";

const derivedIdempotencyKey = (
  input: Readonly<Record<string, unknown>>,
): string =>
  `note.${sha256Hex(
    JSON.stringify({
      title: input.title ?? null,
      markdown: input.markdown ?? null,
    }),
  )}`;

export const runHeadlessNoteSubmit = async (
  runMutation: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>,
  operationRef: unknown,
  request: HeadlessExecutorRequest,
): Promise<unknown> => {
  const idempotencyKey = validateCallerIdempotencyKey(
    request.idempotencyKey ?? derivedIdempotencyKey(request.input),
  );
  if (!idempotencyKey.ok)
    return {
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: idempotencyKey.error.message,
      },
    };
  const result = await runMutation(operationRef, {
    ...request.input,
    idempotencyKey: idempotencyKey.value,
  });
  return { ok: true, operationId, result };
};
