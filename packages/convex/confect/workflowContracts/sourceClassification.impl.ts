import * as Workflow from "@convex-dev/workflow";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Server from "convex/server";
import { v, type GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { components as generatedComponents } from "../../convex/_generated/api";
import databaseSchema from "../_generated/schema";
import { roleAtLeast, type Role } from "../access/roles";
import { gatherClassificationRequest } from "../classification/gather";
import { DatabaseReader, MutationCtx, QueryCtx } from "../_generated/services";
import { NotFound, Unauthorized, ValidationFailed } from "../errors";
import {
  runDurableGraphWorkflow,
  type DurableGraphCapabilityEntry,
  type RunDurableGraphStep,
} from "../workflows/_kit/graphRunner";
import { startWorkflowAndRecordOwnership } from "../workflows/_kit/ownership";
import { projectWorkflowStatus } from "../workflows/_kit/status";
import { sourceClassificationGraph } from "../workflows/sourceClassification.graph";
import sourceClassification from "./sourceClassification.spec";

// prettier-ignore
const workflowComponent = Server.componentsGeneric().workflow as unknown as Workflow.WorkflowComponent;
// prettier-ignore
const mutationRef = (path: string) => Server.makeFunctionReference(path) as unknown as DurableGraphCapabilityEntry<"mutation">["ref"];
const workflowCaller = {
  kind: "system" as const,
  name: "sourceClassification",
  surface: "workflow" as const,
};
// prettier-ignore
const capabilityRegistry = { "classification.model": { kind: "mutation", ref: mutationRef("capabilities/classifySourceUnit:classifySourceUnit"), buildArgs: ({ inputs }) => ({ request: (inputs as { request: unknown }).request, caller: workflowCaller }) }, "routes.commit": { kind: "mutation", ref: mutationRef("capabilities/commitSourceRoute:commitSourceRoute"), buildArgs: ({ inputs, context }) => ({ workspaceId: (inputs as { workspaceId: string }).workspaceId, idempotencyKey: (inputs as { idempotencyKey: string }).idempotencyKey, proposal: { ...(context.classify as object), ...(inputs as { request: { authority: object } }).request.authority }, review: context.review, currentAuthority: (inputs as { request: { authority: object } }).request.authority, caller: workflowCaller }) } } satisfies Readonly<Record<string, DurableGraphCapabilityEntry>>;
// prettier-ignore
const message = v.object({ sourceRevisionKey: v.string(), authorLabel: v.string(), providerTimestamp: v.string(), canonicalText: v.string() });
// prettier-ignore
const target = v.object({ workspaceId: v.string(), organizationId: v.string(), brainKey: v.string(), displayName: v.string(), routingDescription: v.optional(v.string()) });
// prettier-ignore
const authority = v.object({ workspaceId: v.string(), organizationId: v.string(), policyVersion: v.number(), lifecycleGeneration: v.number(), routeGeneration: v.number(), leaseGeneration: v.number() });
// prettier-ignore
const classificationRequest = v.object({ workspaceId: v.string(), organizationId: v.string(), sourceUnitRevisionKey: v.string(), sourceUnitHash: v.string(), messages: v.array(message), policyVersion: v.number(), lifecycleGeneration: v.number(), routeGeneration: v.number(), leaseGeneration: v.number(), allowedTargets: v.array(target), authority });
// prettier-ignore
export const run = Workflow.defineWorkflow(generatedComponents.workflow, { args: { workspaceId: v.string(), idempotencyKey: v.string(), request: classificationRequest }, returns: v.any() }).handler((step, args) => runDurableGraphWorkflow(step as RunDurableGraphStep, { graph: sourceClassificationGraph, inputs: args, policySnapshot: args.request.authority, capabilityRegistry, projectOutput: ({ context }) => ({ result: context.commit }) }));
// prettier-ignore
const validationError = () => new ValidationFailed({ field: "workflow", message: "Workflow operation failed." });
const requireCaller = (caller: { kind: string; surface: string }) =>
  caller.kind === "system" &&
  (caller.surface === "workflow" || caller.surface === "internal")
    ? Effect.void
    : Effect.fail(new Unauthorized());

type GatherInput = Parameters<typeof gatherClassificationRequest>[0];
// prettier-ignore
type StartClassificationRequest = GatherInput["sourceUnit"] & { readonly allowedTargets: GatherInput["allowedTargets"]; readonly authority: GatherInput["authority"] };
type ReviewAuthorityInput = {
  reviewerPrincipalKey: string;
  reviewerAuthority: {
    workspaceId: string;
    organizationId: string;
    role: Role;
  };
};
// prettier-ignore
const validateStartRequest = (workspaceId: string, request: StartClassificationRequest) => request.workspaceId === workspaceId ? Effect.try({ try: () => gatherClassificationRequest({ policyMode: "classify", sourceUnit: request, allowedTargets: request.allowedTargets, authority: request.authority }), catch: validationError }).pipe(Effect.asVoid) : Effect.fail(validationError());
// prettier-ignore
const isLiveAdmin = (member: { readonly role: Role; readonly status: string; readonly acceptedAt: number | null; readonly revokedAt: number | null; readonly deletedAt?: number | null }) => member.status === "active" && member.acceptedAt !== null && member.revokedAt === null && (member.deletedAt === undefined || member.deletedAt === null) && roleAtLeast(member.role, "admin");
// prettier-ignore
const requireReviewerAuthority = (workspaceId: string, review: ReviewAuthorityInput) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const workspace = yield* reader.table("workspaces").get(workspaceId as GenericId<"workspaces">).pipe(Effect.orDie);
    if (!workspace || review.reviewerAuthority.workspaceId !== workspaceId || workspace.organizationId !== review.reviewerAuthority.organizationId || !roleAtLeast(review.reviewerAuthority.role, "admin")) return yield* Effect.fail(new Unauthorized());
    const workspaceMemberships = yield* reader.table("workspaceMembers").index("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", review.reviewerPrincipalKey)).collect().pipe(Effect.orDie);
    const organizationMemberships = yield* reader.table("organizationMembers").index("by_organization_user", (q) => q.eq("organizationId", workspace.organizationId).eq("userId", review.reviewerPrincipalKey)).collect().pipe(Effect.orDie);
    return workspaceMemberships.some(isLiveAdmin) || organizationMemberships.some(isLiveAdmin) ? undefined : yield* Effect.fail(new Unauthorized());
  });
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
// prettier-ignore
const runWorkflowImpl = FunctionImpl.make(databaseSchema, sourceClassification, "run", run);
// prettier-ignore
const startImpl = FunctionImpl.make(databaseSchema, sourceClassification, "start", ({ workspaceId, idempotencyKey, request, caller }) =>
    Effect.gen(function* () {
      yield* requireCaller(caller);
      yield* validateStartRequest(workspaceId, request);
      const startedAt = yield* Clock.currentTimeMillis as Effect.Effect<number>;
      const componentWorkflowId = yield* startWorkflowAndRecordOwnership({
        workflowRef: Server.makeFunctionReference("workflowContracts/sourceClassification:run") as unknown as Server.FunctionReference<"mutation", "internal">,
        workflowArgs: {
          workspaceId,
          idempotencyKey,
          request,
        } as never,
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
// prettier-ignore
const statusImpl = FunctionImpl.make(databaseSchema, sourceClassification, "status", ({ workspaceId, componentWorkflowId, caller }) =>
    Effect.gen(function* () {
      yield* requireCaller(caller);
      const run = yield* findRun(workspaceId, componentWorkflowId);
      const ctx = yield* QueryCtx;
      const status = yield* Effect.promise(() =>
        Workflow.getStatus(ctx, workflowComponent, componentWorkflowId as Workflow.WorkflowId),
      ).pipe(Effect.mapError(validationError));
      return projectWorkflowStatus(
        status,
        run as Parameters<typeof projectWorkflowStatus>[1],
      );
    }),
);
// prettier-ignore
const approveImpl = FunctionImpl.make(databaseSchema, sourceClassification, "approve", ({ workspaceId, componentWorkflowId, nodeId, review, caller }) =>
    Effect.gen(function* () {
      yield* requireCaller(caller);
      yield* requireReviewerAuthority(workspaceId, review);
      yield* findRun(workspaceId, componentWorkflowId);
      const ctx = yield* MutationCtx;
      const eventId = yield* Effect.promise(() =>
        Workflow.sendEvent(ctx, workflowComponent, {
          workflowId: componentWorkflowId as Workflow.WorkflowId,
          name: `${sourceClassificationGraph.id}.${nodeId}.approved`,
          value: review,
        }),
      ).pipe(Effect.mapError(validationError));
      return { eventId };
    }),
);
// prettier-ignore
export default GroupImpl.make(databaseSchema, sourceClassification).pipe(Layer.provide(runWorkflowImpl), Layer.provide(startImpl), Layer.provide(statusImpl), Layer.provide(approveImpl), GroupImpl.finalize);
