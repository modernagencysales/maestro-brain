import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  ErrorCode,
  TemplatePublicError,
  makePublicError,
  redactUnknownError,
} from "../confect/shared/errors";

describe("shared public error catalog", () => {
  it("accepts known public error codes", () => {
    const error = makePublicError("NO_WORKSPACE_ACCESS", "Workspace denied.", {
      workspaceId: "workspace_demo",
    });

    expect(Schema.encodeSync(TemplatePublicError)(error)).toEqual({
      _tag: "TemplatePublicError",
      code: "NO_WORKSPACE_ACCESS",
      message: "Workspace denied.",
      details: { workspaceId: "workspace_demo" },
    });
  });

  it("rejects unknown error codes at the runtime boundary", () => {
    expect(() =>
      Schema.decodeUnknownSync(ErrorCode)("NOT_A_REAL_ERROR"),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TemplatePublicError)({
        _tag: "TemplatePublicError",
        code: "NOT_A_REAL_ERROR",
        message: "nope",
      }),
    ).toThrow();
  });

  it("redacts unknown internal errors", () => {
    const error = redactUnknownError(
      new Error("database password leaked: sk-test-123"),
    );

    expect(Schema.encodeSync(TemplatePublicError)(error)).toEqual({
      _tag: "TemplatePublicError",
      code: "INTERNAL",
      message: "Unexpected internal error.",
    });
    expect(JSON.stringify(error)).not.toContain("password");
    expect(JSON.stringify(error)).not.toContain("sk-test");
  });

  it("preserves public errors during redaction", () => {
    const publicError = makePublicError(
      "VALIDATION_FAILED",
      "Source title is required.",
      { field: "title" },
    );

    expect(redactUnknownError(publicError)).toBe(publicError);
  });
});
