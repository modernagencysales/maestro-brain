import type { BrainExportBundle } from "./brainExport";
import type { BrainExportJob } from "./brainExportJob";

export class ArtifactExpired extends Error {
  constructor() {
    super("Brain export artifact has expired.");
    this.name = "ArtifactExpired";
  }
}
export class ArtifactLifecycleRevoked extends Error {
  constructor() {
    super("Brain export artifact is revoked by its lifecycle fence.");
    this.name = "ArtifactLifecycleRevoked";
  }
}
export class ArtifactPurged extends Error {
  constructor() {
    super("Brain export artifact has been purged.");
    this.name = "ArtifactPurged";
  }
}

type ArtifactState = "ready" | "expired" | "revoked" | "purged";
export type BrainExportArtifact = Readonly<{
  readonly artifactId: string;
  readonly jobId: string;
  readonly lifecycleGeneration: number;
  readonly storedAt: string;
  readonly expiresAt: string;
  readonly state: ArtifactState;
  readonly files: BrainExportBundle["files"];
}>;

export type BrainExportArtifactStore = Map<string, BrainExportArtifact>;

export const createBrainExportArtifactStore = (): BrainExportArtifactStore =>
  new Map();

const immutableFiles = (
  bundle: BrainExportBundle,
): BrainExportBundle["files"] =>
  bundle.files.map((file) =>
    Object.freeze({ ...file, bytes: new Uint8Array(file.bytes) }),
  );

export const persistBrainExportArtifact = (input: {
  readonly store: BrainExportArtifactStore;
  readonly job: BrainExportJob;
  readonly bundle: BrainExportBundle;
  readonly currentLifecycleGeneration: number;
  readonly storedAt: string;
  readonly ttlMs: number;
}): BrainExportArtifact => {
  if (
    input.job.state !== "ready" ||
    input.currentLifecycleGeneration !== input.job.lifecycleGeneration
  )
    throw new ArtifactLifecycleRevoked();
  const artifact: BrainExportArtifact = Object.freeze({
    artifactId: `brain-export:${input.job.jobId}`,
    jobId: input.job.jobId,
    lifecycleGeneration: input.job.lifecycleGeneration,
    storedAt: input.storedAt,
    expiresAt: new Date(
      new Date(input.storedAt).getTime() + input.ttlMs,
    ).toISOString(),
    state: "ready",
    files: immutableFiles(input.bundle),
  });
  input.store.set(artifact.artifactId, artifact);
  return artifact;
};

const replace = (
  store: BrainExportArtifactStore,
  artifactId: string,
  patch: Partial<BrainExportArtifact>,
): BrainExportArtifact => {
  const current = store.get(artifactId);
  if (current === undefined) throw new ArtifactPurged();
  const next = Object.freeze({ ...current, ...patch });
  store.set(artifactId, next);
  return next;
};

export const readBrainExportArtifact = (input: {
  readonly store: BrainExportArtifactStore;
  readonly artifactId: string;
  readonly currentLifecycleGeneration: number;
  readonly now: string;
}): BrainExportArtifact => {
  const artifact = input.store.get(input.artifactId);
  if (artifact === undefined || artifact.state === "purged")
    throw new ArtifactPurged();
  if (artifact.lifecycleGeneration !== input.currentLifecycleGeneration)
    throw new ArtifactLifecycleRevoked();
  if (artifact.state === "revoked") throw new ArtifactLifecycleRevoked();
  if (artifact.state === "expired" || input.now >= artifact.expiresAt)
    throw new ArtifactExpired();
  return artifact;
};

export const expireBrainExportArtifact = (
  store: BrainExportArtifactStore,
  artifactId: string,
  now: string,
): BrainExportArtifact =>
  replace(store, artifactId, { state: "expired", expiresAt: now });

export const revokeBrainExportArtifact = (
  store: BrainExportArtifactStore,
  artifactId: string,
  _currentLifecycleGeneration: number,
): BrainExportArtifact => replace(store, artifactId, { state: "revoked" });

export const purgeBrainExportArtifact = (
  store: BrainExportArtifactStore,
  artifactId: string,
): BrainExportArtifact => {
  const current = store.get(artifactId);
  if (current === undefined) throw new ArtifactPurged();
  const purged = Object.freeze({
    ...current,
    state: "purged" as const,
    files: [],
  });
  store.set(artifactId, purged);
  return purged;
};
