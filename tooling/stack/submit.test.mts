import { expect, test, vi } from "vitest";
import { type Runner } from "./exec.mts";
import { evaluateSubmit, submitCommand } from "./submit.mts";

const runnerReturning = (map: Record<string, string>): Runner =>
  vi.fn((cmd, args) => {
    const key = `${cmd} ${args.join(" ")}`;
    for (const [prefix, out] of Object.entries(map))
      if (key.startsWith(prefix)) return out;
    return "";
  });

test("refuses when the slice conflicts with origin/main", () => {
  const run = runnerReturning({
    "git merge-tree":
      "t\n\nCONFLICT (content): Merge conflict in packages/convex/convex/schema.ts",
    "git diff --numstat": "10\t0\tpackages/convex/convex/domain/x.ts",
  });
  const r = evaluateSubmit(run, {
    base: "origin/main",
    head: "HEAD",
    isBottom: true,
  });
  expect(r.ok).toBe(false);
  expect(r.reason).toContain("conflict");
});

test("refuses when actual changed lines exceed the budget", () => {
  const big = Array.from(
    { length: 301 },
    () => "1\t0\tpackages/convex/convex/domain/x.ts",
  ).join("\n");
  const run = runnerReturning({
    "git merge-tree": "clean\n",
    "git diff --numstat": big,
  });
  const r = evaluateSubmit(run, {
    base: "origin/main",
    head: "HEAD",
    isBottom: true,
  });
  expect(r.ok).toBe(false);
  expect(r.reason).toContain("changed lines");
});

test("passes when clean and within budget", () => {
  const run = runnerReturning({
    "git merge-tree": "clean\n",
    "git diff --numstat": "10\t0\tpackages/convex/convex/domain/x.ts",
  });
  const r = evaluateSubmit(run, {
    base: "origin/main",
    head: "HEAD",
    isBottom: true,
  });
  expect(r.ok).toBe(true);
});

test("submits with local deterministic pre-push hooks excluded", () => {
  expect(submitCommand(undefined)).toEqual({
    args: [
      "LEFTHOOK_EXCLUDE=deterministic",
      "gt",
      "submit",
      "--draft",
      "--no-interactive",
    ],
    cmd: "env",
  });
});

test("preserves existing lefthook exclusions when adding deterministic", () => {
  expect(submitCommand("rubric")).toEqual({
    args: [
      "LEFTHOOK_EXCLUDE=rubric,deterministic",
      "gt",
      "submit",
      "--draft",
      "--no-interactive",
    ],
    cmd: "env",
  });
});
