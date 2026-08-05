import { internalQueryGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { QueryCtx } from "../_generated/server";

const generationLive = (row: {
  lifecycleGeneration?: number;
  revocationGeneration?: number;
}) => (row.revocationGeneration ?? 0) <= (row.lifecycleGeneration ?? 0);

export const contextGet = internalQueryGeneric({
  args: {
    organizationId: v.id("organizations"),
    workspaceId: v.id("workspaces"),
    brainKey: v.string(),
    pageKeys: v.optional(v.array(v.string())),
    maxBytes: v.optional(v.number()),
  },
  returns: v.object({
    brainKey: v.string(),
    asOf: v.number(),
    freshness: v.object({ status: v.literal("current") }),
    entries: v.array(
      v.object({
        sourceKey: v.string(),
        citationKey: v.string(),
        title: v.string(),
        excerpt: v.string(),
      }),
    ),
  }),
  handler: async (ctx: QueryCtx, args) => {
    const [organization, workspace] = await Promise.all([
      ctx.db.get(args.organizationId),
      ctx.db.get(args.workspaceId),
    ]);
    if (
      organization?.status !== "active" ||
      workspace?.status !== "active" ||
      workspace.organizationId !== organization._id ||
      workspace.brainKey !== args.brainKey ||
      !generationLive(organization) ||
      !generationLive(workspace)
    ) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Forbidden." });
    }

    const pages = await ctx.db
      .query("brainPages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const allowed = args.pageKeys === undefined ? null : new Set(args.pageKeys);
    let bytes = 0;
    const entries = pages
      .filter(
        (page) =>
          typeof page.pageKey === "string" &&
          page.status === "active" &&
          page.lifecycle?.state === "active" &&
          (allowed === null || allowed.has(page.pageKey)),
      )
      .sort((a, b) => String(a.pageKey).localeCompare(String(b.pageKey)))
      .flatMap((page) => {
        const pageKey = String(page.pageKey);
        const size = new TextEncoder().encode(page.markdown).byteLength;
        if (bytes + size > (args.maxBytes ?? 100_000)) return [];
        bytes += size;
        return [
          {
            sourceKey: pageKey,
            citationKey: `citation:${pageKey}`,
            title: page.title,
            excerpt: page.markdown,
          },
        ];
      });

    return {
      brainKey: workspace.brainKey,
      asOf: Date.now(),
      freshness: { status: "current" as const },
      entries,
    };
  },
});
