import { Schema as ProseMirrorSchema } from "@tiptap/pm/model";
import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import {
  getBlockNoteSchema,
  prosemirrorSync,
} from "../confect/editor/prosemirror";

describe("editor prosemirror seam", () => {
  it("exposes a ProsemirrorSync singleton", () => {
    expect(typeof prosemirrorSync).toBe("object");
  });

  it("memoizes the BlockNote ProseMirror schema", () => {
    expect(getBlockNoteSchema()).toBeInstanceOf(ProseMirrorSchema);
    expect(getBlockNoteSchema()).toBe(getBlockNoteSchema());
  });

  it("throws a public drift error when BlockNote pmSchema changes shape", async () => {
    vi.resetModules();
    vi.doMock("@blocknote/core", () => ({
      BlockNoteEditor: { create: () => ({ pmSchema: {} }) },
    }));
    const module = await import("../confect/editor/prosemirror");
    expect(() => module.getBlockNoteSchema()).toThrow(ConvexError);
    vi.doUnmock("@blocknote/core");
    vi.resetModules();
  });
});
