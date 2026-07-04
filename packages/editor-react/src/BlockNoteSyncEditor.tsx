import {
  BlockNoteEditor,
  type BlockSchema,
  type InlineContentSchema,
  type StyleSchema,
} from "@blocknote/core";
import { BlockNoteViewRaw as BlockNoteView } from "@blocknote/react";
import "@blocknote/react/style.css";
import { useBlockNoteSync } from "@convex-dev/prosemirror-sync/blocknote";
import { useEffect, useRef } from "react";
import { emptyBlockNoteDocument } from "@maestro-template/editor-core";

type OpenEditor = BlockNoteEditor<
  BlockSchema,
  InlineContentSchema,
  StyleSchema
>;
type SyncState = ReturnType<typeof useBlockNoteSync<OpenEditor>>;

export type BlockNoteSyncEditorProps = {
  readonly api: Parameters<typeof useBlockNoteSync<OpenEditor>>[0];
  readonly documentId: string;
  readonly snapshotDebounceMs: number;
  readonly editable?: boolean;
};

export const shouldBootstrapCreate = (
  alreadyCreated: boolean,
  sync: { readonly isLoading: boolean; readonly editor: unknown },
): boolean => !alreadyCreated && !sync.isLoading && sync.editor === null;

const useBootstrapEmptyDoc = (sync: SyncState): void => {
  const createdRef = useRef(false);
  useEffect(() => {
    if (!shouldBootstrapCreate(createdRef.current, sync)) return;
    if (sync.isLoading || sync.editor !== null) return;
    createdRef.current = true;
    void sync.create(
      emptyBlockNoteDocument() as Parameters<typeof sync.create>[0],
    );
  }, [sync]);
};

export function BlockNoteSyncEditor({
  api,
  documentId,
  snapshotDebounceMs,
  editable = false,
}: BlockNoteSyncEditorProps) {
  const debounceRef = useRef(snapshotDebounceMs);
  const sync = useBlockNoteSync<OpenEditor>(api, documentId, {
    snapshotDebounceMs: debounceRef.current,
  });
  useBootstrapEmptyDoc(sync);
  if (sync.isLoading || sync.editor === null) {
    return <div data-editor-state="loading" />;
  }
  return (
    <BlockNoteView
      editor={sync.editor}
      editable={editable}
      formattingToolbar={false}
      slashMenu={false}
      sideMenu={false}
      linkToolbar={false}
      tableHandles={false}
      filePanel={false}
      emojiPicker={false}
    />
  );
}
