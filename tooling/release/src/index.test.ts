import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runReleaseCli, smokeWebStaticBuild } from "./index";

const makeRepo = (): string => {
  const repoRoot = join(
    tmpdir(),
    `maestro-template-release-${Math.random().toString(16).slice(2)}`,
  );
  const dist = join(repoRoot, "apps/web/dist");
  const assets = join(dist, "assets");

  mkdirSync(assets, { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    '<div id="root"></div><script type="module" src="/assets/index.js"></script>',
  );
  writeFileSync(join(assets, "index.js"), "console.log('ok');");

  return repoRoot;
};

describe("release tooling", () => {
  it("passes for a built static web app", () => {
    const repoRoot = makeRepo();

    try {
      expect(smokeWebStaticBuild({ repoRoot })).toMatchObject({
        ok: true,
        assetCount: 1,
        checks: expect.arrayContaining([
          expect.objectContaining({ id: "web:index", status: "pass" }),
          expect.objectContaining({ id: "web:root", status: "pass" }),
          expect.objectContaining({
            id: "web:assets-linked",
            status: "pass",
          }),
        ]),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails clearly before the static build exists", () => {
    const repoRoot = join(
      tmpdir(),
      `maestro-template-release-missing-${Math.random().toString(16).slice(2)}`,
    );

    expect(smokeWebStaticBuild({ repoRoot })).toMatchObject({
      ok: false,
      assetCount: 0,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "web:index", status: "fail" }),
        expect.objectContaining({ id: "web:assets", status: "fail" }),
      ]),
    });
  });

  it("exposes a CLI smoke report", () => {
    const repoRoot = makeRepo();

    try {
      const result = runReleaseCli(["smoke-web-static"], repoRoot);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        assetCount: 1,
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
