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
const capabilityRegistry = { "classification.gather": { kind: "query", ref: mutationRef("workflowContracts/sourceClassification:gather") as unknown as DurableGraphCapabilityEntry<"query">["ref"], buildArgs: ({ inputs }) => ({ workspaceId: (inputs as { workspaceId: string }).workspaceId, sourceUnitRevisionKey: (inputs as { sourceUnitRevisionKey: string }).sourceUnitRevisionKey, caller: workflowCaller }) }, "classification.model": { kind: "mutation", ref: mutationRef("capabilities/classifySourceUnit:classifySourceUnit"), buildArgs: ({ context }) => ({ request: context.gather, caller: workflowCaller }) }, "classification.currentAuthority": { kind: "query", ref: mutationRef("workflowContracts/sourceClassification:currentAuthority") as unknown as DurableGraphCapabilityEntry<"query">["ref"], buildArgs: ({ inputs }) => ({ workspaceId: (inputs as { workspaceId: string }).workspaceId, sourceUnitRevisionKey: (inputs as { sourceUnitRevisionKey: string }).sourceUnitRevisionKey, caller: workflowCaller }) }, "routes.commit": { kind: "mutation", ref: mutationRef("capabilities/commitSourceRoute:commitSourceRoute"), buildArgs: ({ inputs, context }) => ({ workspaceId: (inputs as { workspaceId: string }).workspaceId, idempotencyKey: (inputs as { idempotencyKey: string }).idempotencyKey, proposal: { ...(context.classify as object), ...(context.gather as { authority: object }).authority }, review: context.review, currentAuthority: context.currentAuthority, caller: workflowCaller }) } } satisfies Readonly<Record<string, DurableGraphCapabilityEntry>>;
// prettier-ignore
export const run = Workflow.defineWorkflow(generatedComponents.workflow, { args: { workspaceId: v.string(), idempotencyKey: v.string(), sourceUnitRevisionKey: v.string() }, returns: v.any() }).handler((step, args) => runDurableGraphWorkflow(step as RunDurableGraphStep, { graph: sourceClassificationGraph, inputs: args, policySnapshot: { workspaceId: args.workspaceId, sourceUnitRevisionKey: args.sourceUnitRevisionKey }, capabilityRegistry, projectOutput: ({ context }) => ({ result: context.commit }) }));
// prettier-ignore
const validationError = () => new ValidationFailed({ field: "workflow", message: "Workflow operation failed." });
const requireCaller = (caller: { kind: string; surface: string }) =>
  caller.kind === "system" &&
  (caller.surface === "workflow" || caller.surface === "internal")
    ? Effect.void
    : Effect.fail(new Unauthorized());

