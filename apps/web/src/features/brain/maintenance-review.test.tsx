import { describe, expect, it } from "vitest";

import {
  buildMaintenanceReviewModel,
  describeMaintenanceProposal,
  type MaintenanceReviewProposal,
} from "./maintenance-review";

const revisionProposal: MaintenanceReviewProposal = {
  proposalKey: "maint_1",
  pageTitle: "Client Brief",
  status: "awaiting_review",
  citationKeys: ["cite_1"],
  routeGeneration: 4,
  lifecycleGeneration: 8,
  policyGeneration: 2,
  expectedRevisionKey: "rev_1",
  autopilotEligible: false,
  markdownPreview: "# Client Brief\nACME shifted to enterprise onboarding.",
};

describe("maintenance review model", () => {
  it("renders cited review-first proposals with admin-only autopilot controls", () => {
    expect(
      buildMaintenanceReviewModel({
        proposals: [revisionProposal],
        viewerRole: "editor",
      }),
    ).toEqual(
      expect.objectContaining({
        heading: "Brain maintenance review",
        autopilotControl: "hidden",
        proposals: [
          expect.objectContaining({
            citationLabel: "1 citation",
            actionLabel: "Review required",
          }),
        ],
      }),
    );

    expect(
      buildMaintenanceReviewModel({
        proposals: [revisionProposal],
        viewerRole: "admin",
      }).autopilotControl,
    ).toBe("review_first_locked");
  });

  it("surfaces no-op, published, stale, and uncited states for reviewers", () => {
    expect(
      describeMaintenanceProposal({
        ...revisionProposal,
        status: "proposed_noop",
      }),
    ).toEqual(expect.objectContaining({ actionLabel: "Accept no-op" }));

    expect(
      describeMaintenanceProposal({ ...revisionProposal, status: "published" }),
    ).toEqual(expect.objectContaining({ actionLabel: "Published" }));

    expect(
      describeMaintenanceProposal({
        ...revisionProposal,
        citationKeys: [],
      }),
    ).toEqual(expect.objectContaining({ blockedReason: "CitationRequired" }));

    expect(
      describeMaintenanceProposal({
        ...revisionProposal,
        currentRevisionKey: "rev_2",
      }),
    ).toEqual(expect.objectContaining({ blockedReason: "StaleRevision" }));
  });
});
