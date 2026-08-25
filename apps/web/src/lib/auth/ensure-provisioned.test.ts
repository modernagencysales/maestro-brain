import { describe, expect, it } from "vitest";

import {
  hasLegacyUppercaseWorkspaceSlug,
  sessionEmailArgs,
} from "./ensure-provisioned";

describe("authenticated provisioning boundary", () => {
  it("passes through a WorkOS session email when available", () => {
    expect(sessionEmailArgs({ email: "person@example.com" })).toEqual({
      sessionEmail: "person@example.com",
    });
    expect(sessionEmailArgs({ id: "user_1" })).toEqual({});
  });

  it("recognizes legacy uppercase workspace URLs without rewriting arbitrary paths", () => {
    expect(hasLegacyUppercaseWorkspaceSlug("/tim-keen-5P0Y50P2")).toBe(true);
    expect(hasLegacyUppercaseWorkspaceSlug("/tim-keen-5P0Y50P2/settings")).toBe(
      true,
    );
    expect(hasLegacyUppercaseWorkspaceSlug("/tim-keen-5p0y50p2")).toBe(false);
    expect(hasLegacyUppercaseWorkspaceSlug("/getting-started")).toBe(false);
  });
});
