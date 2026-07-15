import { describe, expect, it } from "vitest";

import { createRuntimeWorkspaceOperations } from "./workspace-operations";

describe("runtime workspace operations", () => {
  it("fails closed for signed-out live/production auth instead of granting demo owner tenancy", async () => {
    const operations = createRuntimeWorkspaceOperations({
      authSnapshot: { status: "signedOut" },
      mode: "live",
    });

    await expect(operations.loadWorkspaces()).rejects.toThrow(
      "Live workspace operations require authorized Confect workspace refs.",
    );
  });

  it("uses fake owner tenancy only for explicit fake/local/build-safe mode", async () => {
    const operations = createRuntimeWorkspaceOperations({
      authSnapshot: { status: "signedOut" },
      mode: "fake",
    });

    await expect(operations.loadWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        role: "owner",
        workspaceId: "workspace_template_demo",
      }),
    ]);
  });
});
