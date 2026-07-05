import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import { validateCallerIdempotencyKey } from "../shared/idempotencyKey";
import versioning, { VersioningError } from "./versioning.spec";

const now = 1_700_000_000_000;

const reconciliationKey = (input: {
  readonly workspaceId: string;
  readonly entityKey: string;
  readonly externalVersion: string;
  readonly idempotencyKey: string;
}) =>
  [
    input.workspaceId,
    input.entityKey,
    input.externalVersion,
    input.idempotencyKey,
  ].join("::");

const validateVersionIdempotencyKey = (
  idempotencyKey: string,
): string | VersioningError.ValidationFailed => {
  const validation = validateCallerIdempotencyKey(idempotencyKey);

  return validation.ok
    ? validation.value
    : new VersioningError.ValidationFailed({
        field: "idempotencyKey",
        message: validation.error.message,
      });
};

const append = FunctionImpl.make(
  databaseSchema,
  versioning,
  "append",
  (input) => {
    const idempotencyKey = validateVersionIdempotencyKey(input.idempotencyKey);

    if (idempotencyKey instanceof Error) {
      return Effect.fail(idempotencyKey);
    }

    return Effect.succeed({
      workspaceId: input.workspaceId,
      entityKey: input.entityKey,
      versionKey: input.versionKey,
      priorVersionKey: input.priorVersionKey,
      causation: input.causation,
      actorId: input.actorId,
      payloadHash: input.payloadHash,
      payloadJson: input.payloadJson,
      idempotencyKey,
      appendOnly: true,
      createdAt: now,
    });
  },
);

const restore = FunctionImpl.make(
  databaseSchema,
  versioning,
  "restore",
  (input) => {
    const idempotencyKey = validateVersionIdempotencyKey(input.idempotencyKey);

    if (idempotencyKey instanceof Error) {
      return Effect.fail(idempotencyKey);
    }

    return Effect.succeed({
      workspaceId: input.workspaceId,
      entityKey: input.entityKey,
      versionKey: input.versionKey,
      priorVersionKey: input.restoredFromVersionKey,
      restoredFromVersionKey: input.restoredFromVersionKey,
      causation: "restore" as const,
      actorId: input.actorId,
      payloadHash: input.payloadHash,
      payloadJson: input.payloadJson,
      idempotencyKey,
      appendOnly: true,
      createdAt: now,
    });
  },
);

const reconcile = FunctionImpl.make(
  databaseSchema,
  versioning,
  "reconcile",
  (input) => {
    const idempotencyKey = validateVersionIdempotencyKey(input.idempotencyKey);

    if (idempotencyKey instanceof Error) {
      return Effect.fail(idempotencyKey);
    }

    return Effect.succeed({
      workspaceId: input.workspaceId,
      entityKey: input.entityKey,
      versionKey: `external:${input.externalVersion}`,
      externalVersion: input.externalVersion,
      reconciliationKey: reconciliationKey({ ...input, idempotencyKey }),
      causation: "reconcile" as const,
      actorId: input.actorId,
      payloadHash: input.payloadHash,
      payloadJson: input.payloadJson,
      idempotencyKey,
      appendOnly: true,
      createdAt: now,
    });
  },
);

const markFreshness = FunctionImpl.make(
  databaseSchema,
  versioning,
  "markFreshness",
  (input) =>
    Effect.succeed({
      workspaceId: input.workspaceId,
      entityKey: input.entityKey,
      status: input.status,
      reason: input.reason,
      checkedAt: now,
      nextReviewAt: input.nextReviewAt,
      mutableFreshness: true,
    }),
);

const latest = FunctionImpl.make(
  databaseSchema,
  versioning,
  "latest",
  (input) =>
    Effect.succeed({
      workspaceId: input.workspaceId,
      entityKey: input.entityKey,
      versionKey: "v1",
      causation: "import" as const,
      actorId: "fake/local",
      payloadHash: "sha256:fake-local",
      payloadJson: "{}",
      idempotencyKey: `latest:${input.workspaceId}:${input.entityKey}`,
      appendOnly: true,
      createdAt: now,
    }),
);

export default GroupImpl.make(databaseSchema, versioning).pipe(
  Layer.provide(append),
  Layer.provide(restore),
  Layer.provide(reconcile),
  Layer.provide(markFreshness),
  Layer.provide(latest),
  GroupImpl.finalize,
);
