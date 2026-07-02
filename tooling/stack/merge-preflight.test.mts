import { expect, test, vi } from "vitest";
import {
  evaluateCommitWarnings,
  mergeLogMarkdown,
  runMergePreflight,
} from "./merge-preflight.mts";

test("warns on retrigger commits and downstack-looking merged PR commits", () => {
  const warnings = evaluateCommitWarnings([
    { oid: "a", subject: "chore: retrigger example stage checks" },
    {
      oid: "b",
      subject: "[codex] Observe example workflow stages (#299)",
    },
  ]);

  expect(warnings.some((warning) => warning.includes("retrigger"))).toBe(true);
  expect(warnings.some((warning) => warning.includes("already-merged"))).toBe(
    true,
  );
});

test("preflight fetches main, checks format, runs Graphite dry run, and writes a log", () => {
  const calls: string[] = [];
  const writes: Array<{ path: string; text: string }> = [];
  const mkdir = vi.fn();
  const result = runMergePreflight({
    now: new Date("2026-06-19T20:00:00Z"),
    run(command, args) {
      calls.push([command, ...args].join(" "));
      if (command === "git" && args.join(" ") === "branch --show-current")
        return "codex/example\n";
      if (command === "git" && args.join(" ") === "rev-parse origin/main")
        return "main-sha\n";
      if (command === "git" && args.join(" ") === "rev-parse HEAD")
        return "head-sha\n";
      if (command === "git" && args[0] === "log") return "abc123 subject one\n";
      return "";
    },
    writeFile(path, text) {
      writes.push({ path, text });
    },
    mkdir,
  });

  expect(result.ok).toBe(true);
  expect(calls).toContain("git fetch origin main");
  expect(calls).toContain("pnpm check:format");
  expect(calls).toContain("gt merge --dry-run --no-interactive");
  expect(mkdir).toHaveBeenCalledWith("artifacts/stack-merge");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.path).toMatch(
    /artifacts\/stack-merge\/2026-06-19-codex-example\.md$/,
  );
});

test("fails and writes a log when local main is stale", () => {
  const calls: string[] = [];
  const writes: Array<{ path: string; text: string }> = [];
  const mkdir = vi.fn();

  expect(() =>
    runMergePreflight({
      now: new Date("2026-06-19T20:00:00Z"),
      run(command, args) {
        calls.push([command, ...args].join(" "));
        if (command === "git" && args.join(" ") === "fetch origin main")
          return "";
        if (command === "git" && args.join(" ") === "branch --show-current")
          return "codex/example\n";
        if (command === "git" && args.join(" ") === "rev-parse origin/main")
          return "origin-main-sha\n";
        if (command === "git" && args.join(" ") === "rev-parse HEAD")
          return "head-sha\n";
        if (command === "git" && args.join(" ") === "rev-parse main")
          return "local-main-sha\n";
        if (command === "git" && args[0] === "log")
          return "abc123 subject one\n";
        throw new Error(`unexpected command ${command} ${args.join(" ")}`);
      },
      writeFile(path, text) {
        writes.push({ path, text });
      },
      mkdir,
    }),
  ).toThrow(/local main/);

  expect(calls).not.toContain("pnpm check:format");
  expect(calls).not.toContain("gt merge --dry-run --no-interactive");
  expect(mkdir).toHaveBeenCalledWith("artifacts/stack-merge");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.text).toContain("## Failure");
  expect(writes[0]?.text).toContain("local main");
});

test("writes a failed preflight log when a safety command fails", () => {
  const calls: string[] = [];
  const writes: Array<{ path: string; text: string }> = [];

  expect(() =>
    runMergePreflight({
      now: new Date("2026-06-19T20:00:00Z"),
      run(command, args) {
        calls.push([command, ...args].join(" "));
        if (command === "git" && args.join(" ") === "fetch origin main")
          return "";
        if (command === "git" && args.join(" ") === "branch --show-current")
          return "codex/example\n";
        if (command === "git" && args.join(" ") === "rev-parse origin/main")
          return "main-sha\n";
        if (command === "git" && args.join(" ") === "rev-parse HEAD")
          return "head-sha\n";
        if (command === "git" && args.join(" ") === "rev-parse main")
          return "main-sha\n";
        if (command === "git" && args[0] === "log")
          return "abc123 subject one\n";
        if (command === "pnpm") throw new Error("format failed");
        return "";
      },
      writeFile(path, text) {
        writes.push({ path, text });
      },
      mkdir() {},
    }),
  ).toThrow(/format failed/);

  expect(calls).toContain("pnpm check:format");
  expect(calls).not.toContain("gt merge --dry-run --no-interactive");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.text).toContain("## Failure");
  expect(writes[0]?.text).toContain("format failed");
  expect(writes[0]?.text).toContain("`pnpm check:format`");
});

test("merge log records branch, main sha, head sha, commits, warnings, and commands", () => {
  const log = mergeLogMarkdown({
    branch: "codex/example",
    originMain: "main-sha",
    head: "head-sha",
    commits: [{ oid: "abc123", subject: "subject one" }],
    warnings: ["warning one"],
    commands: ["git fetch origin main", "pnpm check:format"],
    failure: undefined,
    createdAt: new Date("2026-06-19T20:00:00Z"),
  });

  expect(log).toContain("codex/example");
  expect(log).toContain("main-sha");
  expect(log).toContain("head-sha");
  expect(log).toContain("abc123 subject one");
  expect(log).toContain("warning one");
  expect(log).toContain("pnpm check:format");
});
