import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasMode } from "./src/script-mode.mts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("taste:eval", () => {
  it("supports fake mode", () => {
    expect(hasMode("fake", ["node", "script", "--mode", "fake"])).toBe(true);
  });

  it("does not match malformed mode args", () => {
    expect(hasMode("fake", ["node", "script", "--mode"])).toBe(false);
  });

  it(
    "emits a deterministic parseable pass verdict in fake mode",
    { timeout: 120_000 },
    () => {
      const result = spawnSync(
        "pnpm",
        ["exec", "tsx", "tooling/quality/taste-eval.mts", "--mode", "fake"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            OPENROUTER_API_KEY: "",
            OPENAI_API_KEY: "",
            TASTE_PROVIDER: "",
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "taste-eval: verdict=pass reason=fake-mode",
      );
      expect(result.stdout).toMatch(/^TASTE_VERDICT_JSON=/m);
    },
  );
});
