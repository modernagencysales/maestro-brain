import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { Unauthorized, ValidationFailed } from "../confect/errors";
import {
  capabilityMeta,
  publicErrorForKind,
  publicMutation,
} from "../confect/capabilities/_kit/capability";

describe("capability builder", () => {
  it("denies headless exposure unless declared", () => {
    const meta = capabilityMeta({
      name: "listPages",
      kind: "query",
      minimumRole: "viewer",
    });

    expect(meta.headless).toEqual([]);
    expect(meta.surfaces.api).toBe(false);
  });

  it("uses read and write public error families", () => {
    expect(
      Schema.encodeSync(publicErrorForKind("query"))(new Unauthorized()),
    ).toEqual({
      _tag: "Unauthorized",
    });
    expect(
      Schema.encodeSync(publicErrorForKind("mutation"))(
        new ValidationFailed({
          field: "idempotencyKey",
          message: "Required for external writes.",
        }),
      ),
    ).toEqual({
      _tag: "ValidationFailed",
      field: "idempotencyKey",
      message: "Required for external writes.",
    });
  });

  it("wraps public mutations with write public errors", () => {
    const spec = publicMutation({
      name: "createPage",
      args: () => Schema.Struct({}),
      returns: () => Schema.Struct({ ok: Schema.Boolean }),
    });
    const errorSchema = spec.functionProvenance.error;

    if (errorSchema === undefined) {
      throw new Error(
        "Expected public mutation wrapper to install error schema",
      );
    }

    expect(
      Schema.encodeSync(errorSchema)(
        new ValidationFailed({
          field: "idempotencyKey",
          message: "Required for external writes.",
        }),
      ),
    ).toEqual({
      _tag: "ValidationFailed",
      field: "idempotencyKey",
      message: "Required for external writes.",
    });
  });
});
