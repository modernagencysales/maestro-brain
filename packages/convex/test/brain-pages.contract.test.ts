import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import {
  manifest,
  RecordSnapshotArgs,
  schemaRegistry,
} from "../confect/brain/pages.spec";

const requireSchema = (name: string): Schema.Schema<unknown, unknown, never> => {
  const schema = schemaRegistry[name];
  if (schema === undefined) throw new Error(`Missing schema ${name}`);
  return schema as Schema.Schema<unknown, unknown, never>;
};

describe("brain pages Confect contract", () => {
  it("exposes authorized stable-key page functions and rejects caller tenant IDs", () => {
    expect(refs.public.brain.pages.create).toMatchObject({
      functionNamespace: "brain/pages",
      functionSpec: { name: "create", functionVisibility: "public" },
    });
    expect(refs.public.brain.pages).not.toHaveProperty("createMarkdown");
    expect(manifest.map((entry) => entry.operationId)).toEqual([
      "brain.pages.list",
      "brain.pages.get",
      "brain.pages.create",
      "brain.pages.rename",
      "brain.pages.move",
      "brain.pages.favorite",
      "brain.pages.archive",
    ]);
    expect(manifest.every((entry) => entry.surfaces.length === 1 && entry.surfaces[0] === "web")).toBe(true);
    expect(() =>
      Schema.decodeUnknownSync(requireSchema("brain.pages.create.args"))(
        {
          brainKey: "br_0123456789ABCDEFGHJKMNPQRS",
          workspaceId: "forged",
          parentPageKey: null,
          siblingSlug: "brief",
          sortKey: "0000000001",
          title: "Brief",
          markdown: "# Brief",
          expectedCurrentRevisionKey: null,
        },
        { onExcessProperty: "error" },
      ),
    ).toThrow(/workspaceId/);
    expect(() =>
      Schema.decodeUnknownSync(RecordSnapshotArgs)(
        {
          brainKey: "br_0123456789ABCDEFGHJKMNPQRS",
          pageKey: "pag_client-brief",
          expectedCurrentRevisionKey: "rev_current",
          pageId: "forged",
          snapshot: '{"type":"doc"}',
          version: 1,
        },
        { onExcessProperty: "error" },
      ),
    ).toThrow(/pageId/);
  });
});
