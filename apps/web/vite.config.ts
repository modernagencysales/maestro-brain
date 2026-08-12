import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { requireBuildWebEnv } from "./src/env";

export default defineConfig(({ mode }) => ({
  build: {
    sourcemap: false,
  },
  plugins: [
    {
      name: "require-build-web-env",
      config: (_config, env) =>
        requireBuildWebEnv(
          env.command,
          loadEnv(
            env.mode,
            fileURLToPath(new URL(".", import.meta.url)),
            "VITE_",
          ),
        ),
    },
    mode === "test" ? null : cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({
      router: {
        routesDirectory: "./routes",
        generatedRouteTree: "./routeTree.gen.ts",
      },
    }),
    react(),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@maestro-template/template-core/generated/confectManifest":
        fileURLToPath(
          new URL(
            "../../packages/template-core/src/generated/confectManifest.ts",
            import.meta.url,
          ),
        ),
      "@maestro-template/template-core/sha256": fileURLToPath(
        new URL("../../packages/template-core/src/sha256.ts", import.meta.url),
      ),
      "@maestro-template/convex/refs": fileURLToPath(
        new URL("../../packages/convex/src/refs.ts", import.meta.url),
      ),
      "@maestro-template/template-core": fileURLToPath(
        new URL("../../packages/template-core/src/index.ts", import.meta.url),
      ),
      "@maestro-template/notifications": fileURLToPath(
        new URL("../../packages/notifications/src/index.ts", import.meta.url),
      ),
      "@maestro-template/workflow-ui/workflowCanvasState": fileURLToPath(
        new URL(
          "../../packages/workflow-ui/src/workflowCanvasState.ts",
          import.meta.url,
        ),
      ),
      "@maestro-template/workflow-ui": fileURLToPath(
        new URL("../../packages/workflow-ui/src/index.tsx", import.meta.url),
      ),
      "@workspace/ui": fileURLToPath(
        new URL("./src/components", import.meta.url),
      ),
      "@workspace/api": fileURLToPath(
        new URL("./src/workspace/api", import.meta.url),
      ),
      "@workspace/i18n": fileURLToPath(
        new URL("./src/workspace/i18n/index.ts", import.meta.url),
      ),
      "@workspace/config": fileURLToPath(
        new URL("./src/workspace/config/index.ts", import.meta.url),
      ),
      "@workspace/better-auth": fileURLToPath(
        new URL("./src/workspace/better-auth", import.meta.url),
      ),
    },
  },
}));
