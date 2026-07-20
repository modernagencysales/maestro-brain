import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  ClassificationReviewQueue,
  summarizeClassificationQueue,
  type ClassificationReviewItem,
} from "./classification-review-queue";

const items: readonly ClassificationReviewItem[] = [
  {
    decisionKey: "decision_1",
    sourceUnitRevisionKey: "unit_rev_1",
    channelName: "#support",
    state: "proposed_one",
    contentScope: "single_target",
    proposedBrainName: "Acme Support",
    allowedTargetNames: ["Acme Support", "Acme Sales"],
    confidence: 0.99,
    rationale: "Diagnostic confidence only; admin review is required.",
    evidenceQuotes: ["Please route this onboarding question to Acme Support."],
  },
  {
    decisionKey: "decision_2",
    sourceUnitRevisionKey: "unit_rev_2",
    channelName: "#partners",
    state: "proposed_mixed",
    contentScope: "mixed_client",
    proposedBrainName: null,
    allowedTargetNames: ["Acme Support"],
    confidence: 0.2,
    rationale: "Mentions multiple clients.",
    evidenceQuotes: ["Acme and Beta both need follow-up."],
  },
];

const render = (queueItems: readonly ClassificationReviewItem[]) =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <ClassificationReviewQueue items={queueItems} />
    </MaestroSaasUiProvider>,
  );

describe("ClassificationReviewQueue", () => {
  it("summarizes review-first proposed zero-or-one decisions", () => {
    expect(summarizeClassificationQueue(items)).toEqual({
      proposedOne: 1,
      proposedZero: 0,
      proposedMixed: 1,
      routeReadyWithoutReview: 0,
    });
  });

  it("renders admin actions without exposing confidence auto-commit", () => {
    const html = render(items);

    expect(html).toContain("Classification review queue");
    expect(html).toContain("Admin review required");
    expect(html).toContain("Acme Support");
    expect(html).toContain("No route");
    expect(html).toContain("Mixed client — no route in V1");
    expect(html).not.toContain("Auto-commit");
  });

  it("renders the empty state", () => {
    expect(render([])).toContain("No classification proposals awaiting review");
  });
});
