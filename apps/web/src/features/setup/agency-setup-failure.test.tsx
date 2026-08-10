import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgencySetupFailure } from "./agency-setup-failure";

describe("Agency setup failure", () => {
  it("offers retry and sign out after a provider failure", () => {
    const html = renderToStaticMarkup(
      <AgencySetupFailure reason="provider_failure" />,
    );

    expect(html).toContain("Agency setup couldn&#x27;t finish");
    expect(html).toContain("Retry setup");
    expect(html).toContain('href="/logout"');
    expect(html).toContain(">Sign out</a>");
    expect(html).toContain('role="alert"');
    expect(html).toContain("<main");
    expect(html).toContain('tabindex="-1"');
  });

  it("fails closed for an account with existing organization access", () => {
    const html = renderToStaticMarkup(
      <AgencySetupFailure reason="existing_membership" />,
    );

    expect(html).toContain("This account already has organization access");
    expect(html).toContain(">Sign out</a>");
    expect(html).not.toContain("Retry setup");
  });

  it("tells an unverified user how to continue", () => {
    const html = renderToStaticMarkup(
      <AgencySetupFailure reason="identity_unverified" />,
    );

    expect(html).toContain("Verify your email to finish setup");
    expect(html).toContain("Retry setup");
    expect(html).toContain(">Sign out</a>");
  });
});
