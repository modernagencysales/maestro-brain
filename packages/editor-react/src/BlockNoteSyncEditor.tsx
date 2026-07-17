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
  readonly initialSnapshotVersion: number;
  readonly editable?: boolean;
  readonly expectedCurrentRevisionKey?: string | null;
  readonly savedRevisionKey?: string | null;
  readonly onDocumentChange?:
    | ((
        snapshot: string,
        version: number,
        expectedCurrentRevisionKey: string,
      ) => void)
    | undefined;
  readonly onSyncError?: ((error: unknown) => void) | undefined;
};

export const shouldBootstrapCreate = (
  alreadyCreated: boolean,
  sync: { readonly isLoading: boolean; readonly editor: unknown },
): boolean => !alreadyCreated && !sync.isLoading && sync.editor === null;

export const readBlockNoteDocumentSnapshot = (
  editor: Pick<OpenEditor, "document"> | null,
): string | null => (editor === null ? null : JSON.stringify(editor.document));

export const nextBlockNoteSnapshotVersion = (currentVersion: number): number =>
  currentVersion + 1;

export const readBlockNoteRevisionFence = (
  current: {
    readonly documentId: string | null;
    readonly revisionKey: string | null;
  },
  selected: {
    readonly documentId: string;
    readonly revisionKey: string | null | undefined;
  },
  savedRevisionKey?: string | null,
): string | null => {
  if (savedRevisionKey) return savedRevisionKey;
  if (!selected.revisionKey) return null;
  if (
    current.documentId === selected.documentId &&
    current.revisionKey !== null
  ) {
    return current.revisionKey;
  }
  return selected.revisionKey;
};

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
  initialSnapshotVersion,
  editable = false,
  expectedCurrentRevisionKey = null,
  savedRevisionKey = null,
  onDocumentChange,
  onSyncError,
}: BlockNoteSyncEditorProps) {
  const debounceRef = useRef(snapshotDebounceMs);
  const revisionFenceRef = useRef<{
    documentId: string | null;
    revisionKey: string | null;
  }>({ documentId: null, revisionKey: null });
  const revisionFence = readBlockNoteRevisionFence(
    revisionFenceRef.current,
    {
      documentId,
      revisionKey: expectedCurrentRevisionKey,
    },
    savedRevisionKey,
  );
  revisionFenceRef.current = { documentId, revisionKey: revisionFence };
  const liveSnapshotVersionRef = useRef(initialSnapshotVersion);
  useEffect(() => {
    liveSnapshotVersionRef.current = initialSnapshotVersion;
  }, [documentId, initialSnapshotVersion]);
  const sync = useBlockNoteSync<OpenEditor>(api, documentId, {
    snapshotDebounceMs: debounceRef.current,
  });
  useBootstrapEmptyDoc(sync);
  useEffect(() => {
    if (sync.editor === null || !revisionFence) return;
    const notify = () => {
      const snapshot = readBlockNoteDocumentSnapshot(sync.editor);
      if (snapshot === null) return;
      const version = nextBlockNoteSnapshotVersion(
        liveSnapshotVersionRef.current,
      );
      liveSnapshotVersionRef.current = version;
      onDocumentChange?.(snapshot, version, revisionFence);
    };
    try {
      return sync.editor.onChange(notify);
    } catch (error) {
      onSyncError?.(error);
      return;
    }
  }, [onDocumentChange, onSyncError, revisionFence, sync.editor]);
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
