import { defineConfig } from "vitest/config";

// Scoped vitest config for the Stryker mutation run: only the packages whose
// sources are mutated (see stryker.conf.mjs `mutate`). The root config
// collects every workspace test, including apps/web — whose vite/tsconfig
// files are deliberately excluded from the mutation sandbox.
export default defineConfig({
  test: {
    globals: false,
    include: [
      "packages/template-core/**/*.test.{ts,tsx,mts}",
      "packages/integrations/**/*.test.{ts,tsx,mts}",
      "packages/convex/**/*.test.{ts,tsx,mts}",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
