import { describe, expect, it } from "vitest";
import {
  LlmReceiptValidationError,
  makeLlmCompletion,
  validateOptionalLlmIdempotencyKey,
} from "./llmResponse";

const usage = {
  estimatedCents: 1,
  promptTokens: 10,
  completionTokens: 20,
  totalTokens: 30,
};

describe("LLM completion receipts", () => {
  it("preserves valid idempotency keys in fake-safe receipts", () => {
    expect(
      makeLlmCompletion({
        mode: "fake",
        model: "fake/local-demo",
        workspaceSlug: "acme-demo",
        text: "Fake completion.",
        usage,
        generatedAt: "2026-07-01T00:00:00.000Z",
        idempotencyKey: "llm-001",
      }),
    ).toMatchObject({
      receipt: {
        workspaceSlug: "acme-demo",
        idempotencyKey: "llm-001",
      },
    });
  });

  it("rejects malformed idempotency keys before creating receipts", () => {
    expect(validateOptionalLlmIdempotencyKey(undefined)).toBeUndefined();
    expect(validateOptionalLlmIdempotencyKey("llm-001")).toBe("llm-001");
    expect(validateOptionalLlmIdempotencyKey(" llm-001 ")).toMatchObject({
      _tag: "LlmReceiptValidationError",
      field: "idempotencyKey",
      message: "idempotencyKey must not have leading or trailing whitespace.",
    });

    expect(
      makeLlmCompletion({
        mode: "fake",
        model: "fake/local-demo",
        workspaceSlug: "acme-demo",
        text: "Fake completion.",
        usage,
        generatedAt: "2026-07-01T00:00:00.000Z",
        idempotencyKey: "llm/001",
      }),
    ).toMatchObject({
      _tag: "LlmReceiptValidationError",
      field: "idempotencyKey",
      message:
        "idempotencyKey must contain only URL-safe letters, numbers, '.', '_', '~', or '-'.",
    });
  });

  it("exposes typed receipt validation errors", () => {
    expect(
      new LlmReceiptValidationError({
        field: "idempotencyKey",
        message: "idempotencyKey is invalid.",
      }),
    ).toMatchObject({
      _tag: "LlmReceiptValidationError",
      field: "idempotencyKey",
    });
  });
});
