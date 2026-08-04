import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReviewQueue } from "./review-queue";

describe("ReviewQueue", () => {
  const item = {
    sourceKey: "src_1",
    title: "Positioning note",
    submittedAt: 0,
    status: "pending_review" as const,
    route: null,
  };

  it("shows age, status, and an explicit no-route value", () => {
    const html = renderToStaticMarkup(
      <ReviewQueue
        nowMs={120_000}
        role="admin"
        state={{ status: "ready", items: [item] }}
        onDecision={vi.fn()}
      />,
    );
    expect(html).toContain("2 minutes old");
    expect(html).toContain("pending_review");
    expect(html).toContain("not routed");
  });

  it("disables decisions for viewers", () => {
    const html = renderToStaticMarkup(
      <ReviewQueue
        nowMs={1}
        role="viewer"
        state={{ status: "ready", items: [item] }}
        onDecision={vi.fn()}
      />,
    );
    expect((html.match(/disabled/g) ?? []).length).toBe(2);
  });

  it("renders empty and failure states", () => {
    expect(
      renderToStaticMarkup(
        <ReviewQueue
          nowMs={0}
          role="admin"
          state={{ status: "empty", items: [] }}
        />,
      ),
    ).toContain("No pending");
    expect(
      renderToStaticMarkup(
        <ReviewQueue
          nowMs={0}
          role="admin"
          state={{ status: "failure", message: "offline" }}
        />,
      ),
    ).toContain("offline");
  });
});
