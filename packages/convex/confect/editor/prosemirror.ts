import { BlockNoteEditor } from "@blocknote/core";
import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { Schema as ProseMirrorSchema } from "@tiptap/pm/model";
import { ConvexError } from "convex/values";
import { components } from "../../convex/_generated/api";

export const prosemirrorSync = new ProsemirrorSync(components.prosemirrorSync);

let cachedSchema: ProseMirrorSchema<string, string> | null = null;

const isProseMirrorSchema = (
  value: unknown,
): value is ProseMirrorSchema<string, string> =>
  value instanceof ProseMirrorSchema;

export const getBlockNoteSchema = (): ProseMirrorSchema<string, string> => {
  if (cachedSchema !== null) return cachedSchema;
  const editor = BlockNoteEditor.create();
  const pmSchema = editor.pmSchema;
  if (!isProseMirrorSchema(pmSchema)) {
    throw new ConvexError({
      code: "PROSEMIRROR_SCHEMA_DRIFT",
      message: "BlockNoteEditor.pmSchema is not a ProseMirror Schema instance",
    });
  }
  cachedSchema = pmSchema;
  return cachedSchema;
};
