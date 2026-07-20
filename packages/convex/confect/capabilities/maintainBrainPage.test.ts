import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  normalizeMaintainBrainPageInput,
  validateMaintainBrainPageInput,
} from "./maintainBrainPage.domain";

const metadata = JSON.parse(
  readFileSync(
    new URL("./maintainBrainPage.headless.json", import.meta.url),
    "utf8",
  ),
) as {
  readonly typedErrors: readonly string[];
  readonly schemas: Readonly<Record<string, string>>;
};

describe("maintainBrainPage generated capability domain", () => {
  it("normalization is idempotent for any input", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (workspaceSlug, input) => {
        const once = normalizeMaintainBrainPageInput({ workspaceSlug, input });
        expect(normalizeMaintainBrainPageInput(once)).toEqual(once);
      }),
    );
  });

  it("rejects blank fields after normalization", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\s*$/), (blank) => {
        const normalized = normalizeMaintainBrainPageInput({
          workspaceSlug: blank,
          input: blank,
        });
        expect(validateMaintainBrainPageInput(normalized)).toHaveLength(2);
      }),
    );
  });

  it("accepts trimmed non-blank input", () => {
    const normalized = normalizeMaintainBrainPageInput({
      workspaceSlug: "  acme-demo  ",
      input: "  summarize the approved sources  ",
    });

    expect(normalized.workspaceSlug).toBe("acme-demo");
    expect(validateMaintainBrainPageInput(normalized)).toEqual([]);
  });

  it("declares the required typed errors", () => {
    expect(metadata.typedErrors).toEqual(
      expect.arrayContaining(["Unauthorized", "ValidationFailed", "Forbidden"]),
    );
    expect(metadata.schemas).toEqual({
      args: "maintainBrainPageArgs",
      returns: "maintainBrainPageReturns",
    });
  });
});
