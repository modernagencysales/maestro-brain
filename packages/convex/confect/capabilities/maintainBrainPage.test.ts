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
        const once = normalizeMaintainBrainPageInput({
          workspaceSlug,
          contextPackId: input,
        });
        expect(normalizeMaintainBrainPageInput(once)).toEqual(once);
      }),
    );
  });

  it("rejects blank fields after normalization", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\s*$/), (blank) => {
        const normalized = normalizeMaintainBrainPageInput({
          workspaceSlug: blank,
          contextPackId: blank,
        });
        expect(validateMaintainBrainPageInput(normalized)).toHaveLength(2);
      }),
    );
  });

  it("accepts trimmed non-blank context pack input", () => {
    const normalized = normalizeMaintainBrainPageInput({
      workspaceSlug: "  acme-demo  ",
      contextPackId: "  ctx_approved_sources  ",
    });

    expect(normalized.workspaceSlug).toBe("acme-demo");
    expect(normalized.contextPackId).toBe("ctx_approved_sources");
    expect(validateMaintainBrainPageInput(normalized)).toEqual([]);
  });

  it("declares the required typed errors", () => {
    expect(metadata.typedErrors).toEqual(
      expect.arrayContaining([
        "Unauthorized",
        "ValidationFailed",
        "Forbidden",
        "CitationRequired",
        "CitationNotInManifest",
        "RevisionBudgetExceeded",
        "AutopilotNotEligible",
        "StaleRevision",
        "LifecycleRevoked",
      ]),
    );
    expect(metadata.schemas).toEqual({
      args: "maintainBrainPageArgs",
      returns: "maintainBrainPageReturns",
    });
  });
});
