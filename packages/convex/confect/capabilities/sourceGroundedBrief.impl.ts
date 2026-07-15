import type { GenericId } from "convex/values";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import {
  ModelReceiptDuplicate,
  ModelReceiptTenantMismatch,
  writeAuthenticatedModelCallReceipt,
} from "../modelReceipts/repository";
import { ValidationFailed } from "../errors";
import { requireWorkspaceAccess } from "./_kit/workspaceAccess";
import { runFakeSourceGroundedBrief } from "./sourceGroundedBrief.fake";
import { normalizeSourceGroundedBriefInput } from "./sourceGroundedBrief.domain";
import type { SourceGroundedBriefInput } from "./sourceGroundedBrief.domain";
import sourceGroundedBrief from "./sourceGroundedBrief.spec";

const unsafeAssumeClockProvided = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  // Confect provides Clock at runtime, but its current handler type omits it.
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const runSourceGroundedBrief = (input: SourceGroundedBriefInput) =>
  Effect.gen(function* () {
    yield* unsafeAssumeClockProvided(
      requireWorkspaceAccess(
        input.workspaceId as GenericId<"workspaces">,
        "editor",
      ),
    );

    const normalized = normalizeSourceGroundedBriefInput(input);
    if (normalized instanceof Error) {
      return yield* normalized;
    }

    const result = runFakeSourceGroundedBrief({
      input: normalized,
      sources: normalized.sourceIds.map((sourceId) => ({
        id: sourceId,
        title: `Source ${sourceId}`,
        markdown: "Synthetic source content for fake-mode capability run.",
      })),
      policySnapshotId: `policy_snapshot_${normalized.idempotencyKey}`,
      modelReceiptId: `model_receipt_${normalized.idempotencyKey}`,
    });

    yield* unsafeAssumeClockProvided(
      writeAuthenticatedModelCallReceipt({
        workspaceId: normalized.workspaceId,
        receipt: {
          attemptKey: normalized.idempotencyKey,
          provider: "openrouter",
          model: "openrouter/fake-source-grounded-brief",
          region: "local",
          state: "succeeded",
          trustedInstructionVersion: "source-grounded-brief-v1",
          toolSchemaVersion: "source-grounded-brief-v1",
          schemaGeneration: 1,
          policyGeneration: 1,
          lifecycleGeneration: 1,
          redactionState: "none",
          requestHash: `sha256:source-grounded-brief-request-${normalized.idempotencyKey}`,
          responseHash: `sha256:source-grounded-brief-response-${normalized.idempotencyKey}`,
          sourceHash: `sha256:source-grounded-brief-source-${normalized.idempotencyKey}`,
          inputTokens: Math.max(1, normalized.briefGoal.length),
          outputTokens: Math.max(1, result.briefMarkdown.length),
          costCents: 1,
          latencyMs: 0,
          createdAt: 1770000000000,
        },
      }).pipe(
        Effect.mapError((error) =>
          error instanceof ModelReceiptTenantMismatch ||
          error instanceof ModelReceiptDuplicate
            ? new ValidationFailed({
                field: "idempotencyKey",
                message: error.message,
              })
            : error,
        ),
      ),
    );

    return result;
  });

const run = FunctionImpl.make(
  databaseSchema,
  sourceGroundedBrief,
  "run",
  runSourceGroundedBrief,
);

const runInternal = FunctionImpl.make(
  databaseSchema,
  sourceGroundedBrief,
  "runInternal",
  runSourceGroundedBrief,
);

export default GroupImpl.make(databaseSchema, sourceGroundedBrief).pipe(
  Layer.provide(run),
  Layer.provide(runInternal),
  GroupImpl.finalize,
);
