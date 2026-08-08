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
  CallMaintenanceReview,
  callMaintenanceDecisionFromFormData,
  type CallMaintenanceReviewState,
} from "./call-maintenance-review";

const proposal = {
  proposalKey: "brainmaint_1",
  unitRevisionKey: "surev_1",
  sourceTitle: "Acme weekly",
  sourceUrl: "https://example.test/call_1",
  summary: "Acme approved a Friday launch.",
  routeGeneration: 4,
  sourceLifecycleGeneration: 1,
  workspaceLifecycleGeneration: 1,
  createdAt: 1_782_924_800_000,
  items: [
    {
      itemKey: "brainmaintitem_1",
      pageKey: "pag_overview",
      title: "Overview",
      expectedRevisionKey: "rev_overview_1",
      markdown: "# Overview\n\nLaunch Friday.",
      citations: [
        {
          citationKey: "cite_segment_1",
          quote: "Alex owns launch by Friday.",
          speakerLabel: "Alex",
          startMs: 12_000,
          endMs: 15_000,
        },
      ],
    },
  ],
};

const render = (
  state: CallMaintenanceReviewState,
  role: "viewer" | "editor" = "editor",
) =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <CallMaintenanceReview role={role} state={state} onReview={vi.fn()} />
    </MaestroSaasUiProvider>,
  );

const childrenOf = (element: ReactElement): ReactElement[] =>
  Children.toArray(
    (element.props as { readonly children?: ReactNode }).children,
  ).filter(isValidElement);

describe("CallMaintenanceReview", () => {
  it.each([
    [{ status: "loading" as const }, "Loading call updates"],
    [{ status: "empty" as const }, "No call updates need review"],
    [
      { status: "failure" as const, message: "Unable to load call updates." },
      "Unable to load call updates.",
    ],
  ])("renders a bounded review state", (state, text) => {
    expect(render(state)).toContain(text);
  });

  it("shows grouped page changes and timestamped transcript evidence", () => {
    const html = render({ status: "ready", items: [proposal] });

    expect(html).toContain("Call-backed Brain updates");
    expect(html).toContain("Acme approved a Friday launch.");
    expect(html).toContain("Overview");
    expect(html).toContain("Launch Friday.");
    expect(html).toContain("Alex owns launch by Friday.");
    expect(html).toContain("0:12–0:15");
    expect(html).toContain("Accept all changes");
    expect(html).toContain("Publish edited changes");
    expect(html).toContain("Reject all changes");
  });

  it("announces a settled mutation after the queue becomes empty", () => {
    const success = render({
      status: "settled",
      outcome: "success",
      message: "Call updates published.",
    });
    const failure = render({
      status: "settled",
      outcome: "failure",
      message: "Unable to publish call updates.",
    });

    expect(success).toContain("No call updates need review.");
    expect(success).toContain('role="status"');
    expect(success).toContain("Call updates published.");
    expect(failure).toContain('role="alert"');
    expect(failure).toContain("Unable to publish call updates.");
  });

  it("keeps viewer controls visible but disabled", () => {
    const html = render({ status: "ready", items: [proposal] }, "viewer");

    expect(html).toContain("Editor access is required to review call updates.");
    expect((html.match(/disabled/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("announces pending, success, and failure mutations", () => {
    expect(
      render({
        status: "ready",
        items: [proposal],
        mutation: { status: "pending", proposalKey: proposal.proposalKey },
      }),
    ).toContain("Publishing call updates");
    expect(
      render({
        status: "ready",
        items: [proposal],
        mutation: { status: "success", message: "Call updates published." },
      }),
    ).toContain("Call updates published.");
    expect(
      render({
        status: "ready",
        items: [proposal],
        mutation: {
          status: "failure",
          message: "Unable to publish call updates.",
        },
      }),
    ).toContain("Unable to publish call updates.");
  });

  it("builds edited publication input from native form data", () => {
    const data = new FormData();
    data.set("action", "edit");
    data.set("brainmaintitem_1", "# Overview\n\nLaunch Monday.");

    expect(callMaintenanceDecisionFromFormData(proposal, data)).toEqual({
      proposal,
      action: "edit",
      edits: [
        {
          itemKey: "brainmaintitem_1",
          markdown: "# Overview\n\nLaunch Monday.",
        },
      ],
    });

    const onReview = vi.fn();
    const root = CallMaintenanceReview({
      role: "editor",
      state: { status: "ready", items: [proposal] },
      onReview,
    });
    const body = childrenOf(root)[1];
    const stack = body && childrenOf(body)[0];
    const card = stack && childrenOf(stack)[0];
    const cardBody = card && childrenOf(card)[0];
    const form = cardBody && childrenOf(cardBody)[0];
    if (form === undefined) throw new Error("Expected maintenance form");
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
      expect.objectContaining({ action: "edit" }),
    );
  });
});
