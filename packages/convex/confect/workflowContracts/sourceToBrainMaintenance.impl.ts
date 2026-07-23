import {
  getStatus,
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
import * as Schema from "effect/Schema";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, QueryCtx } from "../_generated/services";
import { SystemPrincipal } from "../capabilities/_kit/principal";
import {
  AutopilotNotEligible,
  CitationNotInManifest,
  CitationRequired,
  LifecycleRevoked,
  RevisionBudgetExceeded,
  StaleRevision,
} from "../capabilities/maintainBrainPage.spec";
import {
  MemberNotInWorkspace,
  NotFound,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import { startWorkflowAndRecordOwnership } from "../workflows/_kit/ownership";
import {
  projectWorkflowStatus,
  type WorkflowStatusRunProjection,
} from "../workflows/_kit/status";
import { sourceToBrainMaintenanceGraph } from "../workflows/sourceToBrainMaintenance.graph";
import sourceToBrainMaintenance from "./sourceToBrainMaintenance.spec";

type InternalWorkflowCaller = Schema.Schema.Type<typeof SystemPrincipal>;
type WorkflowError =
  | Unauthorized
  | MemberNotInWorkspace
  | WorkspaceNotFound
  | NotFound
  | ValidationFailed
  | CitationRequired
  | CitationNotInManifest
  | RevisionBudgetExceeded
  | AutopilotNotEligible
  | StaleRevision
  | LifecycleRevoked;
type RunArgs = {
  readonly args: {
    readonly workspaceId: string;
    readonly idempotencyKey: string;
  };
};
const workflowComponent = componentsGeneric()
  .workflow as unknown as WorkflowComponent;
const sourceToBrainMaintenanceRunRef = makeFunctionReference<
  "mutation",
  RunArgs,
  WorkflowId
>(
  "workflowRunners/sourceToBrainMaintenance:run",
) as unknown as FunctionReference<"mutation", "internal", RunArgs, WorkflowId>;
const withConfectClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;
export const sourceToBrainMaintenanceWorkflowPrincipal = {
  kind: "system",
  name: "sourceToBrainMaintenance",
  surface: "workflow" as const,
} satisfies InternalWorkflowCaller;
const requireInternalWorkflowCaller = (caller: InternalWorkflowCaller) =>
  caller.kind === "system" &&
  (caller.surface === "workflow" || caller.surface === "internal")
    ? Effect.succeed(caller)
    : Effect.fail(new Unauthorized());
const toValidationFailed = (error: unknown): ValidationFailed =>
  new ValidationFailed({
    field: "workflow",
    message:
      error instanceof Error ? error.message : "Unable to start workflow.",
  });
const typedErrorClasses = [
  Unauthorized,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  NotFound,
  ValidationFailed,
  CitationRequired,
  CitationNotInManifest,
  RevisionBudgetExceeded,
  AutopilotNotEligible,
  StaleRevision,
  LifecycleRevoked,
] as const;
const toWorkflowError = (error: unknown): WorkflowError =>
  typedErrorClasses.some((errorClass) => error instanceof errorClass)
    ? (error as WorkflowError)
    : toValidationFailed(error);
const findWorkflowRun = (workspaceId: string, componentWorkflowId: string) =>
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
    return (
      run ??
      (yield* Effect.fail(
        new NotFound({ resource: "workflowRuns", id: componentWorkflowId }),
      ))
    );
  });
const startImpl = FunctionImpl.make(
  databaseSchema,
  sourceToBrainMaintenance,
  "start",
  ({ workspaceId, idempotencyKey, caller }) =>
    Effect.gen(function* () {
      const principal = yield* requireInternalWorkflowCaller(caller);
      const startedAt = yield* withConfectClock(Clock.currentTimeMillis);
      const componentWorkflowId = yield* startWorkflowAndRecordOwnership({
        workflowRef: sourceToBrainMaintenanceRunRef,
        workflowArgs: { workspaceId, idempotencyKey },
        workspaceId,
        workflowId: sourceToBrainMaintenanceGraph.id,
        workflowVersion: sourceToBrainMaintenanceGraph.version,
        graphJson: JSON.stringify(sourceToBrainMaintenanceGraph),
        idempotencyKey,
        startedByUserId: `system:${principal.surface}:${principal.name}`,
        startedAt,
        workflowKind: "workflow.sourceToBrainMaintenance",
      }).pipe(Effect.mapError(toValidationFailed));
      return {
        status: "queued" as const,
        workflow: "sourceToBrainMaintenance" as const,
        componentWorkflowId,
      };
    }).pipe(Effect.mapError(toWorkflowError)),
);
const statusImpl = FunctionImpl.make(
  databaseSchema,
  sourceToBrainMaintenance,
  "status",
  ({ workspaceId, componentWorkflowId, caller }) =>
    Effect.gen(function* () {
      yield* requireInternalWorkflowCaller(caller);
      const run = yield* findWorkflowRun(workspaceId, componentWorkflowId);
      const ctx = yield* QueryCtx;
      const rawStatus = yield* Effect.promise(() =>
        getStatus(ctx, workflowComponent, componentWorkflowId as WorkflowId),
      ).pipe(Effect.mapError(toValidationFailed));
      const runProjection = {
        ...(run.status !== undefined ? { status: run.status } : {}),
        ...(run.deadlineAt !== undefined ? { deadlineAt: run.deadlineAt } : {}),
        ...(run.timedOutAt !== undefined ? { timedOutAt: run.timedOutAt } : {}),
        ...(run.timeoutErrorCode !== undefined
          ? { timeoutErrorCode: run.timeoutErrorCode }
          : {}),
        ...(run.timeoutSummary !== undefined
          ? { timeoutSummary: run.timeoutSummary }
          : {}),
      } satisfies WorkflowStatusRunProjection;
      return projectWorkflowStatus(rawStatus, runProjection);
    }).pipe(Effect.mapError(toWorkflowError)),
);
export default GroupImpl.make(databaseSchema, sourceToBrainMaintenance).pipe(
  Layer.provide(startImpl),
  Layer.provide(statusImpl),
  GroupImpl.finalize,
);
