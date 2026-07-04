import { start, type WorkflowId } from "@convex-dev/workflow";
import type { FunctionArgs, FunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  DatabaseReader,
  DatabaseWriter,
  MutationCtx,
} from "../../_generated/services";
import { makePublicError } from "../../shared/errors";

type Reader = Context.Tag.Service<typeof DatabaseReader>;
type Writer = Context.Tag.Service<typeof DatabaseWriter>;
type Mutation = Context.Tag.Service<typeof MutationCtx>;
type ExistingWorkflowRun = {
  readonly componentWorkflowId?: string | null | undefined;
};

export type StartWorkflowOwnershipInput<
  F extends FunctionReference<"mutation", "internal">,
> = {
  readonly workflowRef: F;
  readonly workflowArgs: FunctionArgs<F>["args"];
  readonly workspaceId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly graphJson: string;
  readonly idempotencyKey: string;
  readonly startedByUserId: string;
  readonly startedAt: number;
  readonly trustReceiptId?: string | null;
  readonly workflowKind?: string;
  readonly sourceRunKind?: string;
  readonly sourceRunId?: string;
  readonly timeoutMs?: number;
  readonly deadlineAt?: number;
};

export const startWorkflowAndRecordOwnership = <
  F extends FunctionReference<"mutation", "internal">,
>(
  input: StartWorkflowOwnershipInput<F>,
): Effect.Effect<
  WorkflowId,
  unknown,
  MutationCtx | DatabaseReader | DatabaseWriter
> =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const mutationCtx = yield* MutationCtx;
    const existing = yield* readExistingWorkflowRun(reader, input);

    const existingWorkflowId = yield* handleExistingWorkflowRun(
      existing,
      input,
    );
    if (existingWorkflowId) {
      return existingWorkflowId;
    }

    const reservationId = yield* reserveWorkflowRun(writer, input);
    const componentWorkflowId = yield* startComponentWorkflow(
      mutationCtx,
      input,
    );
    yield* recordStartedWorkflow(writer, reservationId, componentWorkflowId);
    return componentWorkflowId;
  });

const readExistingWorkflowRun = <
  F extends FunctionReference<"mutation", "internal">,
>(
  reader: Reader,
  input: StartWorkflowOwnershipInput<F>,
) =>
  reader
    .table("workflowRuns")
    .index("by_idempotency_key", (q) =>
      q
        .eq("workspaceId", input.workspaceId)
        .eq("idempotencyKey", input.idempotencyKey),
    )
    .first()
    .pipe(Effect.map(Option.getOrNull), Effect.orDie);

const handleExistingWorkflowRun = <
  F extends FunctionReference<"mutation", "internal">,
>(
  existing: ExistingWorkflowRun | null,
  input: StartWorkflowOwnershipInput<F>,
) => {
  if (existing?.componentWorkflowId) {
    return Effect.succeed(existing.componentWorkflowId as WorkflowId);
  }
  return existing
    ? Effect.fail(
        makePublicError(
          "VALIDATION_FAILED",
          "Workflow start is already reserved for this idempotency key.",
          { idempotencyKey: input.idempotencyKey },
        ),
      )
    : Effect.succeed(null);
};

const reserveWorkflowRun = <
  F extends FunctionReference<"mutation", "internal">,
>(
  writer: Writer,
  input: StartWorkflowOwnershipInput<F>,
) =>
  writer
    .table("workflowRuns")
    .insert({
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      workflowVersion: input.workflowVersion,
      graphJson: input.graphJson,
      status: "queued",
      idempotencyKey: input.idempotencyKey,
      startedByUserId: input.startedByUserId,
      startedAt: input.startedAt,
      completedAt: null,
      failedAt: null,
      trustReceiptId: input.trustReceiptId ?? null,
      ...optionalRunFields(input),
    })
    .pipe(Effect.orDie);

const optionalRunFields = <F extends FunctionReference<"mutation", "internal">>(
  input: StartWorkflowOwnershipInput<F>,
) => ({
  ...definedFields({
    timeoutMs: input.timeoutMs,
    deadlineAt: input.deadlineAt,
  }),
  ...definedTextFields({
    workflowKind: input.workflowKind,
    sourceRunKind: input.sourceRunKind,
    sourceRunId: input.sourceRunId,
  }),
});

const definedFields = <Value extends Record<string, unknown>>(
  fields: Value,
): Partial<Value> =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<Value>;

const definedTextFields = <Value extends Record<string, string | undefined>>(
  fields: Value,
): Partial<Value> =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined && value),
  ) as Partial<Value>;

const startComponentWorkflow = <
  F extends FunctionReference<"mutation", "internal">,
>(
  mutationCtx: Mutation,
  input: StartWorkflowOwnershipInput<F>,
) =>
  Effect.promise(() =>
    start(mutationCtx, input.workflowRef, input.workflowArgs, {
      startAsync: true,
    }),
  );

const recordStartedWorkflow = (
  writer: Writer,
  reservationId: GenericId<"workflowRuns">,
  componentWorkflowId: WorkflowId,
) =>
  writer
    .table("workflowRuns")
    .patch(reservationId, {
      status: "running",
      componentWorkflowId,
    })
    .pipe(Effect.orDie);
