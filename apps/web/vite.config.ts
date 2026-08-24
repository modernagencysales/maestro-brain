import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

import {
  assertProductionAuthConfiguration,
  fixtureAuthWorkerVariables,
  resolveWebAuthMode,
} from "./src/lib/auth/runtime-auth";

process.env.VITE_MAESTRO_AUTH_MODE = resolveWebAuthMode(process.env);
assertProductionAuthConfiguration(process.env);
const runtimeWorkerVars = fixtureAuthWorkerVariables(process.env);

const contractWorkerVars =
  process.env.MAESTRO_CONTRACT_TEST === "1"
    ? {
        MAESTRO_CONTRACT_TEST: "1",
        VITE_MAESTRO_CONTRACT_MODE:
          process.env.VITE_MAESTRO_CONTRACT_MODE ?? "1",
        WORKOS_API_KEY: process.env.WORKOS_API_KEY ?? "",
        WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID ?? "",
        WORKOS_COOKIE_PASSWORD: process.env.WORKOS_COOKIE_PASSWORD ?? "",
        WORKOS_REDIRECT_URI: process.env.WORKOS_REDIRECT_URI ?? "",
      }
    : {};

export default defineConfig(({ mode }) => ({
  build: { sourcemap: false },
  esbuild: { drop: ["console"] },
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@maestro-template/convex/refs": fileURLToPath(
        new URL("../../packages/convex/src/refs.ts", import.meta.url),
      ),
    },
  },
  plugins: [
    mode === "test"
      ? null
      : cloudflare({
          viteEnvironment: { name: "ssr" },
          config: (config) => ({
            vars: {
              ...config.vars,
              ...runtimeWorkerVars,
              ...contractWorkerVars,
            },
          }),
        }),
    tanstackStart({
      router: {
        enableRouteGeneration:
          mode !== "test" &&
          process.env.MAESTRO_DISABLE_ROUTE_GENERATION !== "1",
      },
    }),
    react(),
  ],
  server: {
    port: 3000,
    allowedHosts: process.env.NODE_ENV === "development" ? true : undefined,
    warmup: {
      clientFiles: [
        "./src/router.tsx",
        "./src/provider.tsx",
        "./src/routes/_app/$workspace/_dashboard/inbox.tsx",
        "./src/routes/_app/$workspace/_dashboard/inbox/$id.tsx",
        "./src/features/contacts/inbox/inbox-layout.tsx",
        "./src/features/contacts/inbox/brain-inbox-adapter.ts",
        "./src/features/contacts/inbox/brain-inbox-view-page.tsx",
      ],
    },
  },
}));
