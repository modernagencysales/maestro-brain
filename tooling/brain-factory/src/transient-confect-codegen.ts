import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { hydrateWorktreeDependencies } from "./dependencies.js";
import { runRtk } from "./process.js";

const CONVEX_GENERATED_ROOT = "packages/convex/convex/";
const CONFECT_MANIFEST =
  "packages/template-core/src/generated/confectManifest.ts";
const RESERVED_CONVEX_FILES = new Set([
  "packages/convex/convex/auth.config.ts",
  "packages/convex/convex/convex.config.ts",
  "packages/convex/convex/http.ts",
  "packages/convex/convex/tsconfig.json",
]);

export const generatedConfectDeltaIssues = (
  files: readonly string[],
): string[] =>
  files.filter(
    (file) =>
      !file.startsWith("packages/convex/confect/_generated/") &&
      file !== CONFECT_MANIFEST &&
      (!file.startsWith(CONVEX_GENERATED_ROOT) ||
        RESERVED_CONVEX_FILES.has(file)),
  );

export const safeFocusedTestPattern = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);

export const sameGeneratedFileSet = (
  expected: readonly string[],
  actual: readonly string[],
): boolean =>
  JSON.stringify([...expected].sort()) === JSON.stringify([...actual].sort());

const patchHash = (patch: string): string =>
  createHash("sha256").update(patch).digest("hex");

const diffFiles = (workdir: string, cached = false): string[] =>
  runRtk(
    ["proxy", "git", "diff", ...(cached ? ["--cached"] : []), "--name-only"],
    {
      cwd: workdir,
      quiet: true,
    },
  )
    .split("\n")
    .filter(Boolean);

const stagedPatchHash = (workdir: string): string =>
  patchHash(
    runRtk(["proxy", "git", "diff", "--cached", "--binary", "--no-ext-diff"], {
      cwd: workdir,
      quiet: true,
    }),
  );

interface TransientConfectCodegenHooks {
  readonly generate: (workdir: string) => void;
  readonly hydrate: (root: string, workdir: string) => void;
  readonly validate: (workdir: string, testPatterns: readonly string[]) => void;
}

const productionHooks: TransientConfectCodegenHooks = {
  generate: (workdir) => {
    runRtk(["pnpm", "--dir", "packages/convex", "confect:codegen"], {
      cwd: workdir,
    });
    runRtk(["pnpm", "confect:manifest"], { cwd: workdir });
  },
  hydrate: (root, workdir) => {
    hydrateWorktreeDependencies(root, workdir);
  },
  validate: (workdir, testPatterns) => {
    runRtk(["pnpm", "--dir", "packages/convex", "check:convex"], {
      cwd: workdir,
    });
    runRtk(
      [
        "host-test-slot",
        "--class",
        "focused",
        "pnpm",
        "--dir",
        "tooling/confect-manifest",
        "test",
      ],
      { cwd: workdir },
    );
    runRtk(["pnpm", "--dir", "tooling/confect-manifest", "typecheck"], {
      cwd: workdir,
    });
    runRtk(["pnpm", "confect:manifest"], { cwd: workdir });
    runRtk(["git", "diff", "--exit-code", CONFECT_MANIFEST], { cwd: workdir });
    runRtk(["pnpm", "--dir", "packages/convex", "typecheck"], {
      cwd: workdir,
    });
    if (testPatterns.length > 0) {
      runRtk(
        [
          "host-test-slot",
          "--class",
          "focused",
          "pnpm",
          "--dir",
          "packages/convex",
          "test",
          ...testPatterns,
        ],
        { cwd: workdir },
      );
    }
  },
};

export const runTransientConfectCodegen = (input: {
  readonly hooks?: TransientConfectCodegenHooks;
  readonly root: string;
  readonly testPatterns?: readonly string[];
}): readonly string[] => {
  const root = resolve(input.root);
  const testPatterns = input.testPatterns ?? [];
  const unsafeTestPattern = testPatterns.find(
    (testPattern) => !safeFocusedTestPattern(testPattern),
  );
  if (unsafeTestPattern !== undefined) {
    throw new Error(`unsafe focused test pattern ${unsafeTestPattern}`);
  }
  const hooks = input.hooks ?? productionHooks;
  if (
    runRtk(["proxy", "git", "status", "--porcelain"], {
      cwd: root,
      quiet: true,
    }).length > 0
  ) {
    throw new Error("transient Confect codegen requires a clean lane worktree");
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "maestro-confect-codegen-"));
  const workdir = join(temporaryRoot, "worktree");
  let attached = false;
  try {
    runRtk(["git", "worktree", "add", "--detach", workdir, "HEAD"], {
      cwd: root,
    });
    attached = true;
    hooks.hydrate(root, workdir);
    hooks.generate(workdir);
    runRtk(
      [
        "git",
        "add",
        "-N",
        "packages/convex/confect/_generated",
        "packages/convex/convex",
        CONFECT_MANIFEST,
      ],
      { cwd: workdir },
    );
    const generatedFiles = diffFiles(workdir);
    if (generatedFiles.length === 0) {
      throw new Error("Confect source produced no transient generated delta");
    }
    const issues = generatedConfectDeltaIssues(generatedFiles);
    if (issues.length > 0) {
      throw new Error(
        `Confect codegen changed non-generated files: ${issues.join(", ")}`,
      );
    }
    runRtk(
      [
        "git",
        "add",
        "packages/convex/confect/_generated",
        "packages/convex/convex",
        CONFECT_MANIFEST,
      ],
      { cwd: workdir },
    );
    const generatedPatchHash = stagedPatchHash(workdir);
    hooks.validate(workdir, testPatterns);
    runRtk(["git", "diff", "--cached", "--check"], { cwd: workdir });
    if (diffFiles(workdir).length > 0) {
      throw new Error("Confect generated output changed after freshness check");
    }
    if (!sameGeneratedFileSet(generatedFiles, diffFiles(workdir, true))) {
      throw new Error(
        "Confect freshness check changed the staged generated delta",
      );
    }
    if (generatedPatchHash !== stagedPatchHash(workdir)) {
      throw new Error(
        "Confect freshness check changed the staged generated patch",
      );
    }
    return generatedFiles;
  } finally {
    try {
      if (attached) {
        runRtk(["git", "worktree", "remove", "--force", workdir], {
          cwd: root,
        });
      }
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  }
};
