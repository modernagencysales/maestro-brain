import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateLoggingBoundary } from "./check-logging-boundary.mts";

type FixtureFiles = Record<string, string>;

async function withTempRepo<T>(
  files: FixtureFiles,
  run: (repoRoot: string) => Promise<T>,
): Promise<T> {
  const repoRoot = await mkdtemp(join(tmpdir(), "logging-boundary-"));

  try {
    for (const [path, contents] of Object.entries(files)) {
      const fullPath = join(repoRoot, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, contents);
    }

    return await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

async function evaluateFixture(files: FixtureFiles) {
  return await withTempRepo(files, evaluateLoggingBoundary);
}

describe("check:logging-boundary", () => {
  it("rejects console logging in web runtime code", async () => {
    const result = await evaluateFixture({
      "apps/web/src/features/Bad.ts": `
        export function logProviderPayload(payload: unknown) {
          console.error(payload);
        }
      `,
    });

    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        file: "apps/web/src/features/Bad.ts",
        method: "error",
      }),
    );
  });

  it("rejects console logging in package runtime code", async () => {
    const result = await evaluateFixture({
      "packages/integrations/src/bad.ts": `
        export const debug = (payload: unknown) => console.log(payload);
      `,
    });

    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        file: "packages/integrations/src/bad.ts",
        method: "log",
      }),
    );
  });

  it("rejects console debug hooks in Convex runtime code", async () => {
    const result = await evaluateFixture({
      "packages/convex/confect/internal/bad.impl.ts": `
        export function suppressUnsafeLogs() {
          console.debug = () => {};
        }
      `,
    });

    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        file: "packages/convex/confect/internal/bad.impl.ts",
        method: "debug",
      }),
    );
  });

  it("ignores tests in product roots", async () => {
    const result = await evaluateFixture({
      "packages/integrations/src/debug.test.ts": `
        console.warn("fixture output is okay in tests");
      `,
    });

    expect(result).toEqual({ ok: true, findings: [] });
  });

  it("does not scan tooling scripts", async () => {
    const result = await evaluateFixture({
      "tooling/release/src/index.ts": `
        console.log("operator-facing output");
      `,
    });

    expect(result).toEqual({ ok: true, findings: [] });
  });
});
