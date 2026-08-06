import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Unauthorized } from "../errors";
import { commitReviewedClassification } from "../classification/commit";
import { validateClassificationProposal } from "../classification/request";
import { reviewClassificationDecision } from "../classification/review";
import databaseSchema from "../_generated/schema";
import { classifySourceUnitLocally } from "./classifySourceUnit.domain";
import {
  ClassificationAuthority,
  classifySourceUnitArgs,
  classifySourceUnitReturns,
  default as classifySourceUnitGroup,
} from "./classifySourceUnit.spec";
import type { ClassificationReviewAction } from "../classification/review";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";

type CommitSourceRouteInput = {
  readonly workspaceId: string;
  readonly request: Schema.Schema.Type<
    typeof classifySourceUnitArgs
  >["request"];
  readonly output: Schema.Schema.Type<typeof classifySourceUnitReturns>;
  readonly review: ClassificationReviewAction & {
    readonly reviewerPrincipalKey: string;
  };
  readonly currentAuthority: Schema.Schema.Type<
    typeof ClassificationAuthority
  > & { readonly existingRouteEffectKeys?: readonly string[] };
  readonly caller: { readonly kind: string; readonly surface: string };
};

const requireWorkflowCaller = (caller: { kind: string; surface: string }) =>
  caller.kind === "system" &&
  (caller.surface === "workflow" || caller.surface === "internal")
    ? Effect.void
    : Effect.fail(new Unauthorized());
const classifySourceUnitImpl = FunctionImpl.make(
  databaseSchema,
  classifySourceUnitGroup,
  "classifySourceUnit",
  ({ request, caller }) =>
    Effect.gen(function* () {
      yield* requireWorkflowCaller(caller);
      const output = classifySourceUnitLocally(request);
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const organization = yield* reader
        .table("organizations")
        .get(request.organizationId as GenericId<"organizations">)
        .pipe(Effect.orDie);
      if (!organization?.agencyKey)
        return yield* Effect.fail(new Unauthorized());
      const organizationKey = organization.agencyKey;
      const proposal = yield* reader
        .table("callRoutingProposals")
        .index("by_org_revision", (query) =>
          query
            .eq("organizationKey", organizationKey)
            .eq("unitRevisionKey", request.sourceUnitRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (proposal !== null) {
        const updatedAt = yield* Clock.currentTimeMillis;
        yield* writer
          .table("callRoutingProposals")
          .patch(proposal._id, {
            outcome: "awaiting_review",
            brainKey: output.targetBrainKey,
            candidateBrainKeys: request.allowedTargets.map(
              ({ brainKey }) => brainKey,
            ),
            reason: "model_proposal",
            updatedAt,
          })
          .pipe(Effect.orDie);
      }
      return output;
    }),
);

const commitSourceRouteImpl = FunctionImpl.make(
  databaseSchema,
  classifySourceUnitGroup,
  "commitSourceRoute",
  ({
    workspaceId,
    request,
    output,
    review,
    currentAuthority,
    caller,
  }: CommitSourceRouteInput) =>
    Effect.gen(function* () {
      yield* requireWorkflowCaller(caller);
      if (workspaceId !== request.workspaceId) {
        return yield* Effect.fail(new Unauthorized());
      }
      const proposal = validateClassificationProposal(request, output);
      const reviewed = reviewClassificationDecision(
        proposal,
        review.action === "change_to_allowed"
          ? {
              action: "change_to_allowed",
              reviewerAuthority: review.reviewerAuthority,
              targetBrainKey: review.targetBrainKey ?? "",
            }
          : {
              action: review.action,
              reviewerAuthority: review.reviewerAuthority,
            },
      );
      const result = commitReviewedClassification(reviewed, {
        expectedPolicyVersion: currentAuthority.policyVersion,
        expectedSourceUnitHash: request.sourceUnitHash,
        expectedLifecycleGeneration: currentAuthority.lifecycleGeneration,
        expectedRouteGeneration: currentAuthority.routeGeneration,
        expectedLeaseGeneration: currentAuthority.leaseGeneration,
        existingRouteEffectKeys: new Set(
          currentAuthority.existingRouteEffectKeys ?? [],
        ),
      });
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const organization = yield* reader
        .table("organizations")
        .get(request.organizationId as GenericId<"organizations">)
        .pipe(Effect.orDie);
      if (!organization?.agencyKey)
        return yield* Effect.fail(new Unauthorized());
      const organizationKey = organization.agencyKey;
      const route = yield* reader
        .table("callRoutingProposals")
        .index("by_org_revision", (query) =>
          query
            .eq("organizationKey", organizationKey)
            .eq("unitRevisionKey", request.sourceUnitRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (route !== null) {
        const updatedAt = yield* Clock.currentTimeMillis;
        yield* writer
          .table("callRoutingProposals")
          .patch(route._id, {
            outcome:
              result.stage === "routed"
                ? "routed"
                : result.stage === "mixed_client_no_route"
                  ? "mixed_client"
                  : "no_match",
            brainKey: result.targetBrainKey,
            candidateBrainKeys: result.targetBrainKey
              ? [result.targetBrainKey]
              : route.candidateBrainKeys,
            reason: `review_${review.action}`,
            status: review.action === "reject" ? "rejected" : "accepted",
            reviewedBy: review.reviewerPrincipalKey,
            updatedAt,
          })
          .pipe(Effect.orDie);
      }
      return result;
    }),
);

export default GroupImpl.make(databaseSchema, classifySourceUnitGroup).pipe(
  Layer.provide(classifySourceUnitImpl),
  Layer.provide(commitSourceRouteImpl),
  GroupImpl.finalize,
);
