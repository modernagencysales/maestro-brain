import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import type {
  ActionCtx,
  DatabaseReader,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";
import { encodeBrainExport } from "@maestro-template/template-core";
import { sha256Hex } from "../../confect/shared/sha256";

const exportTtlMs = 24 * 60 * 60 * 1_000;
const internalExport = {
  gather: makeFunctionReference<"query", { jobId: string }, unknown>(
    "brain/exports:gatherBrainExport",
  ),
  publish: makeFunctionReference<
    "mutation",
    {
      jobId: string;
      artifactId: string;
      manifestHash: string;
      artifactHash: string;
      sizeBytes: number;
      expiresAt: number;
      now: number;
    },
    { ok: boolean }
  >("brain/exports:publishBrainExport"),
  fail: makeFunctionReference<
    "mutation",
    { jobId: string; error: string; now: number },
    null
  >("brain/exports:failBrainExport"),
  deleteArtifact: makeFunctionReference<
    "mutation",
    { artifactId: string },
    null
  >("brain/exports:deleteBrainExportArtifact"),
};

export const deterministicArtifactJson = (
  files: readonly { readonly path: string; readonly text: string }[],
): string =>
  JSON.stringify(
    Object.fromEntries(
      [...files]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map(({ path, text }) => [path, text]),
    ),
  );
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

export const brainExportDownloadable = (input: {
  readonly job: {
    readonly state: string;
    readonly artifactId?: string;
    readonly expiresAt?: number;
    readonly lifecycleGeneration: number;
    readonly policyGeneration: number;
  };
  readonly now: number;
  readonly lifecycleGeneration: number;
  readonly policyGeneration: number;
}): boolean =>
  input.job.state === "ready" &&
  input.job.artifactId !== undefined &&
  input.job.expiresAt !== undefined &&
  input.job.expiresAt > input.now &&
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
    if (!j) return { ok: false };
    const workspace = await ctx.db.get(j.workspaceId as never);
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_policy_version", (q) =>
        q.eq("policyKey", `brainOperation:${j.workspaceId}:export`),
      )
      .collect();
    const policyGeneration =
      policies
        .filter((row) => row.status === "active")
        .sort((left, right) => right.version - left.version)[0]?.version ?? 1;
    const lifecycleGeneration =
      (workspace as { lifecycleGeneration?: number } | null)
        ?.lifecycleGeneration ?? 1;
    if (
      !brainExportPublishable({ job: j, lifecycleGeneration, policyGeneration })
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

export const failBrainExport = internalMutationGeneric({
  args: { jobId: v.string(), error: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx: MutationCtx, i) => {
    const row = await ctx.db
      .query("brainExportJobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", i.jobId))
      .unique();
    if (row && row.state === "requested")
      await ctx.db.patch(row._id, {
        state: i.error === "stale_fence" ? "revoked" : "failed",
        error: i.error,
        updatedAt: i.now,
      });
    return null;
  },
});

export const deleteBrainExportArtifact = internalMutationGeneric({
  args: { artifactId: v.string() },
  returns: v.null(),
  handler: async (ctx: MutationCtx, { artifactId }) => {
    await ctx.storage.delete(artifactId as never);
    return null;
  },
});

