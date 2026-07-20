import * as React from "react";

export type MaintenanceReviewStatus =
  | "proposed_noop"
  | "awaiting_review"
  | "published"
  | "edited_and_published"
  | "rejected"
  | "revoked"
  | "superseded";

export type MaintenanceViewerRole = "viewer" | "editor" | "admin" | "owner";

export type MaintenanceReviewProposal = {
  readonly proposalKey: string;
  readonly pageTitle: string;
  readonly status: MaintenanceReviewStatus;
  readonly citationKeys: readonly string[];
  readonly routeGeneration: number;
  readonly lifecycleGeneration: number;
  readonly policyGeneration: number;
  readonly expectedRevisionKey: string;
  readonly currentRevisionKey?: string;
  readonly autopilotEligible: boolean;
  readonly markdownPreview?: string;
};

export type MaintenanceProposalView = MaintenanceReviewProposal & {
  readonly citationLabel: string;
  readonly actionLabel: string;
  readonly blockedReason: null | "CitationRequired" | "StaleRevision";
};

export type MaintenanceReviewModel = {
  readonly heading: "Brain maintenance review";
  readonly autopilotControl: "hidden" | "review_first_locked" | "eligible";
  readonly proposals: readonly MaintenanceProposalView[];
};

const actionLabelFor = (status: MaintenanceReviewStatus): string => {
  switch (status) {
    case "proposed_noop":
      return "Accept no-op";
    case "awaiting_review":
      return "Review required";
    case "published":
    case "edited_and_published":
      return "Published";
    case "rejected":
      return "Rejected";
    case "revoked":
      return "Revoked";
    case "superseded":
      return "Superseded";
  }
};

export const describeMaintenanceProposal = (
  proposal: MaintenanceReviewProposal,
): MaintenanceProposalView => {
  const blockedReason =
    proposal.citationKeys.length === 0
      ? "CitationRequired"
      : proposal.currentRevisionKey !== undefined &&
          proposal.currentRevisionKey !== proposal.expectedRevisionKey
        ? "StaleRevision"
        : null;

  return {
    ...proposal,
    citationLabel:
      proposal.citationKeys.length === 1
        ? "1 citation"
        : `${proposal.citationKeys.length} citations`,
    actionLabel: actionLabelFor(proposal.status),
    blockedReason,
  };
};

const autopilotControlFor = (
  proposals: readonly MaintenanceReviewProposal[],
  viewerRole: MaintenanceViewerRole,
): MaintenanceReviewModel["autopilotControl"] => {
  if (viewerRole !== "admin" && viewerRole !== "owner") return "hidden";
  return proposals.some((proposal) => proposal.autopilotEligible)
    ? "eligible"
    : "review_first_locked";
};

export const buildMaintenanceReviewModel = ({
  proposals,
  viewerRole,
}: {
  readonly proposals: readonly MaintenanceReviewProposal[];
  readonly viewerRole: MaintenanceViewerRole;
}): MaintenanceReviewModel => ({
  heading: "Brain maintenance review",
  autopilotControl: autopilotControlFor(proposals, viewerRole),
  proposals: proposals.map(describeMaintenanceProposal),
});

export function MaintenanceReview({
  model,
}: {
  readonly model: MaintenanceReviewModel;
}) {
  return React.createElement(
    "section",
    { "aria-label": model.heading },
    React.createElement("h2", null, model.heading),
    React.createElement(
      "ul",
      null,
      model.proposals.map((proposal) =>
        React.createElement(
          "li",
          { key: proposal.proposalKey },
          `${proposal.pageTitle}: ${proposal.actionLabel} (${proposal.citationLabel})`,
        ),
      ),
    ),
  );
}
