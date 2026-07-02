export type VersionCausation =
  | "human-edit"
  | "agent-edit"
  | "import"
  | "migration"
  | "reconcile"
  | "restore";

export type FreshnessStatus = "fresh" | "review-due" | "stale";

export type VersionedEntry = {
  readonly workspaceId: string;
  readonly entityKey: string;
  readonly versionKey: string;
  readonly priorVersionKey?: string;
  readonly restoredFromVersionKey?: string;
  readonly externalVersion?: string;
  readonly reconciliationKey?: string;
  readonly causation: VersionCausation;
  readonly actorId: string;
  readonly payloadHash: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly appendOnly: true;
};

export type VersionFreshness = {
  readonly workspaceId: string;
  readonly entityKey: string;
  readonly status: FreshnessStatus;
  readonly reason: string;
  readonly checkedAt: string;
  readonly nextReviewAt?: string;
  readonly mutableFreshness: true;
};

export class VersioningValidationError extends Error {
  readonly _tag = "VersioningValidationError";

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "VersioningValidationError";
  }
}

const causations = new Set<VersionCausation>([
  "human-edit",
  "agent-edit",
  "import",
  "migration",
  "reconcile",
  "restore",
]);

const requireNonEmpty = (field: string, value: string): void => {
  if (!value.trim()) {
    throw new VersioningValidationError(field, `${field} is required.`);
  }
};

const assertCausation = (causation: string): VersionCausation => {
  if (!causations.has(causation as VersionCausation)) {
    throw new VersioningValidationError(
      "causation",
      "version causation is invalid.",
    );
  }

  return causation as VersionCausation;
};

const assertFreshness = (status: string): FreshnessStatus => {
  if (status !== "fresh" && status !== "review-due" && status !== "stale") {
    throw new VersioningValidationError(
      "status",
      "freshness status is invalid.",
    );
  }

  return status;
};

const reconciliationKey = (input: {
  readonly workspaceId: string;
  readonly entityKey: string;
  readonly externalVersion: string;
  readonly idempotencyKey: string;
}): string =>
  [
    input.workspaceId.trim(),
    input.entityKey.trim(),
    input.externalVersion.trim(),
    input.idempotencyKey.trim(),
  ].join("::");

export const appendVersion = (input: {
  readonly workspaceId: string;
  readonly entityKey: string;
  readonly versionKey: string;
  readonly priorVersionKey?: string;
  readonly causation: string;
  readonly actorId: string;
  readonly payloadHash: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}): VersionedEntry => {
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("entityKey", input.entityKey);
  requireNonEmpty("versionKey", input.versionKey);
  requireNonEmpty("actorId", input.actorId);
  requireNonEmpty("payloadHash", input.payloadHash);
  requireNonEmpty("idempotencyKey", input.idempotencyKey);

  return {
    workspaceId: input.workspaceId,
    entityKey: input.entityKey,
    versionKey: input.versionKey,
    ...(input.priorVersionKey
      ? { priorVersionKey: input.priorVersionKey }
      : {}),
    causation: assertCausation(input.causation),
    actorId: input.actorId,
    payloadHash: input.payloadHash,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.createdAt,
    appendOnly: true,
  };
};

export const restoreVersion = (input: {
  readonly workspaceId: string;
  readonly entityKey: string;
  readonly restoredFromVersionKey: string;
  readonly versionKey: string;
  readonly actorId: string;
  readonly payloadHash: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}): VersionedEntry => {
  requireNonEmpty("restoredFromVersionKey", input.restoredFromVersionKey);

  return {
    ...appendVersion({
      ...input,
      priorVersionKey: input.restoredFromVersionKey,
      causation: "restore",
    }),
    restoredFromVersionKey: input.restoredFromVersionKey,
  };
};

export const markFreshness = (input: {
  readonly workspaceId: string;
  readonly entityKey: string;
  readonly status: string;
  readonly reason: string;
  readonly checkedAt: string;
  readonly nextReviewAt?: string;
}): VersionFreshness => {
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("entityKey", input.entityKey);
  requireNonEmpty("reason", input.reason);

  return {
    workspaceId: input.workspaceId,
    entityKey: input.entityKey,
    status: assertFreshness(input.status),
    reason: input.reason,
    checkedAt: input.checkedAt,
    ...(input.nextReviewAt ? { nextReviewAt: input.nextReviewAt } : {}),
    mutableFreshness: true,
  };
};

export const reconcileExternalVersion = (input: {
  readonly workspaceId: string;
  readonly entityKey: string;
  readonly externalVersion: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly payloadHash: string;
  readonly payload: unknown;
  readonly createdAt: string;
}): VersionedEntry => {
  requireNonEmpty("externalVersion", input.externalVersion);
  const key = reconciliationKey(input);

  return {
    ...appendVersion({
      workspaceId: input.workspaceId,
      entityKey: input.entityKey,
      versionKey: `external:${input.externalVersion}`,
      causation: "reconcile",
      actorId: input.actorId,
      payloadHash: input.payloadHash,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.createdAt,
    }),
    externalVersion: input.externalVersion,
    reconciliationKey: key,
  };
};
