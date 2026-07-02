import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";

import { getServerEnv, hasWorkosServerEnv } from "./server-env";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const workosRequestMiddleware = () =>
  hasWorkosServerEnv(getServerEnv()) ? [authkitMiddleware()] : [];

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, ...workosRequestMiddleware()],
}));
