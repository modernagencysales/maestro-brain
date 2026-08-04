import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import convexSchema from "../confect/_generated/convexSchema";
import {
  brainExportDownloadable,
  brainExportPublishable,
  deterministicArtifactJson,
} from "../convex/brain/exports";

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");
const makeTest = () => convexTest(convexSchema, modules);

describe("Brain export publish fence", () => {
  it("requires the requested state and both current generations", () => {
    expect(
      brainExportPublishable({
        job: {
          state: "requested",
          lifecycleGeneration: 2,
          policyGeneration: 3,
        },
        lifecycleGeneration: 2,
        policyGeneration: 3,
      }),
    ).toBe(true);
    expect(
      brainExportPublishable({
        job: {
          state: "requested",
          lifecycleGeneration: 2,
          policyGeneration: 3,
        },
        lifecycleGeneration: 3,
        policyGeneration: 3,
      }),
    ).toBe(false);
    expect(
      brainExportPublishable({
        job: {
          state: "revoked",
          lifecycleGeneration: 2,
          policyGeneration: 3,
        },
        lifecycleGeneration: 2,
        policyGeneration: 3,
      }),
    ).toBe(false);
  });

  it("fails downloads closed for stale, expired, and non-ready jobs", () => {
    const ready = {
      state: "ready",
      artifactId: "storage_1",
      expiresAt: 200,
      lifecycleGeneration: 2,
      policyGeneration: 3,
    };
    expect(
      brainExportDownloadable({
        job: ready,
        now: 100,
        lifecycleGeneration: 2,
        policyGeneration: 3,
      }),
    ).toBe(true);
    for (const job of [
      { ...ready, state: "requested" },
      { ...ready, expiresAt: 100 },
      { ...ready, lifecycleGeneration: 1 },
      { ...ready, policyGeneration: 4 },
    ]) {
      expect(
        brainExportDownloadable({
          job,
          now: 100,
          lifecycleGeneration: 2,
          policyGeneration: 3,
        }),
      ).toBe(false);
    }
  });

  it("serializes encoded files as one deterministic JSON object", () => {
    const files = [
      { path: "b", text: "second" },
      { path: "a", text: "first" },
    ];
    expect(deterministicArtifactJson(files)).toBe('{"a":"first","b":"second"}');
    expect(deterministicArtifactJson(files.reverse())).toBe(
      '{"a":"first","b":"second"}',
    );
  });

  it("stores and purges native Convex object bytes", async () => {
    const t = makeTest();
    const store = makeFunctionReference<
      "action",
      { text: string },
      { artifactId: string; sizeBytes: number }
    >("brain/exports:storeBrainExportArtifact");
    const purge = makeFunctionReference<
      "mutation",
      { jobId: string; now: number },
      { ok: boolean }
    >("brain/exports:purgeBrainExport");
    const stored = await t.action(store, { text: '{"manifest.json":"x"}' });
    await t.run(async (ctx) => {
      await ctx.db.insert("brainExportJobs", {
        schemaVersion: 1,
        jobId: "job_1",
        idempotencyKey: "idem_1",
        organizationKey: "org_1",
        workspaceId: "workspace_1",
        brainKey: "brain_1",
        lifecycleGeneration: 1,
        policyGeneration: 1,
        state: "ready",
        artifactId: stored.artifactId as never,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.storage.get(stored.artifactId as never)) !== null,
      ),
    ).toBe(true);
    expect(await t.mutation(purge, { jobId: "job_1", now: 2 })).toEqual({
      ok: true,
    });
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.storage.get(stored.artifactId as never)) === null,
      ),
    ).toBe(true);
  });
});
