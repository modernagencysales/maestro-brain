import { describe, expect, it } from "vitest";

import { encodeBrainExport, type BrainExportInput } from "./brainExport";
import { requestBrainExport, runBrainExportJob } from "./brainExportJob";

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

describe("Brain export job", () => {
  it("records a deterministic ready artifact", () => {
    const job = requestBrainExport({
      jobId: "job_1",
      idempotencyKey: "export_1",
      requestedAt: input().createdAt,
      lifecycleGeneration: 1,
    });
    const result = runBrainExportJob({
      job,
      exportInput: input(),
      currentLifecycleGeneration: 1,
    });
    const bundle = encodeBrainExport(input());

    expect(result.state).toBe("ready");
    expect(result.artifact).toEqual({
      manifestHash: bundle.files[0]?.hash,
      artifactHash: bundle.files.map(({ hash }) => hash).join(":"),
      sizeBytes: bundle.files.reduce(
        (total, file) => total + file.bytes.length,
        0,
      ),
      fileCount: bundle.files.length,
    });
  });

  it("revokes before encoding when the lifecycle generation is stale", () => {
    const job = requestBrainExport({
      jobId: "job_1",
      idempotencyKey: "export_1",
      requestedAt: input().createdAt,
      lifecycleGeneration: 1,
    });

    expect(
      runBrainExportJob({
        job,
        exportInput: input(),
        currentLifecycleGeneration: 2,
      }),
    ).toMatchObject({
      state: "revoked",
      error: "lifecycle_generation_mismatch",
    });
  });
});
