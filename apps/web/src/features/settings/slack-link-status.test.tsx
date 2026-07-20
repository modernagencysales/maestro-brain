import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SlackLinkStatus } from "./slack-link-status";

describe("SlackLinkStatus", () => {
  it("renders exact Slack identity metadata", () => {
    const markup = renderToStaticMarkup(
      <SlackLinkStatus
        view={{
          heading: "Slack identity linked",
          body: ["Slack user: U_requester", "Slack team: T_acme"],
          canLink: true,
        }}
      />,
    );

    expect(markup).toContain("Slack identity linked");
    expect(markup).toContain("Slack user: U_requester");
    expect(markup).toContain("Slack team: T_acme");
    expect(markup).not.toContain("displayName");
    expect(markup).not.toContain("slack-link:");
  });
});
