import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  containedTerminalReproofFile,
  observeTerminalReproofWorktree,
  readContainedTerminalReproofJson,
} from "../src/terminal-contract-reproof-safety.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

describe("terminal contract-reproof filesystem safety", () => {
  it("rejects traversal and an in-root symlink to external evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "terminal-reproof-evidence-"));
    const outside = mkdtempSync(join(tmpdir(), "terminal-reproof-outside-"));
    roots.push(root, outside);
    const valid = resolve(root, "request.json");
    const external = resolve(outside, "request.json");
    writeFileSync(valid, "{}\n");
    writeFileSync(external, "{}\n");
    symlinkSync(external, resolve(root, "linked.json"));

    expect(containedTerminalReproofFile(root, valid, "request")).toBe(
      realpathSync(valid),
    );
    expect(() =>
      containedTerminalReproofFile(root, external, "request"),
    ).toThrow("escapes its authority root");
    expect(readContainedTerminalReproofJson(root, valid, "request")).toEqual(
      {},
    );
    expect(() =>
      readContainedTerminalReproofJson(
        root,
        resolve(root, "linked.json"),
        "request",
      ),
    ).toThrow("escapes its authority root");
    expect(() =>
      containedTerminalReproofFile(
        root,
        resolve(root, "linked.json"),
        "request",
      ),
    ).toThrow("escapes its authority root");
  });

  it("requires the exact dedicated registered branch and head", () => {
    const parent = mkdtempSync(join(tmpdir(), "terminal-reproof-worktree-"));
    roots.push(parent);
    const root = resolve(parent, "control");
    const commonDir = resolve(parent, "common.git");
    const workdir = resolve(parent, ".maestro-brain-fabro-workdirs", "task");
    mkdirSync(root);
    mkdirSync(commonDir);
    mkdirSync(workdir, { recursive: true });
    const realWorkdir = realpathSync(workdir);
    const realCommonDir = realpathSync(commonDir);
    const head = "a".repeat(40);
    const branch = "fabro/reproof-s04-t04-example";
    const values = new Map([
      ["branch --show-current", branch],
      ["rev-parse HEAD", head],
      ["rev-parse --path-format=absolute --git-common-dir", realCommonDir],
      [
        "worktree list --porcelain",
        `worktree ${realWorkdir}\nHEAD ${head}\nbranch refs/heads/${branch}\n`,
      ],
      ["status --porcelain=v1", ""],
    ]);
    const runGit = (_cwd: string, args: readonly string[]): string =>
      values.get(args.join(" ")) ?? "";

    expect(
      observeTerminalReproofWorktree({
        controlCommonDir: commonDir,
        expectedBranch: branch,
        expectedHead: head,
        root,
        runGit,
        workdir,
      }),
    ).toMatchObject({ clean: true, headSha: head, registered: true });
    values.set("worktree list --porcelain", "");
    expect(() =>
      observeTerminalReproofWorktree({
        controlCommonDir: commonDir,
        expectedBranch: branch,
        expectedHead: head,
        root,
        runGit,
        workdir,
      }),
    ).toThrow("registered worktree identity drift");
    expect(() =>
      observeTerminalReproofWorktree({
        controlCommonDir: commonDir,
        expectedBranch: branch,
        root,
        runGit,
        workdir: root,
      }),
    ).toThrow("worktree is unsafe");
  });
});
