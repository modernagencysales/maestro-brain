import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SlackLinkButton } from "./slack-link-button";

describe("SlackLinkButton", () => {
  it("renders a disabled safe state when exact linking is unavailable", () => {
    const markup = renderToStaticMarkup(
      <SlackLinkButton canLink={false} status="unlinked" />,
    );

    expect(markup).toContain("Link Slack identity");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("email");
  });

  it("shows active generation metadata without link tokens", () => {
    const markup = renderToStaticMarkup(
      <SlackLinkButton canLink status="active" bindingGeneration={4} />,
    );

    expect(markup).toContain("Relink Slack identity");
    expect(markup).toContain("generation 4");
    expect(markup).not.toContain("slack-link:");
  });
});
