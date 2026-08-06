import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/_generated/dataModel";
import { internal } from "../../convex/_generated/api";
import { parseEditorTarget } from "./documentTargets";
import { prosemirrorSync } from "./prosemirror";
import { requireEditorDocumentAccess } from "./sync";

type EditorSnapshotCommit = {
  readonly pageKey: string;
  readonly pageRevisionKey: string;
  readonly contentHash: string;
  readonly savedAt: number;
};

type ResolvedEditorSnapshotTarget = {
  readonly brainKey: string;
  readonly pageKey: string;
  readonly currentRevisionKey: string;
};

export async function recordEditorSnapshot(
  ctx: GenericMutationCtx<DataModel>,
  documentId: string,
  snapshot: string,
  _version: number,
  expectedCurrentRevisionKey?: string,
): Promise<EditorSnapshotCommit | null> {
  const target = parseEditorTarget(documentId);
  if (target.kind === "brainPage") {
    if (target.legacyPageId === null) {
      const expectedRevision =
        expectedCurrentRevisionKey ?? target.expectedCurrentRevisionKey;
      if (expectedRevision === undefined) return null;
      return await ctx.runMutation(
        internal.brain.pages.recordSnapshotInternal,
        {
          brainKey: target.brainKey,
          pageKey: target.pageKey,
          expectedCurrentRevisionKey: expectedRevision,
          snapshot,
          version: _version,
        },
      );
    }

    const resolved = await resolveLegacyEditorSnapshotTarget(
      ctx,
      target.legacyPageId,
    );
    if (resolved === null) return null;
    return await commitEditorSnapshot(ctx, resolved, snapshot, _version);
  }
  return null;
}

export async function recordCurrentEditorSnapshot(
  ctx: GenericMutationCtx<DataModel>,
  documentId: string,
  snapshot: string,
  version: number,
): Promise<EditorSnapshotCommit | null> {
  const target = parseEditorTarget(documentId);
  if (target.kind !== "brainPage") return null;
  const resolved =
    target.legacyPageId === null
      ? target.expectedCurrentRevisionKey === undefined
        ? null
        : await resolveStableEditorSnapshotTarget(
            ctx,
            target.brainKey,
            target.pageKey,
            target.expectedCurrentRevisionKey,
          )
      : await resolveLegacyEditorSnapshotTarget(ctx, target.legacyPageId);
  if (resolved === null) return null;
  return await commitEditorSnapshot(ctx, resolved, snapshot, version);
}

const resolveStableEditorSnapshotTarget = async (
  ctx: GenericMutationCtx<DataModel>,
  brainKey: string,
  pageKey: string,
  expectedCurrentRevisionKey: string,
): Promise<ResolvedEditorSnapshotTarget | null> => {
  const workspaces = await ctx.db.query("workspaces").collect();
  const workspace = workspaces.find((row) => row.brainKey === brainKey);
  if (workspace === undefined) return null;
  const page = await ctx.db
    .query("brainPages")
    .withIndex("by_workspace_page_key", (q) =>
      q.eq("workspaceId", workspace._id).eq("pageKey", pageKey),
    )
    .unique();
  if (
    !isReadableSnapshotPage(page) ||
    page.currentRevisionKey !== expectedCurrentRevisionKey
  )
    return null;
  return {
    brainKey,
    pageKey: page.pageKey,
    currentRevisionKey: expectedCurrentRevisionKey,
  };
};

const resolveLegacyEditorSnapshotTarget = async (
  ctx: GenericMutationCtx<DataModel>,
  legacyPageId: string,
): Promise<ResolvedEditorSnapshotTarget | null> => {
  const pageId = ctx.db.normalizeId("brainPages", legacyPageId);
  if (pageId === null) return null;
  const page = await ctx.db.get(pageId);
  if (!isReadableSnapshotPage(page)) return null;
  const workspace = await ctx.db.get(page.workspaceId);
  if (workspace === null || typeof workspace.brainKey !== "string") return null;
  return {
    brainKey: workspace.brainKey,
    pageKey: page.pageKey,
    currentRevisionKey: page.currentRevisionKey,
  };
};

const isReadableSnapshotPage = (
  page: unknown,
): page is {
  readonly workspaceId: string;
  readonly pageKey: string;
  readonly currentRevisionKey: string;
  readonly status?: string;
  readonly lifecycle?: { readonly state?: string };
} => {
  if (page === null || typeof page !== "object") return false;
  const row = page as {
    readonly workspaceId?: unknown;
    readonly pageKey?: unknown;
    readonly currentRevisionKey?: unknown;
    readonly status?: unknown;
    readonly lifecycle?: { readonly state?: unknown };
  };
  return (
    typeof row.workspaceId === "string" &&
    typeof row.pageKey === "string" &&
    typeof row.currentRevisionKey === "string" &&
    (row.status === undefined || row.status === "active") &&
    (row.lifecycle === undefined || row.lifecycle.state === "active")
  );
};

const commitEditorSnapshot = (
  ctx: GenericMutationCtx<DataModel>,
  target: ResolvedEditorSnapshotTarget,
  snapshot: string,
  version: number,
): Promise<EditorSnapshotCommit> =>
  ctx.runMutation(internal.brain.pages.recordSnapshotInternal, {
    brainKey: target.brainKey,
    pageKey: target.pageKey,
    expectedCurrentRevisionKey: target.currentRevisionKey,
    snapshot,
    version,
  });

export const editorSyncApi = prosemirrorSync.syncApi<DataModel>({
  checkRead: async (ctx, documentId) => {
    await requireEditorDocumentAccess(ctx, documentId, "viewer");
  },
  checkWrite: async (ctx, documentId) => {
    await requireEditorDocumentAccess(ctx, documentId, "editor");
  },
  onSnapshot: async (ctx, documentId, snapshot, version) => {
    await recordCurrentEditorSnapshot(ctx, documentId, snapshot, version);
  },
});
