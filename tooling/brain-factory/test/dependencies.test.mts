import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hydrateChangedIntegrationDependencies,
  hydrateWorktreeDependencies,
  isWorkspaceDependencyInput,
} from "../src/dependencies.js";
import { runRtk } from "../src/process.js";

const temporaryDirectories: string[] = [];
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

describe("worktree dependency hydration", () => {
  it("resolves lane-consumed private package exports after fresh hydration", () => {
    const directory = mkdtempSync(join(tmpdir(), "brain-dependencies-real-"));
    temporaryDirectories.push(directory);
    const root = resolve(import.meta.dirname, "../../..");
    const repository = resolve(directory, "repository.git");
    const workdir = resolve(directory, "worktree");
    const candidateSha =
      runRtk(["proxy", "git", "stash", "create"], {
        cwd: root,
        quiet: true,
      }) || "HEAD";

    runRtk(["proxy", "git", "clone", "--shared", "--bare", root, repository], {
      quiet: true,
    });
    runRtk(
      [
        "proxy",
        "git",
        "--git-dir",
        repository,
        "worktree",
        "add",
        "--detach",
        workdir,
        candidateSha,
      ],
      { quiet: true },
    );
    try {
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
    } finally {
      runRtk(
        [
          "proxy",
          "git",
          "--git-dir",
          repository,
          "worktree",
          "remove",
          "--force",
          workdir,
        ],
        { quiet: true },
      );
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
