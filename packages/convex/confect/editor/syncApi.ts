import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/_generated/dataModel";
import { internal } from "../../convex/_generated/api";
import { parseEditorTarget } from "./documentTargets";
import { prosemirrorSync } from "./prosemirror";
import { requireEditorDocumentAccess } from "./sync";

export async function recordEditorSnapshot(
  ctx: GenericMutationCtx<DataModel>,
  documentId: string,
  snapshot: string,
  _version: number,
  expectedCurrentRevisionKey?: string,
): Promise<{
  readonly pageKey: string;
  readonly pageRevisionKey: string;
  readonly contentHash: string;
  readonly savedAt: number;
} | null> {
  const target = parseEditorTarget(documentId);
  if (target.kind === "brainPage") {
    if (target.legacyPageId === null) {
      if (expectedCurrentRevisionKey === undefined) return null;
      return await ctx.runMutation(
        internal.brain.pages.recordSnapshotInternal,
        {
          brainKey: target.brainKey,
          pageKey: target.pageKey,
          expectedCurrentRevisionKey,
          snapshot,
          version: _version,
        },
      );
    }

    const pageId = ctx.db.normalizeId("brainPages", target.legacyPageId);
    if (pageId === null) return null;
    const page = await ctx.db.get(pageId);
    if (page === null) return null;
    if (typeof page.pageKey !== "string") return null;
    if (typeof page.currentRevisionKey !== "string") return null;
    const workspace = await ctx.db.get(page.workspaceId);
    if (workspace === null || typeof workspace.brainKey !== "string")
      return null;
    return await ctx.runMutation(internal.brain.pages.recordSnapshotInternal, {
      brainKey: workspace.brainKey,
      pageKey: page.pageKey,
      expectedCurrentRevisionKey: page.currentRevisionKey,
      snapshot,
      version: _version,
    });
  }
  return null;
}

export const editorSyncApi = prosemirrorSync.syncApi<DataModel>({
  checkRead: async (ctx, documentId) => {
    await requireEditorDocumentAccess(ctx, documentId, "viewer");
  },
  checkWrite: async (ctx, documentId) => {
    await requireEditorDocumentAccess(ctx, documentId, "editor");
  },
  onSnapshot: async (ctx, documentId, snapshot, version) => {
    await recordEditorSnapshot(ctx, documentId, snapshot, version);
  },
});
