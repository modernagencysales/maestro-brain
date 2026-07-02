import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["**/*.test.{ts,tsx,mts}"],
    exclude: ["**/node_modules/**", "**/dist/**", "repos/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["tooling/quality/**/*.{ts,mts}"],
      exclude: [
        "**/*.test.{ts,tsx,mts}",
        "**/dist/**",
        "**/_generated/**",
        "repos/**",
        "vendor/**",
      ],
      thresholds: {
        lines: 20,
        functions: 20,
        branches: 15,
        statements: 20,
      },
    },
  },
});
