import { defineConfig } from "vitest/config";

// Directories measured by the coverage ratchet. Node-pure packages only:
// packages/convex and apps/web run under their own vitest configs
// (edge-runtime / jsdom) and are ratcheted separately when provisioned.
export const coverageRatchetDirs = [
  "packages/template-core",
  "packages/integrations",
  "packages/search",
  "packages/storage",
  "packages/notifications",
  "packages/observability",
  "tooling/quality",
  "tooling/workflow",
  "tooling/release",
  "tooling/generators",
  "tooling/stack",
  "apps/cli",
];

export default defineConfig({
  test: {
    globals: false,
    include: ["**/*.test.{ts,tsx,mts,mjs}"],
    exclude: ["**/node_modules/**", "**/dist/**", "repos/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      include: coverageRatchetDirs.map((dir) => `${dir}/**/*.{ts,mts,tsx}`),
      exclude: [
        "**/*.test.{ts,tsx,mts}",
        "**/dist/**",
        "**/_generated/**",
        "**/__fixtures__/**",
        "repos/**",
        "vendor/**",
      ],
      // Floors live in coverage-baseline.json; check:coverage-ratchet compares
      // the json-summary against it and refuses to let coverage fall.
    },
  },
});
