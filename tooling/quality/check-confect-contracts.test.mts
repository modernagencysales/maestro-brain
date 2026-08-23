import { describe, expect, it } from "vitest";
import { expectDescriptorPassesAndFails } from "./src/check-test-helpers.mts";
import {
  ambientDateNow,
  descriptor,
  plainConvexValueImports,
  publicSpecMissingError,
  requiredGeneratedFilesMissing,
} from "./check-confect-contracts.mts";

describe("check:confect-contracts", () => {
  it("passes and fails on its declared requirements", async () => {
    await expectDescriptorPassesAndFails(descriptor);
  });

  it("rejects public specs without declared typed errors", () => {
    expect(
      publicSpecMissingError(
        "const run = FunctionSpec.publicMutation({ name: 'run' });",
      ),
    ).toContain("typed error");
    expect(
      publicSpecMissingError(
        "const run = FunctionSpec.publicAction({ name: 'run' });",
      ),
    ).toContain("typed error");
    expect(
      publicSpecMissingError(
        "const run = FunctionSpec.publicNodeAction({ name: 'run' });",
      ),
    ).toContain("typed error");
  });

  it("allows public specs with declared typed errors", () => {
    expect(
      publicSpecMissingError(
        "const run = FunctionSpec.publicQuery({ name: 'run', error: () => RunError });",
      ),
    ).toBeUndefined();
  });

  it("rejects public specs with error text only in strings or comments", () => {
    expect(
      publicSpecMissingError(
        `const run = FunctionSpec.publicQuery({
          name: 'run',
          description: "error:",
        });`,
      ),
    ).toContain("typed error");
    expect(
      publicSpecMissingError(
        `const run = FunctionSpec.publicQuery({
          name: 'run',
          /* error: */
        });`,
      ),
    ).toContain("typed error");
  });

  it("rejects ambient time in impls", () => {
    expect(ambientDateNow("const now = Date.now();")).toContain("Date.now");
  });

  it("rejects non-type convex value imports in specs", () => {
    expect(
      plainConvexValueImports(
        'import { mutationGeneric, type GenericCtx } from "convex/server";',
      ),
    ).toContain("type-only");
    expect(
      plainConvexValueImports(
        'import type { MutationCtx } from "convex/server";',
      ),
    ).toBeUndefined();
  });

  it("requires generated Confect refs, spec, and manifest files", () => {
    expect(
      requiredGeneratedFilesMissing(
        new Set(["packages/convex/confect/_generated/refs.ts"]),
      ).join("\n"),
    ).toContain("generated");
    expect(
      requiredGeneratedFilesMissing(
        new Set([
          "packages/convex/confect/_generated/refs.ts",
          "packages/convex/confect/_generated/spec.ts",
          "packages/template-core/src/generated/confectManifest.ts",
        ]),
      ),
    ).toEqual([]);
  });
});
