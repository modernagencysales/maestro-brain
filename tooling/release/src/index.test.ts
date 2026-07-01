import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReviewerReadinessReport,
  runReleaseCli,
  smokeWebStaticBuild,
} from "./index";

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

const makeReviewerRepo = (): string => {
  const repoRoot = join(
    tmpdir(),
    `maestro-template-review-${Math.random().toString(16).slice(2)}`,
  );
  const files = [
    "README.md",
    "AGENTS.md",
    "docs/template/investor-reviewer-packet.md",
    "docs/template/reviewer-guide.md",
    "docs/template/repo-map.md",
    "docs/template/confect-effect-guide.md",
    "docs/template/app-factory-guide.md",
    "docs/template/private-package-guide.md",
    "docs/template/hosting.md",
    "docs/template/security.md",
    "docs/template/coding-standards.md",
    "docs/template/integrations.md",
    "docs/template/workflow-authoring-guide.md",
    "docs/rule-coverage.md",
    "apps/cli/src/index.ts",
    "apps/web/src/sample/App.tsx",
    "packages/convex/confect/http.ts",
    "packages/convex/confect/_generated/refs.ts",
    "packages/convex/confect/jobs/workpool.spec.ts",
    "packages/convex/test/confect-contracts.test.ts",
    "packages/integrations/src/index.ts",
    "packages/integrations/src/index.test.ts",
    "packages/workflow-ui/src/index.tsx",
    "packages/template-core/src/index.ts",
    "tooling/quality/check-auth-demo-bypass.mts",
    "tooling/quality/check-secret-canaries.mts",
    "tooling/quality/check-workflow-graph-boundary.mts",
    "tooling/workflow/src/index.ts",
    "tooling/generators/src/index.ts",
    "tooling/generators/src/index.test.ts",
    "tests/e2e/hosted-reference-app.spec.ts",
    "tests/e2e/hosted-reference-app.visual.spec.ts",
  ];

  for (const file of files) {
    const fullPath = join(repoRoot, file);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "ok");
  }

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

  it("builds an investor readiness report", () => {
    const repoRoot = makeReviewerRepo();

    try {
      const report = buildReviewerReadinessReport({
        repoRoot,
        commit: "abc1234",
        hostedUrl: "https://example.test",
      });

      expect(report).toMatchObject({
        ok: true,
        commit: "abc1234",
        hostedUrl: "https://example.test",
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            path: "docs/template/investor-reviewer-packet.md",
            status: "pass",
          }),
          expect.objectContaining({
            path: "docs/rule-coverage.md",
            status: "pass",
          }),
          expect.objectContaining({
            path: "packages/convex/confect/_generated/refs.ts",
            status: "pass",
          }),
        ]),
        claims: expect.arrayContaining([
          expect.objectContaining({
            id: "confect-effect-contracts",
            status: "pass",
            evidence: expect.arrayContaining([
              "packages/convex/confect/_generated/refs.ts",
              "packages/convex/test/confect-contracts.test.ts",
            ]),
          }),
          expect.objectContaining({
            id: "app-factory-generators",
            status: "pass",
            evidence: expect.arrayContaining([
              "tooling/generators/src/index.ts",
              "docs/template/private-package-guide.md",
            ]),
          }),
        ]),
        commands: expect.arrayContaining([
          "pnpm check:format",
          "pnpm check:confect-contracts",
          "pnpm check:confect-compat",
          "pnpm smoke:hosted:browser",
          "pnpm smoke:hosted:visual",
        ]),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("exposes a CLI investor readiness report", () => {
    const repoRoot = makeReviewerRepo();

    try {
      const result = runReleaseCli(["review-readiness"], repoRoot);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        hostedUrl: "https://maestro-template.pages.dev",
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
