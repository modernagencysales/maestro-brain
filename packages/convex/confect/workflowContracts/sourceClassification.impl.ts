import {
  getStatus,
  sendEvent,
  type WorkflowComponent,
  type WorkflowId,
} from "@convex-dev/workflow";
import { FunctionImpl, GroupImpl } from "@confect/server";
import {
  componentsGeneric,
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, MutationCtx, QueryCtx } from "../_generated/services";
import { NotFound, Unauthorized, ValidationFailed } from "../errors";
import { startWorkflowAndRecordOwnership } from "../workflows/_kit/ownership";
import { projectWorkflowStatus } from "../workflows/_kit/status";
import { sourceClassificationGraph } from "../workflows/sourceClassification.graph";
import sourceClassification from "./sourceClassification.spec";
const workflowComponent = componentsGeneric()
  .workflow as unknown as WorkflowComponent;
type RunArgs = {
  args: { workspaceId: string; idempotencyKey: string };
  startAsync?: boolean;
};
const runRef = makeFunctionReference<"mutation", RunArgs, WorkflowId>(
  "workflowRunners/sourceClassification:run",
) as unknown as FunctionReference<"mutation", "internal", RunArgs, WorkflowId>;
const validationError = () =>
  new ValidationFailed({
    field: "workflow",
    message: "Workflow operation failed.",
  });
const requireCaller = (caller: { kind: string; surface: string }) =>
  caller.kind === "system" &&
  (caller.surface === "workflow" || caller.surface === "internal")
    ? Effect.void
    : Effect.fail(new Unauthorized());
const findRun = (workspaceId: string, componentWorkflowId: string) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const run = yield* reader
      .table("workflowRuns")
      .index("by_workspace_component_workflow", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("componentWorkflowId", componentWorkflowId),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    return run
      ? run
      : yield* Effect.fail(
          new NotFound({ resource: "workflowRuns", id: componentWorkflowId }),
        );
  });
const startImpl = FunctionImpl.make(
  databaseSchema,
  sourceClassification,
  "start",
  ({ workspaceId, idempotencyKey, caller }) =>
    Effect.gen(function* () {
      yield* requireCaller(caller);
      const startedAt = yield* Clock.currentTimeMillis as Effect.Effect<number>;
      const componentWorkflowId = yield* startWorkflowAndRecordOwnership({
        workflowRef: runRef,
        workflowArgs: { workspaceId, idempotencyKey },
        workspaceId,
        workflowId: sourceClassificationGraph.id,
        workflowVersion: sourceClassificationGraph.version,
        graphJson: JSON.stringify(sourceClassificationGraph),
        idempotencyKey,
        startedByUserId: `system:${caller.surface}:${caller.name}`,
        startedAt,
        workflowKind: "workflow.sourceClassification",
      }).pipe(Effect.mapError(validationError));
      return {
        status: "queued" as const,
        workflow: "sourceClassification" as const,
        componentWorkflowId,
      };
    }),
);
const statusImpl = FunctionImpl.make(
  databaseSchema,
  sourceClassification,
  "status",
  ({ workspaceId, componentWorkflowId, caller }) =>
    Effect.gen(function* () {
      yield* requireCaller(caller);
      const run = yield* findRun(workspaceId, componentWorkflowId);
      const ctx = yield* QueryCtx;
      const status = yield* Effect.promise(() =>
        getStatus(ctx, workflowComponent, componentWorkflowId as WorkflowId),
      ).pipe(Effect.mapError(validationError));
      return projectWorkflowStatus(
        status,
        run as Parameters<typeof projectWorkflowStatus>[1],
      );
    }),
);
const approveImpl = FunctionImpl.make(
  databaseSchema,
  sourceClassification,
  "approve",
  ({ workspaceId, componentWorkflowId, nodeId, review, caller }) =>
    Effect.gen(function* () {
      yield* requireCaller(caller);
      yield* findRun(workspaceId, componentWorkflowId);
      const ctx = yield* MutationCtx;
      const eventId = yield* Effect.promise(() =>
        sendEvent(ctx, workflowComponent, {
          workflowId: componentWorkflowId as WorkflowId,
          name: `${sourceClassificationGraph.id}.${nodeId}.approved`,
          value: review,
        }),
      ).pipe(Effect.mapError(validationError));
      return { eventId };
    }),
);
export default GroupImpl.make(databaseSchema, sourceClassification).pipe(
  Layer.provide(startImpl),
  Layer.provide(statusImpl),
  Layer.provide(approveImpl),
  GroupImpl.finalize,
);
