import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
const job = {
  jobId: v.string(),
  idempotencyKey: v.string(),
  organizationKey: v.string(),
  workspaceId: v.string(),
  brainKey: v.string(),
  lifecycleGeneration: v.number(),
  policyGeneration: v.number(),
  now: v.number(),
};
const find = async (db: any, i: any) =>
  await db
    .query("brainExportJobs")
    .withIndex("by_org_idempotency", (q: any) =>
      q
        .eq("organizationKey", i.organizationKey)
        .eq("idempotencyKey", i.idempotencyKey),
    )
    .unique();
export const requestBrainExport = internalMutationGeneric({
  args: job,
  returns: v.object({ inserted: v.boolean(), jobId: v.string() }),
  handler: async (ctx, i) => {
    const e = await find(ctx.db, i);
    if (e) return { inserted: false, jobId: e.jobId };
    await ctx.db.insert("brainExportJobs", {
      schemaVersion: 1,
      jobId: i.jobId,
      idempotencyKey: i.idempotencyKey,
      organizationKey: i.organizationKey,
      workspaceId: i.workspaceId,
      brainKey: i.brainKey,
      lifecycleGeneration: i.lifecycleGeneration,
      policyGeneration: i.policyGeneration,
      state: "requested",
      createdAt: i.now,
      updatedAt: i.now,
    });
    return { inserted: true, jobId: i.jobId };
  },
});
export const publishBrainExport = internalMutationGeneric({
  args: {
    jobId: v.string(),
    lifecycleGeneration: v.number(),
    policyGeneration: v.number(),
    artifactId: v.string(),
    manifestHash: v.string(),
    artifactHash: v.string(),
    sizeBytes: v.number(),
    expiresAt: v.number(),
    now: v.number(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, i) => {
    const j = await ctx.db
      .query("brainExportJobs")
      .withIndex("by_job_id", (q: any) => q.eq("jobId", i.jobId))
      .unique();
    if (
      !j ||
      j.lifecycleGeneration !== i.lifecycleGeneration ||
      j.policyGeneration !== i.policyGeneration ||
      j.state !== "requested"
    )
      return { ok: false };
    await ctx.db.patch(j._id, {
      state: "ready",
      artifactId: i.artifactId,
      manifestHash: i.manifestHash,
      artifactHash: i.artifactHash,
      sizeBytes: i.sizeBytes,
      expiresAt: i.expiresAt,
      updatedAt: i.now,
    });
    return { ok: true };
  },
});
export const revokeBrainExport = internalMutationGeneric({
  args: { jobId: v.string(), lifecycleGeneration: v.number(), now: v.number() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, i) => {
    const j = await ctx.db
      .query("brainExportJobs")
      .withIndex("by_job_id", (q: any) => q.eq("jobId", i.jobId))
      .unique();
    if (!j || j.lifecycleGeneration === i.lifecycleGeneration)
      return { ok: false };
    await ctx.db.patch(j._id, { state: "revoked", updatedAt: i.now });
    return { ok: true };
  },
});
export const purgeBrainExport = internalMutationGeneric({
  args: { jobId: v.string(), now: v.number() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, i) => {
    const j = await ctx.db
      .query("brainExportJobs")
      .withIndex("by_job_id", (q: any) => q.eq("jobId", i.jobId))
      .unique();
    if (!j || j.state === "purged") return { ok: false };
    await ctx.db.patch(j._id, {
      state: "purged",
      artifactId: undefined,
      updatedAt: i.now,
    });
    return { ok: true };
  },
});
