import { describe, expect, it } from "vitest";

import {
  gatherAuthorizedBrainRows,
  retryBrainExportJob,
  runBrainExportWorker,
} from "./brainExportWorker";
import { ExportUnauthorized } from "./brainExportWorker";
import { requestBrainExport } from "./brainExportJob";
import type { BrainExportInput } from "./brainExport";
import {
  createBrainExportArtifactStore,
  purgeBrainExportArtifact,
} from "./brainExportStorage";

const input = (): BrainExportInput => ({
  agencyKey: "agency_acme",
  brainKey: "brain_alpha",
  brainRevision: "rev_1",
  createdAt: "2026-08-03T00:00:00.000Z",
  lifecycleGeneration: 1,
  policyGeneration: 1,
  pages: [
    {
      pageKey: "page_home",
      parentPageKey: null,
      path: "Home",
      title: "Home",
      body: "Hello",
      lifecycleState: "active",
      lifecycleGeneration: 1,
      revisionKey: "page_rev_1",
      updatedAt: "2026-08-02T00:00:00.000Z",
      citationKeys: [],
    },
  ],
  sources: [],
  citations: [],
});

const job = () =>
  requestBrainExport({
    jobId: "job_1",
    idempotencyKey: "export_1",
    requestedAt: input().createdAt,
    lifecycleGeneration: 1,
  });

describe("Brain export worker", () => {
  it("gathers rows only after export authorization", () => {
    let reads = 0;
    expect(() =>
      gatherAuthorizedBrainRows({
        requestedBrainKey: "brain_alpha",
        authorization: {
          brainKey: "brain_alpha",
          canExport: false,
          lifecycleGeneration: 1,
        },
        read: () => {
          reads += 1;
          return input();
        },
      }),
    ).toThrow(ExportUnauthorized);
    expect(reads).toBe(0);
  });

  it("stores deterministic output and publishes only after a generation recheck", () => {
    const store = createBrainExportArtifactStore();
    let checks = 0;
    const result = runBrainExportWorker({
      job: job(),
      requestedBrainKey: "brain_alpha",
      authorization: {
        brainKey: "brain_alpha",
        canExport: true,
        lifecycleGeneration: 1,
      },
      read: input,
      currentGenerations: () => {
        checks += 1;
        return { lifecycleGeneration: 1, policyGeneration: 1 };
      },
      store,
      storedAt: input().createdAt,
      ttlMs: 60_000,
    });
    expect(result.job.state).toBe("ready");
    expect(result.artifact?.artifactId).toBe("brain-export:job_1");
    expect(checks).toBe(2);
  });

  it("revokes and leaves no artifact when the post-encode generation changes", () => {
    const store = createBrainExportArtifactStore();
    let checks = 0;
    const result = runBrainExportWorker({
      job: job(),
      requestedBrainKey: "brain_alpha",
      authorization: {
        brainKey: "brain_alpha",
        canExport: true,
        lifecycleGeneration: 1,
      },
      read: input,
      currentGenerations: () => ({
        lifecycleGeneration: checks++ === 0 ? 1 : 2,
        policyGeneration: 1,
      }),
      store,
      storedAt: input().createdAt,
      ttlMs: 60_000,
    });
    expect(result.job.state).toBe("revoked");
    expect(result.artifact).toBeUndefined();
    expect(store.get("brain-export:job_1")).toMatchObject({
      state: "purged",
      files: [],
    });
  });

  it("schedules bounded retry and supports purging the stored artifact", () => {
    const failed = {
      ...job(),
      state: "failed" as const,
      error: "encoding_failed" as const,
      attempt: 1,
    };
    expect(
      retryBrainExportJob(failed, { now: 100, maxAttempts: 3, backoffMs: 50 }),
    ).toMatchObject({
      state: "requested",
      attempt: 2,
      nextAttemptAt: 150,
    });

    const store = createBrainExportArtifactStore();
    const result = runBrainExportWorker({
      job: job(),
      requestedBrainKey: "brain_alpha",
      authorization: {
        brainKey: "brain_alpha",
        canExport: true,
        lifecycleGeneration: 1,
      },
      read: input,
      currentGenerations: () => ({
        lifecycleGeneration: 1,
        policyGeneration: 1,
      }),
      store,
      storedAt: input().createdAt,
      ttlMs: 60_000,
    });
    const artifact = result.artifact;
    expect(artifact).toBeDefined();
    if (artifact === undefined) throw new Error("artifact was not stored");
    expect(purgeBrainExportArtifact(store, artifact.artifactId).state).toBe(
      "purged",
    );
  });
});
