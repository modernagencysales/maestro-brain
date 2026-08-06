import {
  encodeBrainExport,
  type BrainExportBundle,
  type BrainExportInput,
} from "./brainExport";

export type BrainExportJobState = "requested" | "ready" | "revoked" | "failed";

export type BrainExportJob = {
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly state: BrainExportJobState;
  readonly requestedAt: string;
  readonly lifecycleGeneration: number;
  readonly attempt?: number;
  readonly nextAttemptAt?: number;
  readonly artifact?: {
    readonly manifestHash: string;
    readonly artifactHash: string;
    readonly sizeBytes: number;
    readonly fileCount: number;
  };
  readonly error?:
    | "lifecycle_generation_mismatch"
    | "encoding_failed"
    | "authorization_failed";
};

export const requestBrainExport = (input: {
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly lifecycleGeneration: number;
}): BrainExportJob => ({
  ...input,
  state: "requested",
});

export const artifactSummary = (bundle: BrainExportBundle) => {
  const manifest = bundle.files[0];
  if (manifest === undefined || manifest.path !== "manifest.json") {
    throw new Error("deterministic export manifest is missing");
  }
  return {
    manifestHash: manifest.hash,
    artifactHash: bundle.files.map(({ hash }) => hash).join(":"),
    sizeBytes: bundle.files.reduce(
      (total, file) => total + file.bytes.length,
      0,
    ),
    fileCount: bundle.files.length,
  };
};

export const runBrainExportJob = (input: {
  readonly job: BrainExportJob;
  readonly exportInput: BrainExportInput;
  readonly currentLifecycleGeneration: number;
}): BrainExportJob => {
  if (input.job.state !== "requested") return input.job;
  if (input.currentLifecycleGeneration !== input.job.lifecycleGeneration) {
    return {
      ...input.job,
      state: "revoked",
      error: "lifecycle_generation_mismatch",
    };
  }
  try {
    const bundle = encodeBrainExport(input.exportInput);
    return { ...input.job, state: "ready", artifact: artifactSummary(bundle) };
  } catch {
    return { ...input.job, state: "failed", error: "encoding_failed" };
  }
};
