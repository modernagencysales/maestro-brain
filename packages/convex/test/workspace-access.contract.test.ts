import { describe, expect, it } from "vitest";

import { manifest } from "../confect/brain/pages.spec";

describe("workspace access resolver through brain pages", () => {
  it("keeps page access server-derived and web-only", () => {
    expect(manifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: "brain.pages.create",
          surfaces: ["web"],
          typedErrors: expect.arrayContaining([
            "Unauthorized",
            "Forbidden",
            "BrainNotFound",
            "LifecycleRevoked",
          ]),
        }),
      ]),
    );
    expect(JSON.stringify(manifest)).not.toContain("workspaceId");
    expect(JSON.stringify(manifest)).not.toContain("createMarkdown");
  });
});
