import { describe, expect, it } from "vitest";
import { expectDescriptorPassesAndFails } from "./src/check-test-helpers.mts";
import { descriptor } from "./check-posthog-readiness.mts";

describe("check:posthog-readiness", () => {
  it("passes and fails on its declared requirements", async () => {
    await expectDescriptorPassesAndFails(descriptor);
  });

  it("pins the first wrapped mutation to authorized page creation", () => {
    const contract = JSON.stringify(descriptor);
    expect(contract).toContain("brain/pages.create");
    expect(contract).not.toContain("brain/pages.createMarkdown");
  });
});
