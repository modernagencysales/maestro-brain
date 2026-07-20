import {
  assertAutopilotEligible,
  MaintenancePolicyError,
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
    "accepted_noop" | "awaiting_review" | "published"
  >;
  readonly revisionEffect: null | {
    readonly pageKey: string;
    readonly expectedRevisionKey: string;
    readonly markdown: string;
    readonly citationKeys: readonly string[];
  };
};

const assertFresh = (
  context: MaintenanceContextPack,
  proposal: MaintenanceProposal,
): void => {
  if (
    context.currentRevisionKey !== proposal.expectedRevisionKey ||
    context.routeGeneration !== proposal.routeGeneration ||
    context.lifecycleGeneration !== proposal.lifecycleGeneration ||
    context.policyGeneration !== proposal.policyGeneration
  ) {
    throw new MaintenancePolicyError("StaleRevision");
  }
};

export const commitMaintenanceProposal = ({
  context,
  proposal,
  autopilot = reviewFirstPolicy,
}: {
  readonly context: MaintenanceContextPack;
  readonly proposal: MaintenanceProposal;
  readonly autopilot?: AutopilotPolicy;
}): MaintenanceCommitResult => {
  assertFresh(context, proposal);

  if (proposal.status === "proposed_noop") {
    return {
      proposalKey: proposal.proposalKey,
      status: "accepted_noop",
      revisionEffect: null,
    };
  }

  if (autopilot.mode !== "autopilot") {
    return {
      proposalKey: proposal.proposalKey,
      status: "awaiting_review",
      revisionEffect: null,
    };
  }

  assertAutopilotEligible(context, autopilot);
  return {
    proposalKey: proposal.proposalKey,
    status: "published",
    revisionEffect: {
      pageKey: proposal.pageKey,
      expectedRevisionKey: proposal.expectedRevisionKey,
      markdown: proposal.markdown ?? "",
      citationKeys: proposal.citationKeys,
    },
  };
};
