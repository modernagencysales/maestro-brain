import {
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateWorktreeDependencies } from "../src/dependencies.js";

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
  it("links root and package-local installs when manifests match", () => {
    const { root, workdir } = fixture();
    mkdirSync(resolve(root, "node_modules"));
    mkdirSync(resolve(root, "packages/example/node_modules"));
    const runner = vi.fn();

    expect(hydrateWorktreeDependencies(root, workdir, runner)).toEqual({
      linked: 2,
      mode: "linked",
    });
    expect(readlinkSync(resolve(workdir, "node_modules"))).toBe(
      resolve(root, "node_modules"),
    );
    expect(
      readlinkSync(resolve(workdir, "packages/example/node_modules")),
    ).toBe(resolve(root, "packages/example/node_modules"));
    expect(runner).not.toHaveBeenCalled();
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
      ],
      { cwd: workdir },
    );
  });
});
