import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildBranchHygieneManifest,
  inventoryRemoteBranches,
} from "./branch-hygiene.mts";

const generatedAt = "2026-08-22T12:00:00.000Z";

describe("branch hygiene manifest", () => {
  it("inventories live remote heads when the checkout fetches only main", () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-branch-hygiene-"));
    const remote = join(root, "remote.git");
    const seed = join(root, "seed");
    const checkout = join(root, "checkout");
    const git = (cwd: string, args: readonly string[]): string =>
      execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

    try {
      git(root, ["init", "--bare", remote]);
      git(root, ["init", "-b", "main", seed]);
      git(seed, ["config", "user.name", "Branch Hygiene Test"]);
      git(seed, ["config", "user.email", "branch-hygiene@example.test"]);
      git(seed, ["commit", "--allow-empty", "-m", "seed main"]);
      git(seed, ["remote", "add", "origin", remote]);
      git(seed, ["push", "origin", "main"]);
      git(seed, ["switch", "-c", "topic/live"]);
      git(seed, ["commit", "--allow-empty", "-m", "topic"]);
      git(seed, ["push", "origin", "topic/live"]);
      git(root, [
        "clone",
        "--single-branch",
        "--branch",
        "main",
        remote,
        checkout,
      ]);
      const mainSha = git(checkout, ["rev-parse", "HEAD"]);
      git(checkout, [
        "update-ref",
        "refs/remotes/origin/ghost-deleted",
        mainSha,
      ]);
      const temporaryNamespace = `refs/branch-hygiene/${process.pid}`;
      git(checkout, [
        "update-ref",
        `${temporaryNamespace}/ghost-crashed`,
        mainSha,
      ]);

      expect(
        git(checkout, ["config", "--get-all", "remote.origin.fetch"]),
      ).toBe("+refs/heads/main:refs/remotes/origin/main");

      const branches = inventoryRemoteBranches({
        remote: "origin",
        base: "main",
        cwd: checkout,
      });

      expect(branches.map((branch) => branch.name)).toEqual([
        "main",
        "topic/live",
      ]);
      expect(branches.some((branch) => branch.name === "ghost-deleted")).toBe(
        false,
      );
      expect(branches.some((branch) => branch.name === "ghost-crashed")).toBe(
        false,
      );
      expect(
        git(checkout, [
          "for-each-ref",
          "--format=%(refname)",
          temporaryNamespace,
        ]),
      ).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cleans the temporary namespace when the remote fetch fails", () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-branch-hygiene-failure-"));
    const git = (args: readonly string[]): string =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    const temporaryNamespace = `refs/branch-hygiene/${process.pid}`;

    try {
      git(["init", "-b", "main"]);
      git(["config", "user.name", "Branch Hygiene Test"]);
      git(["config", "user.email", "branch-hygiene@example.test"]);
      git(["commit", "--allow-empty", "-m", "seed main"]);
      const mainSha = git(["rev-parse", "HEAD"]);
      git(["update-ref", `${temporaryNamespace}/partial-fetch`, mainSha]);

      expect(() =>
        inventoryRemoteBranches({
          remote: "missing-remote",
          base: "main",
          cwd: root,
        }),
      ).toThrow();
      expect(
        git(["for-each-ref", "--format=%(refname)", temporaryNamespace]),
      ).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps canonical and unmerged branches", () => {
    const manifest = buildBranchHygieneManifest({
      baseRef: "origin/main",
      canonicalBranches: ["main"],
      protectedBranches: ["main"],
      generatedAt,
      staleBefore: "2026-07-23T12:00:00.000Z",
      branches: [
        {
          name: "main",
          sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          committedAt: "2026-08-22T10:00:00.000Z",
          mergedIntoBase: true,
        },
        {
          name: "codex/current-work",
          sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          committedAt: "2026-08-21T10:00:00.000Z",
          mergedIntoBase: false,
        },
      ],
    });

    expect(manifest.branches).toEqual([
      expect.objectContaining({
        name: "codex/current-work",
        disposition: "keep",
        reasons: ["not-merged-into-base", "recent"],
      }),
      expect.objectContaining({ name: "main", disposition: "keep" }),
    ]);
  });

  it("separates stale unmerged branches for archival review", () => {
    const manifest = buildBranchHygieneManifest({
      baseRef: "origin/main",
      canonicalBranches: ["main"],
      protectedBranches: ["main"],
      generatedAt,
      staleBefore: "2026-07-23T12:00:00.000Z",
      branches: [
        {
          name: "product/superseded-work",
          sha: "ffffffffffffffffffffffffffffffffffffffff",
          committedAt: "2026-07-01T10:00:00.000Z",
          mergedIntoBase: false,
        },
      ],
    });

    expect(manifest.branches).toEqual([
      expect.objectContaining({
        name: "product/superseded-work",
        disposition: "review-archive",
        reasons: ["not-merged-into-base", "older-than-stale-threshold"],
      }),
    ]);
    expect(manifest.recoveryTags).toHaveLength(1);
    expect(manifest.deletionEnabled).toBe(false);
  });

  it("proposes review only for stale merged branches", () => {
    const manifest = buildBranchHygieneManifest({
      baseRef: "origin/main",
      canonicalBranches: ["main"],
      protectedBranches: ["main"],
      generatedAt,
      staleBefore: "2026-07-23T12:00:00.000Z",
      branches: [
        {
          name: "codex/old-work",
          sha: "cccccccccccccccccccccccccccccccccccccccc",
          committedAt: "2026-07-01T10:00:00.000Z",
          mergedIntoBase: true,
        },
        {
          name: "codex/recent-work",
          sha: "dddddddddddddddddddddddddddddddddddddddd",
          committedAt: "2026-08-20T10:00:00.000Z",
          mergedIntoBase: true,
        },
      ],
    });

    expect(manifest.branches).toEqual([
      expect.objectContaining({
        name: "codex/old-work",
        disposition: "review-delete",
        reasons: ["merged-into-base", "older-than-stale-threshold"],
      }),
      expect.objectContaining({
        name: "codex/recent-work",
        disposition: "keep",
        reasons: ["recent"],
      }),
    ]);
  });

  it("creates one recovery tag per unique candidate SHA", () => {
    const manifest = buildBranchHygieneManifest({
      baseRef: "origin/main",
      canonicalBranches: ["main"],
      protectedBranches: ["main"],
      generatedAt,
      staleBefore: "2026-07-23T12:00:00.000Z",
      branches: [
        {
          name: "archive/duplicate-a",
          sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          committedAt: "2026-07-01T10:00:00.000Z",
          mergedIntoBase: true,
        },
        {
          name: "codex/duplicate-b",
          sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          committedAt: "2026-07-01T10:00:00.000Z",
          mergedIntoBase: true,
        },
      ],
    });

    expect(manifest.recoveryTags).toEqual([
      {
        sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        tag: "archive/branch-cleanup-20260822-eeeeeeeeeeee",
        branches: ["archive/duplicate-a", "codex/duplicate-b"],
      },
    ]);
    expect(manifest.deletionEnabled).toBe(false);
  });
});
