import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { requireBuildWebEnv } from "./src/env";

export default defineConfig(({ command, mode }) => {
  requireBuildWebEnv(
    command,
    loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_"),
  );

  return {
    build: {
      sourcemap: false,
    },
    plugins: [
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
      alias: {
        "@maestro-template/template-core/generated/confectManifest":
          fileURLToPath(
            new URL(
              "../../packages/template-core/src/generated/confectManifest.ts",
              import.meta.url,
            ),
          ),
        "@maestro-template/ui": fileURLToPath(
          new URL("../../packages/ui/src/index.tsx", import.meta.url),
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
      },
    },
  };
});
