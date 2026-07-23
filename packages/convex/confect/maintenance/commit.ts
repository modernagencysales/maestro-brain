import {
  assertAutopilotEligible,
  MaintenancePolicyError,
  requireActiveLifecycle,
  reviewFirstPolicy,
  type AutopilotPolicy,
  type MaintenanceContextPack,
  type MaintenanceProposalStatus,
} from "./policy";
import type { MaintenanceProposal } from "./request";

export type MaintenanceCommitResult = {
  readonly proposalKey: string;
  readonly status: Extract<
    MaintenanceProposalStatus,
    | "accepted_noop"
    | "awaiting_review"
    | "published"
    | "edited_and_published"
    | "rejected"
  >;
  readonly revisionEffect: null | {
    readonly pageKey: string;
    readonly expectedRevisionKey: string;
    readonly markdown: string;
    readonly citationKeys: readonly string[];
    readonly reviewedBy?: string;
  };
};

const assertFresh = (
  context: MaintenanceContextPack,
  proposal: MaintenanceProposal,
): void => {
  if (
    context.workspaceId !== proposal.workspaceId ||
    context.brainKey !== proposal.brainKey ||
    context.pageKey !== proposal.pageKey ||
    context.currentRevisionKey !== proposal.expectedRevisionKey ||
    context.routeGeneration !== proposal.routeGeneration ||
    context.lifecycleGeneration !== proposal.lifecycleGeneration ||
    context.policyGeneration !== proposal.policyGeneration
  ) {
    throw new MaintenancePolicyError("StaleRevision");
  }
};

export type MaintenanceReviewDecision =
  | {
      readonly action: "accept";
      readonly reviewerId: string;
      readonly attemptKey: string;
    }
  | {
      readonly action: "edit";
      readonly reviewerId: string;
      readonly attemptKey: string;
      readonly markdown: string;
    }
  | {
      readonly action: "reject";
      readonly reviewerId: string;
      readonly attemptKey: string;
    };

const revisionEffectFor = (
  proposal: MaintenanceProposal,
  markdown: string,
  reviewedBy?: string,
): NonNullable<MaintenanceCommitResult["revisionEffect"]> => ({
  pageKey: proposal.pageKey,
  expectedRevisionKey: proposal.expectedRevisionKey,
  markdown,
  citationKeys: proposal.citationKeys,
  ...(reviewedBy ? { reviewedBy } : {}),
});

export const commitMaintenanceProposal = ({
  context,
  proposal,
  autopilot = reviewFirstPolicy,
  review,
  seenAttemptKeys = [],
}: {
  readonly context: MaintenanceContextPack;
  readonly proposal: MaintenanceProposal;
  readonly autopilot?: AutopilotPolicy;
  readonly review?: MaintenanceReviewDecision;
  readonly seenAttemptKeys?: readonly string[];
}): MaintenanceCommitResult => {
  requireActiveLifecycle(context);
  assertFresh(context, proposal);
  if (review && seenAttemptKeys.includes(review.attemptKey))
    throw new MaintenancePolicyError("StaleRevision");
  if (proposal.status === "proposed_noop")
    return {
      proposalKey: proposal.proposalKey,
      status: "accepted_noop",
      revisionEffect: null,
    };
  if (review?.action === "reject")
    return {
      proposalKey: proposal.proposalKey,
      status: "rejected",
      revisionEffect: null,
    };
  if (review?.action === "edit")
    return {
      proposalKey: proposal.proposalKey,
      status: "edited_and_published",
      revisionEffect: revisionEffectFor(
        proposal,
        review.markdown,
        review.reviewerId,
      ),
    };
  if (review?.action === "accept")
    return {
      proposalKey: proposal.proposalKey,
      status: "published",
      revisionEffect: revisionEffectFor(
        proposal,
        proposal.markdown ?? "",
        review.reviewerId,
      ),
    };
  if (
    autopilot.mode !== "autopilot" ||
    !autopilot.adminEnabled ||
    context.modelPromptPair !== proposal.modelPromptPair
  )
    return {
      proposalKey: proposal.proposalKey,
      status: "awaiting_review",
      revisionEffect: null,
    };
  assertAutopilotEligible(context, autopilot);
  return {
    proposalKey: proposal.proposalKey,
    status: "published",
    revisionEffect: revisionEffectFor(proposal, proposal.markdown ?? ""),
  };
};
