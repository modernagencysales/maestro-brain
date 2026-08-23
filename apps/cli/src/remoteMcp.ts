import { parseNamedArgs } from "./namedArgs";
import { containsTenantSelector, brainApiOrigin } from "./remoteSafety";
import { cliFailure, formatJsonOutput } from "./result";
import type { CliResult, CliRuntimeConfig } from "./types";

type McpResultKind = "tools" | "prompts" | "call";

const redactedJson = (value: unknown, apiKey: string): string =>
  formatJsonOutput(value).split(apiKey).join("[REDACTED]");

const embeddedToolError = (result: unknown): unknown => {
  if (result === null || typeof result !== "object") return undefined;
  if (Reflect.get(result, "isError") === true) return result;
  const content = Reflect.get(result, "content");
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (item === null || typeof item !== "object") continue;
    const text = Reflect.get(item, "text");
    if (typeof text !== "string") continue;
    try {
      const payload: unknown = JSON.parse(text);
      if (
        payload !== null &&
        typeof payload === "object" &&
        Reflect.get(payload, "ok") === false
      )
        return Reflect.get(payload, "error") ?? payload;
    } catch {
      // Normal text tool output does not need to be JSON.
    }
  }
  return undefined;
};

const executeRemoteMcpRequest = async (
  request: Readonly<Record<string, unknown>>,
  config: CliRuntimeConfig,
  resultKind: McpResultKind,
): Promise<CliResult> => {
  const origin = brainApiOrigin(config.brainSiteUrl);
  if (origin === undefined)
    return cliFailure(
      "CONVEX_SITE_URL must be an HTTPS origin without credentials, path, query, or fragment.\n",
    );
  const apiKey = config.brainApiKey;
  if (!apiKey || apiKey.trim() !== apiKey)
    return cliFailure("MAESTRO_BRAIN_API_KEY is required.\n");
  try {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const responseText = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(responseText);
    } catch {
      return cliFailure(
        `Brain MCP returned HTTP ${response.status} with a non-JSON response.\n`,
      );
    }
    if (body === null || typeof body !== "object")
      return cliFailure("Brain MCP returned an invalid JSON-RPC response.\n");
    const error = Reflect.get(body, "error");
    if (!response.ok || error !== undefined)
      return {
        exitCode: 1,
        stdout: redactedJson(
          {
            ok: false,
            transport: "streamable-http",
            error: error ?? { code: "HTTP_ERROR", status: response.status },
          },
          apiKey,
        ),
        stderr: "",
      };
    const result = Reflect.get(body, "result");
    if (resultKind === "call") {
      const toolError = embeddedToolError(result);
      return {
        exitCode: toolError === undefined ? 0 : 1,
        stdout: redactedJson(
          toolError === undefined
            ? { ok: true, transport: "streamable-http", result }
            : {
                ok: false,
                transport: "streamable-http",
                error: toolError,
                result,
              },
          apiKey,
        ),
        stderr: "",
      };
    }
    const collection =
      result !== null && typeof result === "object"
        ? Reflect.get(result, resultKind)
        : undefined;
    if (!Array.isArray(collection))
      return cliFailure(
        `Brain MCP returned an invalid ${resultKind} catalog.\n`,
      );
    if (
      resultKind === "tools" &&
      collection.some((tool) =>
        containsTenantSelector(
          tool !== null && typeof tool === "object"
            ? Reflect.get(tool, "inputSchema")
            : undefined,
        ),
      )
    )
      return cliFailure(
        "Brain MCP tool schemas expose a forbidden tenant selector.\n",
      );
    return {
      exitCode: 0,
      stdout: redactedJson(
        {
          ok: true,
          transport: "streamable-http",
          [`${resultKind.slice(0, -1)}Count`]: collection.length,
          [resultKind]: collection,
        },
        apiKey,
      ),
      stderr: "",
    };
  } catch {
    return cliFailure(
      "Could not reach Brain MCP (network error or timeout).\n",
    );
  }
};

export const runRemoteMcpCommand = async (
  argv: readonly string[],
  config: CliRuntimeConfig,
): Promise<CliResult | undefined> => {
  if (argv[0] !== "mcp") return undefined;
  if (argv[1] === "tools" && argv.length === 2)
    return await executeRemoteMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      config,
      "tools",
    );
  if (argv[1] === "prompts" && argv.length === 2)
    return await executeRemoteMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "prompts/list" },
      config,
      "prompts",
    );
  if (argv[1] !== "call" || !argv[2])
    return cliFailure(
      "mcp usage: mcp tools | mcp prompts | mcp call <tool-name> [--input <json>].\n",
    );
  const parsed = parseNamedArgs(argv.slice(3));
  if (!parsed.ok) return cliFailure(`${parsed.message}\n`);
  const { input = {}, ...unsupported } = parsed.args;
  if (Object.keys(unsupported).length > 0)
    return cliFailure("mcp call accepts only --input <json>.\n");
  if (containsTenantSelector(input))
    return cliFailure(
      "Brain scope must be derived from MAESTRO_BRAIN_API_KEY.\n",
    );
  return await executeRemoteMcpRequest(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: argv[2], arguments: input },
    },
    config,
    "call",
  );
};
