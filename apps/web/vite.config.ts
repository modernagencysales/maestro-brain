import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@maestro-template/ui": fileURLToPath(
        new URL("../../packages/ui/src/index.tsx", import.meta.url),
      ),
      "@maestro-template/workflow-ui": fileURLToPath(
        new URL("../../packages/workflow-ui/src/index.tsx", import.meta.url),
      ),
    },
  },
});
