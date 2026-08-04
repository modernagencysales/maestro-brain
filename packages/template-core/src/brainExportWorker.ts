import {
  encodeBrainExport,
  type BrainExportBundle,
  type BrainExportInput,
} from "./brainExport";
import {
  persistBrainExportArtifact,
  purgeBrainExportArtifact,
  type BrainExportArtifact,
  type BrainExportArtifactStore,
} from "./brainExportStorage";
import { artifactSummary, type BrainExportJob } from "./brainExportJob";

export class ExportUnauthorized extends Error {
  override readonly name = "ExportUnauthorized";
}

export class ExportGenerationStale extends Error {
  override readonly name = "ExportGenerationStale";
}

export type BrainExportAuthorization = {
  readonly brainKey: string;
  readonly canExport: boolean;
  readonly lifecycleGeneration: number;
  readonly policyGeneration?: number;
};

export const gatherAuthorizedBrainRows = (input: {
  readonly requestedBrainKey: string;
  readonly authorization: BrainExportAuthorization;
  readonly read: () => BrainExportInput;
}): BrainExportInput => {
  if (
    !input.authorization.canExport ||
    input.authorization.brainKey !== input.requestedBrainKey
  )
    throw new ExportUnauthorized();

  const rows = input.read();
  if (
    rows.brainKey !== input.requestedBrainKey ||
    rows.lifecycleGeneration !== input.authorization.lifecycleGeneration ||
    (input.authorization.policyGeneration !== undefined &&
      rows.policyGeneration !== input.authorization.policyGeneration)
  )
    throw new ExportGenerationStale();
  return rows;
};

type CurrentGenerations = {
  readonly lifecycleGeneration: number;
  readonly policyGeneration: number;
};

export type BrainExportWorkerResult = {
  readonly job: BrainExportJob;
  readonly artifact?: BrainExportArtifact;
};

export const runBrainExportWorker = (input: {
  readonly job: BrainExportJob;
  readonly requestedBrainKey: string;
  readonly authorization: BrainExportAuthorization;
  readonly read: () => BrainExportInput;
  readonly currentGenerations: () => CurrentGenerations;
  readonly store: BrainExportArtifactStore;
  readonly storedAt: string;
  readonly ttlMs: number;
}): BrainExportWorkerResult => {
  if (input.job.state !== "requested") return { job: input.job };

  const before = input.currentGenerations();
  if (
    before.lifecycleGeneration !== input.job.lifecycleGeneration ||
    before.lifecycleGeneration !== input.authorization.lifecycleGeneration
  )
    return {
      job: {
        ...input.job,
        state: "revoked",
        error: "lifecycle_generation_mismatch",
      },
    };

  let rows: BrainExportInput;
  try {
    rows = gatherAuthorizedBrainRows({
      requestedBrainKey: input.requestedBrainKey,
      authorization: input.authorization,
      read: input.read,
    });
  } catch (error) {
    if (error instanceof ExportGenerationStale) {
      return {
        job: {
          ...input.job,
          state: "revoked",
          error: "lifecycle_generation_mismatch",
        },
      };
    }
    return {
      job: {
        ...input.job,
        state: "failed",
        error:
          error instanceof ExportUnauthorized
            ? "authorization_failed"
            : "lifecycle_generation_mismatch",
        attempt: (input.job.attempt ?? 0) + 1,
      },
    };
  }

  let bundle: BrainExportBundle;
  try {
    bundle = encodeBrainExport(rows);
  } catch {
    return {
      job: {
        ...input.job,
        state: "failed",
        error: "encoding_failed",
        attempt: (input.job.attempt ?? 0) + 1,
      },
    };
  }
  const encoded: BrainExportJob = {
    ...input.job,
    state: "ready",
    artifact: artifactSummary(bundle),
  };
  let artifact: BrainExportArtifact;
  try {
    artifact = persistBrainExportArtifact({
      store: input.store,
      job: encoded,
      bundle,
      currentLifecycleGeneration: before.lifecycleGeneration,
      storedAt: input.storedAt,
      ttlMs: input.ttlMs,
    });
  } catch {
    return {
      job: {
        ...input.job,
        state: "failed",
        error: "encoding_failed",
        attempt: (input.job.attempt ?? 0) + 1,
      },
    };
  }
  const after = input.currentGenerations();
  if (
    after.lifecycleGeneration !== before.lifecycleGeneration ||
    after.policyGeneration !== rows.policyGeneration
  ) {
    purgeBrainExportArtifact(input.store, artifact.artifactId);
    return {
      job: {
        ...input.job,
        state: "revoked",
        error: "lifecycle_generation_mismatch",
      },
    };
  }
  return { job: encoded, artifact };
};

export const retryBrainExportJob = (
  job: BrainExportJob & { readonly attempt: number },
  input: {
    readonly now: number;
    readonly maxAttempts: number;
    readonly backoffMs: number;
  },
): BrainExportJob => {
  if (job.state !== "failed" || job.attempt >= input.maxAttempts) return job;
  const { error, ...withoutError } = job;
  void error;
  return {
    ...withoutError,
    state: "requested",
    attempt: job.attempt + 1,
    nextAttemptAt: input.now + input.backoffMs * 2 ** (job.attempt - 1),
  };
};
