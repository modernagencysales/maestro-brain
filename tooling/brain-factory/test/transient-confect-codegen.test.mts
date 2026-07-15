import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runRtk } from "../src/process.js";
import {
  generatedConfectDeltaIssues,
  runTransientConfectCodegen,
  safeFocusedTestPattern,
  sameGeneratedFileSet,
} from "../src/transient-confect-codegen.js";

const git = (root: string, ...args: string[]): string =>
  runRtk(["proxy", "git", ...args], { cwd: root, quiet: true });

const fixture = (): { readonly root: string; readonly source: string } => {
  const root = mkdtempSync(join(tmpdir(), "brain-transient-codegen-test-"));
  const source = "export const fixture = true;\n";
  mkdirSync(join(root, "packages/convex/confect/_generated"), {
    recursive: true,
  });
  mkdirSync(join(root, "packages/convex/convex"), { recursive: true });
  mkdirSync(join(root, "packages/template-core/src/generated"), {
    recursive: true,
  });
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  writeFileSync(join(root, "packages/convex/confect/source.ts"), source);
  writeFileSync(
    join(root, "packages/convex/confect/_generated/schema.ts"),
    "export const schema = 1;\n",
  );
  writeFileSync(
    join(root, "packages/convex/convex/schema.ts"),
    "export { schema } from '../confect/_generated/schema';\n",
  );
  writeFileSync(
    join(root, "packages/template-core/src/generated/confectManifest.ts"),
    "export const manifest = 1;\n",
  );
  git(root, "init");
  git(root, "config", "core.hooksPath", "/dev/null");
  git(root, "config", "user.email", "factory@example.test");
  git(root, "config", "user.name", "Factory Test");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
  return { root, source };
};

describe("transient Confect codegen", () => {
  it("accepts only Confect-owned generated surfaces", () => {
    expect(
      generatedConfectDeltaIssues([
        "packages/convex/confect/_generated/schema.ts",
        "packages/convex/convex/internal/migrations.ts",
        "packages/convex/convex/schema.ts",
        "packages/template-core/src/generated/confectManifest.ts",
      ]),
    ).toEqual([]);
  });

  it("rejects hand-authored and reserved generated-directory drift", () => {
    expect(
      generatedConfectDeltaIssues([
        "packages/convex/confect/internal/migrations.ts",
        "packages/convex/convex/auth.config.ts",
        "packages/convex/convex/convex.config.ts",
        "packages/convex/convex/http.ts",
        "packages/convex/convex/tsconfig.json",
        "packages/template-core/src/generated/not-confect.ts",
      ]),
    ).toEqual([
      "packages/convex/confect/internal/migrations.ts",
      "packages/convex/convex/auth.config.ts",
      "packages/convex/convex/convex.config.ts",
      "packages/convex/convex/http.ts",
      "packages/convex/convex/tsconfig.json",
      "packages/template-core/src/generated/not-confect.ts",
    ]);
  });

  it("binds freshness to the same staged generated delta", () => {
    expect(sameGeneratedFileSet(["b.ts", "a.ts"], ["a.ts", "b.ts"])).toBe(true);
    expect(sameGeneratedFileSet(["a.ts"], ["a.ts", "b.ts"])).toBe(false);
  });

  it("allows only shell-free focused test patterns", () => {
    expect(safeFocusedTestPattern("migrations")).toBe(true);
    expect(safeFocusedTestPattern("brain-pages.contract")).toBe(true);
    expect(safeFocusedTestPattern("../../outside")).toBe(false);
    expect(safeFocusedTestPattern("migrations;rm")).toBe(false);
  });

  it("uses a disposable worktree and never mutates the source checkout", () => {
    const value = fixture();
    let disposableWorktree = "";
    try {
      const generated = runTransientConfectCodegen({
        root: value.root,
        testPattern: "migrations",
        hooks: {
          hydrate: (root, workdir) => {
            expect(root).toBe(value.root);
            disposableWorktree = workdir;
            expect(existsSync(workdir)).toBe(true);
          },
          generate: (workdir) => {
            writeFileSync(
              join(workdir, "packages/convex/confect/_generated/schema.ts"),
              "export const schema = 2;\n",
            );
            writeFileSync(
              join(
                workdir,
                "packages/template-core/src/generated/confectManifest.ts",
              ),
              "export const manifest = 2;\n",
            );
          },
          validate: (_workdir, testPattern) => {
            expect(testPattern).toBe("migrations");
          },
        },
      });
      expect(generated).toEqual([
        "packages/convex/confect/_generated/schema.ts",
        "packages/template-core/src/generated/confectManifest.ts",
      ]);
      expect(
        readFileSync(
          join(value.root, "packages/convex/confect/source.ts"),
          "utf8",
        ),
      ).toBe(value.source);
      expect(git(value.root, "status", "--porcelain")).toBe("");
      expect(git(value.root, "worktree", "list", "--porcelain")).not.toContain(
        disposableWorktree,
      );
      expect(existsSync(disposableWorktree)).toBe(false);
    } finally {
      rmSync(value.root, { force: true, recursive: true });
    }
  });

  it("binds staged content and removes a failed disposable worktree", () => {
    const value = fixture();
    let disposableWorktree = "";
    try {
      expect(() =>
        runTransientConfectCodegen({
          root: value.root,
          hooks: {
            hydrate: (_root, workdir) => {
              disposableWorktree = workdir;
            },
            generate: (workdir) => {
              writeFileSync(
                join(workdir, "packages/convex/confect/_generated/schema.ts"),
                "export const schema = 2;\n",
              );
            },
            validate: (workdir) => {
              writeFileSync(
                join(workdir, "packages/convex/confect/_generated/schema.ts"),
                "export const schema = 3;\n",
              );
              git(
                workdir,
                "add",
                "packages/convex/confect/_generated/schema.ts",
              );
            },
          },
        }),
      ).toThrow("freshness check changed the staged generated patch");
      expect(git(value.root, "status", "--porcelain")).toBe("");
      expect(git(value.root, "worktree", "list", "--porcelain")).not.toContain(
        disposableWorktree,
      );
      expect(existsSync(disposableWorktree)).toBe(false);
    } finally {
      rmSync(value.root, { force: true, recursive: true });
    }
  });
});
