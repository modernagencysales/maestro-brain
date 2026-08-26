import { describe, expect, it } from "vitest";

import { buildInvitationUrl } from "../confect/access/invitationUrl";

describe("workspace invitation URL", () => {
  it("targets the deployed Starter acceptance route", () => {
    expect(
      buildInvitationUrl("https://brain.example/ignored", "invitation_123"),
    ).toBe("https://brain.example/accept-invite/invitation_123");
  });
});
