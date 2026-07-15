import { createServerFn } from "@tanstack/react-start";

export const loadSafeClientRuntime = createServerFn({ method: "GET" }).handler(
  async () => {
    const { loadSafeClientRuntimeOnServer } =
      await import("./safe-client-runtime.server");

    return loadSafeClientRuntimeOnServer();
  },
);
