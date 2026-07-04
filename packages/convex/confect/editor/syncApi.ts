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
): Promise<void> {
  const target = parseEditorTarget(documentId);
  if (target.kind === "brainPage") {
    const pageId = ctx.db.normalizeId("brainPages", target.id);
    if (pageId === null) return;
    const page = await ctx.db.get(pageId);
    if (page === null) return;
    await ctx.runMutation(internal.brain.pages.recordSnapshotInternal, {
      workspaceId: page.workspaceId,
      pageId,
      snapshot,
      version: _version,
    });
  }
}

export const editorSyncApi = prosemirrorSync.syncApi<DataModel>({
  checkRead: async (ctx, documentId) => {
    await requireEditorDocumentAccess(ctx, documentId, "viewer");
  },
  checkWrite: async (ctx, documentId) => {
    await requireEditorDocumentAccess(ctx, documentId, "editor");
  },
  onSnapshot: recordEditorSnapshot,
});
