import { createServerFn } from "@tanstack/react-start";

import { getServerEnv } from "../server-env";
import { getSafeClientRuntime } from "./authkit-server";
import { getWorkosServerAuth } from "./workos-server-adapter";

export const loadSafeClientRuntime = createServerFn({ method: "GET" }).handler(
  async () =>
    getSafeClientRuntime({
      env: getServerEnv(),
      getAuth: getWorkosServerAuth,
    }),
);
