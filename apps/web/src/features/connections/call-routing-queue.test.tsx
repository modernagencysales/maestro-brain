import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  CallRoutingQueue,
  callRoutingReviewFromFormData,
  type CallRoutingQueueState,
} from "./call-routing-queue";

const item = {
  proposalKey: "callroute_1",
  unitKey: "sunit_1",
  unitRevisionKey: "surev_1",
  title: "Acme weekly",
  sourceUrl: "https://example.test/call_1",
  outcome: "awaiting_review" as const,
  brainKey: null,
  candidateBrainKeys: ["br_acme"],
  reason: "Participant domain matched more than one Brain.",
  routeGeneration: 4,
  sourceLifecycleGeneration: 1,
  createdAt: 1_782_924_800_000,
};

const render = (
  state: CallRoutingQueueState,
  role: "viewer" | "admin" = "admin",
) =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <CallRoutingQueue role={role} state={state} onReview={vi.fn()} />
    </MaestroSaasUiProvider>,
  );

const childrenOf = (element: ReactElement): ReactElement[] =>
  Children.toArray(
    (element.props as { readonly children?: ReactNode }).children,
  ).filter(isValidElement);

describe("CallRoutingQueue", () => {
  it.each([
    [{ status: "loading" as const }, "Loading call routing queue"],
    [{ status: "empty" as const }, "No calls need routing"],
    [
      { status: "failure" as const, message: "Unable to load calls." },
      "Unable to load calls.",
    ],
  ])("renders a bounded queue state", (state, text) => {
    expect(render(state)).toContain(text);
  });

  it("shows source evidence, candidate selection, and explicit actions", () => {
    const html = render({ status: "ready", items: [item] });

    expect(html).toContain("Calls to route");
    expect(html).toContain("Acme weekly");
    expect(html).toContain("https://example.test/call_1");
    expect(html).toContain("br_acme");
    expect(html).toContain("Confirm route");
    expect(html).toContain("Change Brain");
    expect(html).toContain("Mark no route");
    expect(html).toContain("Reject proposal");
  });

  it("keeps viewer controls visible but disabled", () => {
    const html = render({ status: "ready", items: [item] }, "viewer");

    expect(html).toContain("Admin access is required to route calls.");
    expect((html.match(/disabled/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("announces pending, success, and failure mutations", () => {
    expect(
      render({
        status: "ready",
        items: [item],
        mutation: { status: "pending", proposalKey: item.proposalKey },
      }),
    ).toContain("Saving route review");
    expect(
      render({
        status: "ready",
        items: [item],
        mutation: { status: "success", message: "Call routed." },
      }),
    ).toContain("Call routed.");
    expect(
      render({
        status: "ready",
        items: [item],
        mutation: { status: "failure", message: "Unable to route call." },
      }),
    ).toContain("Unable to route call.");
  });

  it("builds the exact backend route decision from native form data", () => {
    const data = new FormData();
    data.set("action", "change_brain");
    data.set("targetBrainKey", "br_acme");
    data.set("learnScope", "domain");
    data.set("learnValue", "acme.com");

    expect(callRoutingReviewFromFormData(item, data)).toMatchObject({
      item,
      action: "change_brain",
      targetBrainKey: "br_acme",
      learnScope: "domain",
      learnValue: "acme.com",
    });

    const onReview = vi.fn();
    const root = CallRoutingQueue({
      role: "admin",
      state: { status: "ready", items: [item] },
      onReview,
    });
    const body = childrenOf(root)[1];
    const stack = body && childrenOf(body)[0];
    const card = stack && childrenOf(stack)[0];
    const cardBody = card && childrenOf(card)[0];
    const form = cardBody && childrenOf(cardBody)[0];
    if (form === undefined) throw new Error("Expected routing form");
    vi.stubGlobal(
      "FormData",
      vi.fn(() => data),
    );
    (
      form.props as {
        readonly onSubmit: (event: unknown) => void;
      }
    ).onSubmit({
      preventDefault: vi.fn(),
      currentTarget: {},
      nativeEvent: { submitter: null },
    });
    vi.unstubAllGlobals();

    expect(onReview).toHaveBeenCalledWith(
      expect.objectContaining({ action: "change_brain" }),
    );
  });
});
