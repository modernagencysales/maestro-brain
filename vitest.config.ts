import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["**/*.test.{ts,tsx,mts}"],
    exclude: ["node_modules/**", "dist/**", "repos/**"],
  },
});
