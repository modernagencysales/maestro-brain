import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { manifest, schemaRegistry } from "../confect/brain/pages.spec";

const requireSchema = (
  name: string,
): Schema.Schema<unknown, unknown, never> => {
  const schema = schemaRegistry[name];
  if (schema === undefined) throw new Error(`Missing schema ${name}`);
  return schema as Schema.Schema<unknown, unknown, never>;
};

describe("Brain page revision restore", () => {
  it("publishes the stable-key restore contract", () => {
    expect(manifest).toContainEqual(
      expect.objectContaining({
        operationId: "brain.pages.restore",
        kind: "mutation",
        surfaces: ["web"],
        idempotent: false,
      }),
    );
    expect(
      Schema.decodeUnknownSync(requireSchema("brain.pages.restore.args"))({
        brainKey: "br_0123456789ABCDEFGHJKMNPQRS",
        pageKey: "pag_client-brief",
        expectedCurrentRevisionKey: "rev_current",
        revisionKey: "rev_prior",
      }),
    ).toEqual({
      brainKey: "br_0123456789ABCDEFGHJKMNPQRS",
      pageKey: "pag_client-brief",
      expectedCurrentRevisionKey: "rev_current",
      revisionKey: "rev_prior",
    });
  });
});