type ReviewAuthorityInput = {
  reviewerPrincipalKey: string;
  reviewerAuthority: {
    workspaceId: string;
    organizationId: string;
    role: Role;
  };
};
// prettier-ignore
const validateSourceUnitKey = (sourceUnitRevisionKey: string) => sourceUnitRevisionKey.length > 0 ? Effect.void : Effect.fail(validationError());
const loadGatherRequest = (
  workspaceId: string,
  sourceUnitRevisionKey: string,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const workspace = yield* reader
      .table("workspaces")
      .get(workspaceId as GenericId<"workspaces">)
      .pipe(Effect.orDie);
    if (!workspace)
      return yield* new NotFound({ resource: "workspaces", id: workspaceId });
    const organization = yield* reader
      .table("organizations")
      .get(workspace.organizationId as GenericId<"organizations">)
      .pipe(Effect.orDie);
    if (!organization?.agencyKey || organization.status !== "active")
      return yield* new NotFound({
        resource: "organizations",
        id: workspace.organizationId,
      });
    const organizationKey = organization.agencyKey;
    const revision = yield* reader
      .table("sourceUnitRevisions")
      .index("by_unit_revision_key", (q) =>
        q
          .eq("organizationKey", organizationKey)
          .eq("unitRevisionKey", sourceUnitRevisionKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (!revision)
      return yield* new NotFound({
        resource: "sourceUnitRevisions",
        id: sourceUnitRevisionKey,
      });
    const unit = yield* reader
      .table("sourceUnits")
      .index("by_unit_key", (q) =>
        q
          .eq("organizationKey", organizationKey)
          .eq("unitKey", revision.unitKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    const route = yield* reader
      .table("callRoutingProposals")
      .index("by_org_revision", (q) =>
        q
          .eq("organizationKey", organizationKey)
          .eq("unitRevisionKey", sourceUnitRevisionKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (
      !unit ||
      unit.currentUnitRevisionKey !== sourceUnitRevisionKey ||
      unit.lifecycle.state !== "active" ||
      revision.tombstone ||
      !route ||
      route.status !== "current" ||
      (route.outcome !== "no_match" && route.outcome !== "awaiting_review")
    )
      return yield* Effect.fail(validationError());
    const segments = yield* reader
      .table("sourceSegments")
      .index("by_unit_revision_ordinal", (q) =>
        q
          .eq("organizationKey", organizationKey)
          .eq("unitRevisionKey", sourceUnitRevisionKey),
      )
      .collect()
      .pipe(Effect.orDie);
    if (segments.length === 0) return yield* Effect.fail(validationError());
    const targets = yield* reader
      .table("workspaces")
      .index("by_organization", (q) =>
        q.eq("organizationId", workspace.organizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const jobs = yield* reader
      .table("sourceProcessingJobs")
      .index("by_org_unit_stage", (q) =>
        q.eq("organizationKey", organizationKey).eq("unitKey", unit.unitKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const job = jobs.find(
      (candidate) =>
        candidate.lifecycleGeneration === unit.lifecycle.generation &&
        candidate.routeGeneration === route.routeGeneration,
    );
    const authority = {
      workspaceId,
      organizationId: workspace.organizationId,
      policyVersion: job?.policyGeneration ?? 1,
      lifecycleGeneration: unit.lifecycle.generation,
      routeGeneration: route.routeGeneration,
      leaseGeneration: job?.leaseGeneration ?? 0,
    };
    const gathered = gatherClassificationRequest({
      policyMode: "classify",
      authority,
      sourceUnit: {
        ...authority,
        sourceUnitRevisionKey,
        sourceUnitHash: revision.contentHash,
        messages: segments.map((segment) => ({
          sourceRevisionKey: segment.segmentKey,
          authorLabel: segment.speakerLabel,
          providerTimestamp: revision.startedAt,
          canonicalText: segment.text,
        })),
      },
      allowedTargets: targets.flatMap((target) =>
        target.status === "active" &&
        target.kind === "client" &&
        target.brainKey &&
        route.candidateBrainKeys.includes(target.brainKey)
          ? [
              {
                workspaceId: target._id,
                organizationId: workspace.organizationId,
                brainKey: target.brainKey,
                displayName: target.name,
              },
            ]
          : [],
      ),
    });
    if (!("request" in gathered)) return yield* Effect.fail(validationError());
    return gathered.request;
  });
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
const gatherImpl = FunctionImpl.make(databaseSchema, sourceClassification, "gather", ({ workspaceId, sourceUnitRevisionKey, caller }) =>
  Effect.gen(function* () {
    yield* requireCaller(caller);
    yield* validateSourceUnitKey(sourceUnitRevisionKey);
    return yield* loadGatherRequest(workspaceId, sourceUnitRevisionKey);
  }),
);
// prettier-ignore
const currentAuthorityImpl = FunctionImpl.make(databaseSchema, sourceClassification, "currentAuthority", ({ workspaceId, sourceUnitRevisionKey, caller }) =>
  Effect.gen(function* () {
    yield* requireCaller(caller);
    yield* validateSourceUnitKey(sourceUnitRevisionKey);
    return (yield* loadGatherRequest(workspaceId, sourceUnitRevisionKey)).authority;
  }),
);
// prettier-ignore
const runWorkflowImpl = FunctionImpl.make(databaseSchema, sourceClassification, "run", run);
// prettier-ignore
const startImpl = FunctionImpl.make(databaseSchema, sourceClassification, "start", ({ workspaceId, idempotencyKey, sourceUnitRevisionKey, caller }) =>
    Effect.gen(function* () {
      yield* requireCaller(caller);
      yield* validateSourceUnitKey(sourceUnitRevisionKey);
      const startedAt = yield* Clock.currentTimeMillis as Effect.Effect<number>;
      const componentWorkflowId = yield* startWorkflowAndRecordOwnership({
        workflowRef: Server.makeFunctionReference("workflowContracts/sourceClassification:run") as unknown as Server.FunctionReference<"mutation", "internal">,
        workflowArgs: {
          workspaceId,
          idempotencyKey,
          sourceUnitRevisionKey,
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
export default GroupImpl.make(databaseSchema, sourceClassification).pipe(Layer.provide(runWorkflowImpl), Layer.provide(gatherImpl), Layer.provide(currentAuthorityImpl), Layer.provide(startImpl), Layer.provide(statusImpl), Layer.provide(approveImpl), GroupImpl.finalize);
