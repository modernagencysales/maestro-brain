export type IdempotencyKeyValidationReason =
  "missing" | "blank" | "whitespace" | "too_long" | "invalid_characters";

export type IdempotencyKeyValidationError = {
  readonly reason: IdempotencyKeyValidationReason;
  readonly message: string;
};

export type IdempotencyKeyValidationResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: IdempotencyKeyValidationError };

export type IdempotencyKeyOptions = {
  readonly maxLength?: number;
};

export const defaultIdempotencyKeyMaxLength = 128;

const urlSafeKeyPattern = /^[A-Za-z0-9._~-]+$/;

const validationError = (
  reason: IdempotencyKeyValidationReason,
  message: string,
): IdempotencyKeyValidationResult => ({
  ok: false,
  error: {
    reason,
    message,
  },
});

export const validateCallerIdempotencyKey = (
  value: string | undefined,
  options: IdempotencyKeyOptions = {},
): IdempotencyKeyValidationResult => {
  if (value === undefined) {
    return validationError("missing", "idempotencyKey is required.");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return validationError("blank", "idempotencyKey must not be blank.");
  }

  if (trimmed !== value) {
    return validationError(
      "whitespace",
      "idempotencyKey must not have leading or trailing whitespace.",
    );
  }

  const maxLength = options.maxLength ?? defaultIdempotencyKeyMaxLength;
  if (value.length > maxLength) {
    return validationError(
      "too_long",
      `idempotencyKey must be ${String(maxLength)} characters or fewer.`,
    );
  }

  if (!urlSafeKeyPattern.test(value)) {
    return validationError(
      "invalid_characters",
      "idempotencyKey must contain only URL-safe letters, numbers, '.', '_', '~', or '-'.",
    );
  }

  return { ok: true, value };
};
