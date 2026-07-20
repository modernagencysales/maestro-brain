import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hydrateChangedIntegrationDependencies,
  hydrateWorktreeDependencies,
  isWorkspaceDependencyInput,
} from "../src/dependencies.js";
import { runRtk } from "../src/process.js";

const temporaryDirectories: string[] = [];
const sourceRefState = (root: string, head: string) => {
  const headRef = runRtk(
    ["proxy", "git", "rev-parse", "--symbolic-full-name", "HEAD"],
    { cwd: root, quiet: true },
  );
  return headRef === "HEAD"
    ? `HEAD ${head}`
    : runRtk(["proxy", "git", "show-ref", "--verify", headRef], {
        cwd: root,
        quiet: true,
      });
};
const sourceWorktreeState = (root: string) => {
  const rootPath = realpathSync(root);
  const worktrees = runRtk(
    ["proxy", "git", "worktree", "list", "--porcelain"],
    { cwd: root, quiet: true },
  );
  return worktrees
    .split("\n\n")
    .find((entry) => entry.startsWith(`worktree ${rootPath}\n`));
};
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "brain-dependencies-"));
  temporaryDirectories.push(directory);
  const root = resolve(directory, "root");
  const workdir = resolve(directory, "workdir");
  for (const target of [root, workdir]) {
    mkdirSync(resolve(target, "packages/example"), { recursive: true });
    writeFileSync(resolve(target, "package.json"), "{}\n");
    writeFileSync(resolve(target, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      resolve(target, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n',
    );
    writeFileSync(resolve(target, "packages/example/package.json"), "{}\n");
  }
  return { root, workdir };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

describe("root test scheduling", () => {
  it("runs Brain Factory tests only in the serial tooling lane", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const rootPackage = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(rootPackage.scripts.test).toContain(
      "--filter=!@maestro-template/brain-factory-tooling",
    );
    expect(
      rootPackage.scripts["test:tooling"]?.match(
        /pnpm --dir tooling\/brain-factory test/g,
      ) ?? [],
    ).toHaveLength(1);
  });
});

describe("worktree dependency hydration", () => {
  it("resolves lane-consumed private package exports after fresh hydration", () => {
    const directory = mkdtempSync(join(tmpdir(), "brain-dependencies-real-"));
    temporaryDirectories.push(directory);
    const root = resolve(import.meta.dirname, "../../..");
    const workdir = resolve(directory, "worktree");
    const sourceHead = runRtk(["proxy", "git", "rev-parse", "HEAD"], {
      cwd: root,
      quiet: true,
    });
    const sourceRefs = sourceRefState(root, sourceHead);
    const sourceStatus = runRtk(
      ["proxy", "git", "status", "--short", "--untracked-files=all"],
      { cwd: root, quiet: true },
    );
    const sourceWorktrees = sourceWorktreeState(root);

    runRtk(
      [
        "proxy",
        "git",
        "clone",
        "--depth",
        "1",
        "--no-checkout",
        pathToFileURL(root).href,
        workdir,
      ],
      { quiet: true },
    );
    runRtk(["proxy", "git", "checkout", "--detach", sourceHead], {
      cwd: workdir,
      quiet: true,
    });
    try {
      const candidateSha = runRtk(["proxy", "git", "rev-parse", "HEAD"], {
        cwd: workdir,
        quiet: true,
      });
      const sourceCommonDir = runRtk(
        ["proxy", "git", "rev-parse", "--git-common-dir"],
        { cwd: root, quiet: true },
      );
      const cloneCommonDir = runRtk(
        ["proxy", "git", "rev-parse", "--git-common-dir"],
        { cwd: workdir, quiet: true },
      );

      expect(candidateSha).toBe(sourceHead);
      expect(
        realpathSync(resolve(workdir, cloneCommonDir, "objects")),
      ).not.toBe(realpathSync(resolve(root, sourceCommonDir, "objects")));
      expect(
        existsSync(resolve(workdir, cloneCommonDir, "objects/info/alternates")),
      ).toBe(false);
      hydrateWorktreeDependencies(root, workdir);
      for (const packageDirectory of ["ui", "convex", "workflow-ui"])
        expect(
          existsSync(resolve(workdir, "packages", packageDirectory, "dist")),
        ).toBe(false);

      expect(() =>
        runRtk(
          [
            "pnpm",
            "--dir",
            "apps/web",
            "exec",
            "tsx",
            "--eval",
            'Promise.all([import("@maestro-template/ui"), import("@maestro-template/convex/refs"), import("@maestro-template/workflow-ui/workflowCanvasState")])',
          ],
          { cwd: workdir, quiet: true },
        ),
      ).not.toThrow();
      expect(sourceRefState(root, sourceHead)).toBe(sourceRefs);
      expect(
        runRtk(["proxy", "git", "status", "--short", "--untracked-files=all"], {
          cwd: root,
          quiet: true,
        }),
      ).toBe(sourceStatus);
      expect(sourceWorktreeState(root)).toBe(sourceWorktrees);
    } finally {
      rmSync(workdir, { force: true, recursive: true });
    }
  }, 30_000);

  it("uses a lane-local frozen install when manifests match", () => {
    const { root, workdir } = fixture();
    const runner = vi.fn(() => "");

    expect(hydrateWorktreeDependencies(root, workdir, runner)).toEqual({
      linked: 0,
      mode: "installed",
    });
    expect(runner).toHaveBeenCalledWith(
      [
        "pnpm",
        "install",
        "--frozen-lockfile",
        "--prefer-offline",
        "--ignore-scripts",
        "--force",
      ],
      { cwd: workdir },
    );
  });

  it("runs a frozen local install when a workspace manifest drifts", () => {
    const { root, workdir } = fixture();
    writeFileSync(
      resolve(workdir, "packages/example/package.json"),
      '{"dependencies":{"effect":"latest"}}\n',
    );
    const runner = vi.fn(() => "");

    expect(hydrateWorktreeDependencies(root, workdir, runner)).toEqual({
      linked: 0,
      mode: "installed",
    });
    expect(runner).toHaveBeenCalledWith(
      [
        "pnpm",
        "install",
        "--frozen-lockfile",
        "--prefer-offline",
        "--ignore-scripts",
        "--force",
      ],
      { cwd: workdir },
    );
  });

  it("classifies only root workspace dependency inputs", () => {
    for (const file of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "apps/web/package.json",
      "packages/convex/package.json",
      "tooling/brain-factory/package.json",
      "tooling/patches/@convex-dev__migrations@0.3.5.patch",
    ]) {
      expect(isWorkspaceDependencyInput(file), file).toBe(true);
    }
    for (const file of [
      "packages/convex/confect/internal/migrations.ts",
      "packages/convex/test/migrations.test.ts",
      "repos/effect/package.json",
      "docs/package.json",
    ]) {
      expect(isWorkspaceDependencyInput(file), file).toBe(false);
    }
  });

  it("reinstalls after an integrated dependency input changes", () => {
    const { workdir } = fixture();
    const runner = vi
      .fn()
      .mockReturnValueOnce(
        [
          "packages/convex/confect/internal/migrations.ts",
          "tooling/patches/@convex-dev__migrations@0.3.5.patch",
          "packages/convex/package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
        ].join("\n"),
      )
      .mockReturnValue("");

    expect(
      hydrateChangedIntegrationDependencies({
        baseSha: "a".repeat(40),
        runner,
        workdir,
      }),
    ).toEqual({
      changedFiles: [
        "packages/convex/package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tooling/patches/@convex-dev__migrations@0.3.5.patch",
      ],
      mode: "installed",
    });
    expect(runner).toHaveBeenNthCalledWith(
      1,
      ["proxy", "git", "diff", "--name-only", `${"a".repeat(40)}..HEAD`],
      { cwd: workdir, quiet: true },
    );
    expect(runner).toHaveBeenNthCalledWith(
      2,
      [
        "pnpm",
        "install",
        "--frozen-lockfile",
        "--prefer-offline",
        "--ignore-scripts",
        "--force",
      ],
      { cwd: workdir },
    );
  });

  it("skips reinstall when the integrated delta has no dependency input", () => {
    const { workdir } = fixture();
    const runner = vi.fn(() => "packages/convex/test/migrations.test.ts\n");

    expect(
      hydrateChangedIntegrationDependencies({
        baseSha: "b".repeat(40),
        runner,
        workdir,
      }),
    ).toEqual({ changedFiles: [], mode: "unchanged" });
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
