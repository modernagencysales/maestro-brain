import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { validOrigin } from "./config.js";

export type TerminalLinkResult = {
  readonly key: string;
  readonly workspace: string;
  readonly origin: string;
};

const openBrowser = (url: string, platform: NodeJS.Platform): void => {
  const command =
    platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  spawn(command[0] as string, command.slice(1), {
    detached: true,
    stdio: "ignore",
  }).unref();
};

export const linkTerminal = async (input: {
  readonly siteOrigin: string;
  readonly apiOrigin: string;
  readonly platform: NodeJS.Platform;
  readonly open?: (url: string) => void;
  readonly timeoutMs?: number;
}): Promise<TerminalLinkResult> => {
  const state = randomBytes(24).toString("hex");
  return await new Promise<TerminalLinkResult>((resolve, reject) => {
    const server = createServer((request, response) => {
      const callback = new URL(request.url ?? "/", "http://127.0.0.1");
      const origin = validOrigin(callback.searchParams.get("origin") ?? "");
      const result = {
        state: callback.searchParams.get("state") ?? "",
        key: callback.searchParams.get("key")?.trim() ?? "",
        workspace: callback.searchParams.get("workspace")?.trim() ?? "",
        origin,
      };
      const valid =
        callback.pathname === "/callback" &&
        result.state === state &&
        Boolean(result.key) &&
        Boolean(result.workspace) &&
        result.origin === input.apiOrigin;
      response.writeHead(valid ? 200 : 400, { "content-type": "text/plain" });
      response.end(
        valid
          ? "Maestro Brain linked. Return to your terminal."
          : "Invalid terminal link callback.",
      );
      server.close();
      if (valid)
        resolve({
          key: result.key,
          workspace: result.workspace,
          origin: result.origin as string,
        });
      else reject(new Error("Terminal link callback validation failed."));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      const callback = `http://127.0.0.1:${address.port}/callback`;
      const link = new URL("/terminal-link", input.siteOrigin);
      link.searchParams.set("callback", callback);
      link.searchParams.set("state", state);
      const open =
        input.open ??
        ((url: string) => {
          process.stderr.write(
            `Opening Maestro Brain in your browser. Waiting for approval.\nFallback URL: ${url}\n`,
          );
          openBrowser(url, input.platform);
        });
      open(link.href);
    });
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Terminal linking timed out."));
    }, input.timeoutMs ?? 300_000);
    timeout.unref();
    server.on("close", () => clearTimeout(timeout));
    server.on("error", reject);
  });
};
