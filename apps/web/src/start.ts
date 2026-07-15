import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { createWorkosAuthkitMiddleware } from "./auth/workos-server-adapter";
import { buildAuthKitRuntimeConfig } from "./auth/authkit-server";
import { getServerEnv } from "./server-env";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const workosRequestMiddleware = () => {
  const config = buildAuthKitRuntimeConfig(getServerEnv());

  if (config.mode === "fake") return [];

  return [createWorkosAuthkitMiddleware({ redirectUri: config.redirectUri })];
};

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, ...workosRequestMiddleware()],
}));