export const gatherBrainExport = internalQueryGeneric({
  args: { jobId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx: QueryCtx, { jobId }) => {
    const job = await ctx.db
      .query("brainExportJobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", jobId))
      .unique();
    if (!job || job.state !== "requested") return null;
    const workspace = await ctx.db.get(job.workspaceId as never);
    const lifecycleGeneration =
      (workspace as { lifecycleGeneration?: number } | null)
        ?.lifecycleGeneration ?? 1;
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_policy_version", (q) =>
        q.eq("policyKey", `brainOperation:${job.workspaceId}:export`),
      )
      .collect();
    const policyGeneration =
      policies
        .filter((row) => row.status === "active")
        .sort((left, right) => right.version - left.version)[0]?.version ?? 1;
    if (!brainExportPublishable({ job, lifecycleGeneration, policyGeneration }))
      return null;

    const pages = (
      await ctx.db
        .query("brainPages")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", job.workspaceId as never).eq("status", "active"),
        )
        .collect()
    ).filter(
      (page) => page.pageKey && page.currentRevisionKey && page.lifecycle,
    );
    const revisions = await Promise.all(
      pages.map((page) =>
        ctx.db
          .query("pageRevisions")
          .withIndex("by_workspace_revision_key", (q) =>
            q
              .eq("workspaceId", job.workspaceId)
              .eq("revisionKey", page.currentRevisionKey as string),
          )
          .unique(),
      ),
    );
    const approvedSources = await ctx.db
      .query("brainSources")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", job.workspaceId as never).eq("status", "published"),
      )
      .collect();
    const sourceRevisions = await Promise.all(
      approvedSources.map(async (source) => {
        const rows = await ctx.db
          .query("sourceRevisions")
          .withIndex("by_source_provider_order", (q) =>
            q.eq("sourceKey", source.sourceKey),
          )
          .collect();
        return rows
          .filter(
            (row) =>
              row.organizationKey === job.organizationKey &&
              row.lifecycle.state === "active" &&
              !row.tombstone,
          )
          .sort((left, right) =>
            right.providerOrder.localeCompare(left.providerOrder),
          )[0];
      }),
    );
    const citations = await ctx.db
      .query("citations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", job.workspaceId))
      .collect();
    const pageKeys = new Set(pages.map((page) => page.pageKey));
    const sourceKeys = new Set(
      approvedSources.flatMap((source, index) =>
        sourceRevisions[index] ? [source.sourceKey] : [],
      ),
    );
    const exportCitations = citations.filter(
      (citation) =>
        citation.pageKey &&
        pageKeys.has(citation.pageKey) &&
        sourceKeys.has(citation.sourceId),
    );
    const createdAt = new Date(job.createdAt).toISOString();
    return {
      job,
      input: {
        agencyKey: job.organizationKey,
        brainKey: job.brainKey,
        brainRevision: pages
          .map((page) => page.currentRevisionKey)
          .sort()
          .join(":"),
        createdAt,
        lifecycleGeneration,
        policyGeneration,
        pages: pages.map((page, index) => ({
          pageKey: page.pageKey,
          parentPageKey: page.parentPageKey ?? null,
          path: page.slug,
          title: page.title,
          body: revisions[index]?.markdown ?? page.markdown,
          lifecycleState: page.lifecycle?.state ?? "active",
          lifecycleGeneration:
            page.lifecycle?.generation ?? lifecycleGeneration,
          revisionKey: page.currentRevisionKey,
          updatedAt: new Date(page.updatedAt).toISOString(),
          citationKeys: exportCitations
            .filter((citation) => citation.pageKey === page.pageKey)
            .map((citation) => citation.citationId),
        })),
        sources: approvedSources.flatMap((source, index) => {
          const revision = sourceRevisions[index];
          return revision
            ? [
                {
                  sourceKey: source.sourceKey,
                  title: source.title,
                  kind: "document",
                  lifecycleState: revision.lifecycle.state,
                  lifecycleGeneration: revision.lifecycle.generation,
                  revisionKey: revision.sourceRevisionKey,
                  contentHash: revision.contentHash,
                  updatedAt: new Date(revision.createdAt).toISOString(),
                },
              ]
            : [];
        }),
        citations: exportCitations.map((citation) => ({
          citationKey: citation.citationId,
          pageKey: citation.pageKey ?? "",
          sourceKey: citation.sourceId,
          quote: citation.quotedText,
          lifecycleState: "active",
          lifecycleGeneration,
          revisionKey: citation.revisionKey ?? "",
        })),
      },
    };
  },
});

export const runBrainExport = internalActionGeneric({
  args: { jobId: v.string() },
  returns: v.object({ outcome: v.string() }),
  handler: async (ctx: ActionCtx, { jobId }) => {
    const gathered = (await ctx.runQuery(internalExport.gather, { jobId })) as {
      job: { createdAt: number };
      input: Parameters<typeof encodeBrainExport>[0];
    } | null;
    if (!gathered) {
      await ctx.runMutation(internalExport.fail, {
        jobId,
        error: "stale_fence",
        now: Date.now(),
      });
      return { outcome: "revoked" };
    }
    let artifactId: string | undefined;
    try {
      const bundle = encodeBrainExport(gathered.input);
      const text = deterministicArtifactJson(bundle.files);
      const bytes = new TextEncoder().encode(text);
      artifactId = String(
        await ctx.storage.store(
          new Blob([bytes], { type: "application/json" }),
        ),
      );
      const published = await ctx.runMutation(internalExport.publish, {
        jobId,
        artifactId,
        manifestHash: bundle.files[0]?.hash ?? "",
        artifactHash: `sha256:${sha256Hex(text)}`,
        sizeBytes: bytes.byteLength,
        expiresAt: Date.now() + exportTtlMs,
        now: Date.now(),
      });
      if (!published.ok) {
        await ctx.runMutation(internalExport.deleteArtifact, { artifactId });
        await ctx.runMutation(internalExport.fail, {
          jobId,
          error: "stale_fence",
          now: Date.now(),
        });
        return { outcome: "revoked" };
      }
      return { outcome: "ready" };
    } catch {
      if (artifactId)
        await ctx.runMutation(internalExport.deleteArtifact, { artifactId });
      await ctx.runMutation(internalExport.fail, {
        jobId,
        error: "encoding_failed",
        now: Date.now(),
      });
      return { outcome: "failed" };
    }
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
    if (!j) return null;
    const workspace = await ctx.db.get(j.workspaceId as never);
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_policy_version", (q) =>
        q.eq("policyKey", `brainOperation:${j.workspaceId}:export`),
      )
      .collect();
    if (
      !brainExportDownloadable({
        job: j,
        now: i.now,
        lifecycleGeneration:
          (workspace as { lifecycleGeneration?: number } | null)
            ?.lifecycleGeneration ?? 1,
        policyGeneration:
          policies
            .filter((row) => row.status === "active")
            .sort((left, right) => right.version - left.version)[0]?.version ??
          1,
      })
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
    if (j.artifactId) await ctx.storage.delete(j.artifactId as never);
    await ctx.db.patch(j._id, {
      state: "expired",
      artifactId: undefined,
      updatedAt: i.now,
    });
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
    if (j.artifactId) await ctx.storage.delete(j.artifactId as never);
    await ctx.db.patch(j._id, {
      state: "revoked",
      artifactId: undefined,
      updatedAt: i.now,
    });
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
