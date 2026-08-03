import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Unauthorized } from "../errors";
import { commitReviewedClassification } from "../classification/commit";
import { validateClassificationProposal } from "../classification/request";
import { reviewClassificationDecision } from "../classification/review";
import databaseSchema from "../_generated/schema";
import { classifySourceUnitLocally } from "./classifySourceUnit.domain";
import classifySourceUnitGroup from "./classifySourceUnit.spec";

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
      return classifySourceUnitLocally(request);
    }),
);

const commitSourceRouteImpl = FunctionImpl.make(
  databaseSchema,
  classifySourceUnitGroup,
  "commitSourceRoute",
  ({ workspaceId, request, output, review, currentAuthority, caller }) =>
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
      return commitReviewedClassification(reviewed, {
        expectedPolicyVersion: currentAuthority.policyVersion,
        expectedSourceUnitHash: request.sourceUnitHash,
        expectedLifecycleGeneration: currentAuthority.lifecycleGeneration,
        expectedRouteGeneration: currentAuthority.routeGeneration,
        expectedLeaseGeneration: currentAuthority.leaseGeneration,
        existingRouteEffectKeys: new Set(
          currentAuthority.existingRouteEffectKeys ?? [],
        ),
      });
    }),
);

export default GroupImpl.make(databaseSchema, classifySourceUnitGroup).pipe(
  Layer.provide(classifySourceUnitImpl),
  Layer.provide(commitSourceRouteImpl),
  GroupImpl.finalize,
);
