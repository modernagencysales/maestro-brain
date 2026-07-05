import { describe, expect, it } from "vitest";
import {
  defaultIdempotencyKeyMaxLength,
  validateCallerIdempotencyKey,
} from "../confect/shared/idempotencyKey";

describe("shared idempotency key validation", () => {
  it("accepts bounded URL-safe caller keys", () => {
    expect(validateCallerIdempotencyKey("brief-001")).toEqual({
      ok: true,
      value: "brief-001",
    });
    expect(validateCallerIdempotencyKey("idem_123.abc~xyz")).toEqual({
      ok: true,
      value: "idem_123.abc~xyz",
    });
  });

  it("rejects missing, blank, and padded caller keys", () => {
    expect(validateCallerIdempotencyKey(undefined)).toMatchObject({
      ok: false,
      error: { reason: "missing" },
    });
    expect(validateCallerIdempotencyKey("   ")).toMatchObject({
      ok: false,
      error: { reason: "blank" },
    });
    expect(validateCallerIdempotencyKey(" idem_123 ")).toMatchObject({
      ok: false,
      error: { reason: "whitespace" },
    });
  });

  it("rejects keys that are too long or not URL-safe", () => {
    expect(
      validateCallerIdempotencyKey(
        "a".repeat(defaultIdempotencyKeyMaxLength + 1),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "too_long" },
    });
    expect(validateCallerIdempotencyKey("brief/001")).toMatchObject({
      ok: false,
      error: { reason: "invalid_characters" },
    });
    expect(validateCallerIdempotencyKey("brief:001")).toMatchObject({
      ok: false,
      error: { reason: "invalid_characters" },
    });
  });
});
