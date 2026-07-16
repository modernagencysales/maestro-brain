import { describe, expect, it } from "vitest";
import {
  expectDescriptorPassesAndFails,
  withTempRepo,
} from "./src/check-test-helpers.mts";
import { evaluateStaticCheck } from "./src/gate.mts";
import {
  ambientDateNow,
  brainPagesStableContract,
  descriptor,
  plainConvexValueImports,
  publicSpecMissingError,
  requiredGeneratedFilesMissing,
} from "./check-confect-contracts.mts";

describe("check:confect-contracts", () => {
  it("passes and fails on its declared requirements", async () => {
    await expectDescriptorPassesAndFails(descriptor);
  });

  it("pins stable page contract shape instead of legacy workspace errors", async () => {
    const pageRequirement = descriptor.requirements.find(
      (requirement) =>
        requirement.file === "packages/convex/confect/brain/pages.spec.ts",
    );
    expect(pageRequirement?.includes).toEqual(
      expect.arrayContaining([
        "FunctionSpec.publicQuery",
        "FunctionSpec.publicMutation",
        "Schema.Struct",
        "error:",
        "GroupSpec.make",
        ".addFunction",
      ]),
    );
    expect(pageRequirement?.includes).not.toContain("WorkspaceNotFound");
    expect(pageRequirement?.includes).not.toContain("brainPages.Doc");

    const files = Object.fromEntries(
      descriptor.requirements.map((requirement) => [
        requirement.file,
        (requirement.includes ?? []).join("\n"),
      ]),
    );
    await withTempRepo(files, async (repo) => {
      await expect(
        evaluateStaticCheck(repo, descriptor),
      ).resolves.toMatchObject({
        ok: true,
      });
    });
  });

  it("requires stable page errors, operation template, and exact declarations", () => {
    expect(brainPagesStableContract("const legacy = true;")).toBeUndefined();
    expect(brainPagesStableContract("const BrainKey = true;")).toContain(
      "BrainNotFound",
    );
    expect(
      brainPagesStableContract(`
        const BrainKey = true;
        const errors = [BrainNotFound, PageNotFound];
        const operation = { operationId: \`brain.pages.\${name}\` };
        definePageQuery("list", ListArgs, ListReturns);
        definePageQuery("get", GetArgs, PageDetail);
        definePageMutation("create", CreateArgs);
        definePageMutation("rename", RenameArgs);
        definePageMutation("move", MoveArgs);
        definePageMutation("favorite", FavoriteArgs);
        definePageMutation("archive", ArchiveArgs);
      `),
    ).toBeUndefined();
    expect(
      brainPagesStableContract(`
        const BrainKey = true;
        const errors = [BrainNotFound, PageNotFound];
        const operation = { operationId: \`brain.pages.\${name}\` };
        definePageQuery("list", ListArgs, ListReturns);
        definePageQuery("get", GetArgs, PageDetail);
        definePageMutation("create", CreateArgs);
        definePageMutation("rename", RenameArgs);
        definePageMutation("move", MoveArgs);
        definePageMutation("favorite", FavoriteArgs);
        definePageMutation("archive", ArchiveArgs);
        definePageMutation("createMarkdown", LegacyArgs);
      `),
    ).toContain("no createMarkdown");
    expect(
      brainPagesStableContract(`
        const BrainKey = true;
        const errors = [BrainNotFound, PageNotFound];
        const operation = { operationId: \`brain.pages.\${name}\` };
        definePageQuery("list", ListArgs, ListReturns);
        definePageQuery("get", GetArgs, PageDetail);
        definePageMutation("create", CreateArgs);
        definePageMutation("rename", RenameArgs);
        definePageMutation("move", MoveArgs);
        definePageMutation("favorite", FavoriteArgs);
      `),
    ).toContain("brain.pages.archive");
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
