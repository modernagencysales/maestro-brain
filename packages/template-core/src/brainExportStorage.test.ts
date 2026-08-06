import { describe, expect, it } from "vitest";

import { encodeBrainExport, type BrainExportInput } from "./brainExport";
import { requestBrainExport, runBrainExportJob } from "./brainExportJob";
import {
  ArtifactExpired,
  ArtifactLifecycleRevoked,
  ArtifactPurged,
  createBrainExportArtifactStore,
  expireBrainExportArtifact,
  persistBrainExportArtifact,
  purgeBrainExportArtifact,
  readBrainExportArtifact,
  revokeBrainExportArtifact,
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

const readyJob = () =>
  runBrainExportJob({
    job: requestBrainExport({
      jobId: "job_1",
      idempotencyKey: "export_1",
      requestedAt: input().createdAt,
      lifecycleGeneration: 1,
    }),
    exportInput: input(),
    currentLifecycleGeneration: 1,
  });

describe("Brain export artifact storage", () => {
  it("persists an immutable lifecycle-fenced artifact and reads it before expiry", () => {
    const store = createBrainExportArtifactStore();
    const bundle = encodeBrainExport(input());
    const artifact = persistBrainExportArtifact({
      store,
      job: readyJob(),
      bundle,
      currentLifecycleGeneration: 1,
      storedAt: "2026-08-03T00:00:00.000Z",
      ttlMs: 60_000,
    });

    expect(artifact.expiresAt).toBe("2026-08-03T00:01:00.000Z");
    expect(
      readBrainExportArtifact({
        store,
        artifactId: artifact.artifactId,
        currentLifecycleGeneration: 1,
        now: "2026-08-03T00:00:30.000Z",
      }).files,
    ).toEqual(bundle.files);
  });

  it("expires, purges, and never returns bytes after purge", () => {
    const store = createBrainExportArtifactStore();
    const artifact = persistBrainExportArtifact({
      store,
      job: readyJob(),
      bundle: encodeBrainExport(input()),
      currentLifecycleGeneration: 1,
      storedAt: "2026-08-03T00:00:00.000Z",
      ttlMs: 60_000,
    });

    expect(
      expireBrainExportArtifact(
        store,
        artifact.artifactId,
        "2026-08-03T00:01:00.000Z",
      ).state,
    ).toBe("expired");
    expect(() =>
      readBrainExportArtifact({
        store,
        artifactId: artifact.artifactId,
        currentLifecycleGeneration: 1,
        now: "2026-08-03T00:01:01.000Z",
      }),
    ).toThrow(ArtifactExpired);
    expect(purgeBrainExportArtifact(store, artifact.artifactId).state).toBe(
      "purged",
    );
    expect(() =>
      readBrainExportArtifact({
        store,
        artifactId: artifact.artifactId,
        currentLifecycleGeneration: 1,
        now: "2026-08-03T00:02:00.000Z",
      }),
    ).toThrow(ArtifactPurged);
  });

  it("revokes and purges when lifecycle generation changes", () => {
    const store = createBrainExportArtifactStore();
    const artifact = persistBrainExportArtifact({
      store,
      job: readyJob(),
      bundle: encodeBrainExport(input()),
      currentLifecycleGeneration: 1,
      storedAt: "2026-08-03T00:00:00.000Z",
      ttlMs: 60_000,
    });

    expect(revokeBrainExportArtifact(store, artifact.artifactId, 2).state).toBe(
      "revoked",
    );
    expect(() =>
      readBrainExportArtifact({
        store,
        artifactId: artifact.artifactId,
        currentLifecycleGeneration: 2,
        now: "2026-08-03T00:00:01.000Z",
      }),
    ).toThrow(ArtifactLifecycleRevoked);
    expect(purgeBrainExportArtifact(store, artifact.artifactId).state).toBe(
      "purged",
    );
  });
});
