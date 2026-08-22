import { BlockNoteEditor } from "@blocknote/core";
import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import type { Schema as ProseMirrorSchema } from "@tiptap/pm/model";
import { ConvexError } from "convex/values";
import { components } from "../../convex/_generated/api";

export const prosemirrorSync = new ProsemirrorSync(components.prosemirrorSync);

let cachedSchema: ProseMirrorSchema<string, string> | null = null;

const isProseMirrorSchema = (
  value: unknown,
): value is ProseMirrorSchema<string, string> => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    marks?: unknown;
    nodeFromJSON?: unknown;
    nodes?: unknown;
    text?: unknown;
  };
  return (
    typeof candidate.nodes === "object" &&
    candidate.nodes !== null &&
    typeof candidate.marks === "object" &&
    candidate.marks !== null &&
    typeof candidate.nodeFromJSON === "function" &&
    typeof candidate.text === "function"
  );
};

export const getBlockNoteSchema = (): ProseMirrorSchema<string, string> => {
  if (cachedSchema !== null) return cachedSchema;
  const editor = BlockNoteEditor.create();
  const pmSchema = editor.pmSchema;
  if (!isProseMirrorSchema(pmSchema)) {
    throw new ConvexError({
      code: "PROSEMIRROR_SCHEMA_DRIFT",
      message:
        "BlockNoteEditor.pmSchema does not match the ProseMirror schema contract",
    });
  }
  cachedSchema = pmSchema;
  return cachedSchema;
};
