import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: false,
  },
  plugins: [
    tanstackStart({
      spa: { enabled: true },
      router: {
        routesDirectory: "./routes",
        generatedRouteTree: "./routeTree.gen.ts",
      },
    }),
    react(),
  ],
  resolve: {
    alias: {
      "@maestro-template/ui": fileURLToPath(
        new URL("../../packages/ui/src/index.tsx", import.meta.url),
      ),
      "@maestro-template/template-core": fileURLToPath(
        new URL("../../packages/template-core/src/index.ts", import.meta.url),
      ),
      "@maestro-template/workflow-ui": fileURLToPath(
        new URL("../../packages/workflow-ui/src/index.tsx", import.meta.url),
      ),
    },
  },
});
