import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workspace settings client", () => {
  it("does not send the public Brain key to internal member or invitation APIs", () => {
    const source = readFileSync(
      new URL("./workspace-settings-client.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("templateConfectRefs.public.access");
    expect(source).not.toContain("createMemberManagementAdapter");
    expect(source).not.toContain("<MemberManagement");
    expect(source).toContain("brainKey: stableBrainKey");
    expect(source).toContain("brainKey: activeBrainKey");
  });
});
