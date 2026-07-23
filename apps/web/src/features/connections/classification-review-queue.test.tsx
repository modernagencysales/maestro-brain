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
    channelName: "#support",
    state: "proposed_one",
    proposedBrainName: "Acme Support",
    confidence: 0.99,
    evidenceQuotes: ["Please route this onboarding question to Acme Support."],
  },
  {
    decisionKey: "decision_2",
    channelName: "#partners",
    state: "proposed_mixed",
    proposedBrainName: null,
    confidence: 0.2,
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
