import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
} from "convex/server";
import { v } from "convex/values";
import type {
  ActionCtx,
  DatabaseReader,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";
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
const find = async (
  db: DatabaseReader,
  i: { readonly organizationKey: string; readonly idempotencyKey: string },
) =>
  await db
    .query("brainExportJobs")
    .withIndex("by_org_idempotency", (q) =>
      q
        .eq("organizationKey", i.organizationKey)
        .eq("idempotencyKey", i.idempotencyKey),
    )
    .unique();

export const brainExportPublishable = (input: {
  readonly job: {
    readonly state: string;
    readonly lifecycleGeneration: number;
    readonly policyGeneration: number;
  };
  readonly lifecycleGeneration: number;
  readonly policyGeneration: number;
}): boolean =>
  input.job.state === "requested" &&
  input.job.lifecycleGeneration === input.lifecycleGeneration &&
  input.job.policyGeneration === input.policyGeneration;
export const requestBrainExport = internalMutationGeneric({
  args: job,
  returns: v.object({ inserted: v.boolean(), jobId: v.string() }),
  handler: async (ctx: MutationCtx, i) => {
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
  handler: async (ctx: MutationCtx, i) => {
    const j = await ctx.db
      .query("brainExportJobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", i.jobId))
      .unique();
    if (
      !j ||
      !brainExportPublishable({
        job: j,
        lifecycleGeneration: i.lifecycleGeneration,
        policyGeneration: i.policyGeneration,
      })
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

/**
 * The worker seam: callers upload the deterministic JSON payload, then pass
 * this storage id to publishBrainExport. It is internal so exports stay off
 * the headless/API surface until a reviewed web capability owns the flow.
 */
export const storeBrainExportArtifact = internalActionGeneric({
  args: { text: v.string() },
  returns: v.object({ artifactId: v.string(), sizeBytes: v.number() }),
  handler: async (ctx: ActionCtx, { text }) => {
    const bytes = new TextEncoder().encode(text);
    const artifactId = await ctx.storage.store(
      new Blob([bytes], { type: "application/json" }),
    );
    return { artifactId: String(artifactId), sizeBytes: bytes.byteLength };
  },
});

export const temporaryBrainExportUrl = internalQueryGeneric({
  args: { jobId: v.string(), now: v.number() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx: QueryCtx, i) => {
    const j = await ctx.db
      .query("brainExportJobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", i.jobId))
      .unique();
    if (
      !j ||
      j.state !== "ready" ||
      !j.artifactId ||
      j.expiresAt === undefined ||
      j.expiresAt <= i.now
    )
      return null;
    return await ctx.storage.getUrl(j.artifactId as never);
  },
});

export const expireBrainExport = internalMutationGeneric({
  args: { jobId: v.string(), now: v.number() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx: MutationCtx, i) => {
    const j = await ctx.db
      .query("brainExportJobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", i.jobId))
      .unique();
    if (
      !j ||
      j.state !== "ready" ||
      j.expiresAt === undefined ||
      j.expiresAt > i.now
    )
      return { ok: false };
    await ctx.db.patch(j._id, { state: "expired", updatedAt: i.now });
    return { ok: true };
  },
});

export const revokeBrainExport = internalMutationGeneric({
  args: { jobId: v.string(), lifecycleGeneration: v.number(), now: v.number() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx: MutationCtx, i) => {
    const j = await ctx.db
      .query("brainExportJobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", i.jobId))
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
  handler: async (ctx: MutationCtx, i) => {
    const j = await ctx.db
      .query("brainExportJobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", i.jobId))
      .unique();
    if (!j || j.state === "purged") return { ok: false };
    if (j.artifactId) await ctx.storage.delete(j.artifactId as never);
    await ctx.db.patch(j._id, {
      state: "purged",
      artifactId: undefined,
      updatedAt: i.now,
    });
    return { ok: true };
  },
});
