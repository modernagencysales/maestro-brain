import { defineConfig } from "vitest/config";

// globals:true so ESLint's RuleTester picks up describe/it and integrates with
// the vitest reporter.
export default defineConfig({
  test: { globals: true },
});
