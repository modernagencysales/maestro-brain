import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import {
  EditorDocumentTarget,
  encodeEditorDocumentId,
  emptyBlockNoteDocument,
  parseEditorDocumentId,
} from "./index";

describe("editor core", () => {
  it("round-trips editor document ids", () => {
    expect(
      parseEditorDocumentId(
        encodeEditorDocumentId({ kind: "brainPage", id: "page_1" }),
      ),
    ).toEqual({
      kind: "brainPage",
      id: "page_1",
    });
  });

  it("rejects generic document ids until a workspace resolver exists", () => {
    expect(() => parseEditorDocumentId("document:doc_1")).toThrow(
      "Invalid editor document id",
    );
    expect(() => parseEditorDocumentId("doc_1")).toThrow(
      "Invalid editor document id",
    );
  });

  it("rejects empty ids through the exported target schema", () => {
    expect(() =>
      Schema.decodeUnknownSync(EditorDocumentTarget)({
        kind: "brainPage",
        id: "",
      }),
    ).toThrow();
  });

  it("returns a fresh empty document object", () => {
    expect(emptyBlockNoteDocument()).toEqual({ type: "doc", content: [] });
    expect(emptyBlockNoteDocument()).not.toBe(emptyBlockNoteDocument());
  });
});
