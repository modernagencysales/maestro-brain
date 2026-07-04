import { BlockNoteEditor } from "@blocknote/core";
import { ProsemirrorSync, type SyncApi } from "@convex-dev/prosemirror-sync";
import { useBlockNoteSync } from "@convex-dev/prosemirror-sync/blocknote";
import type { Schema as ProseMirrorSchema } from "@tiptap/pm/model";

declare const component: ConstructorParameters<typeof ProsemirrorSync>[0];
declare const syncApiRef: SyncApi;
const sync = new ProsemirrorSync(component);

export const syncApi = sync.syncApi({
  checkRead: async (_ctx, id) => {
    void id;
  },
  checkWrite: async (_ctx, id) => {
    void id;
  },
  onSnapshot: async (_ctx, id, snapshot, version) => {
    void id;
    void snapshot;
    void version;
  },
});

const editor = BlockNoteEditor.create();
const schema: ProseMirrorSchema<string, string> = editor.pmSchema;
const blockNoteSync = useBlockNoteSync<BlockNoteEditor>(
  syncApiRef,
  "brainPage:page_1",
);

void schema;
void blockNoteSync;
