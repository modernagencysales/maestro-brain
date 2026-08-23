import { brainApiOrigin } from "./remoteSafety";
import { cliFailure } from "./result";
import { parseRemoteMcpCommand, type McpResultKind } from "./remoteMcpCommand";
import { parseJsonRpcBody, remoteMcpResponseResult } from "./remoteMcpResponse";
import type { CliResult, CliRuntimeConfig } from "./types";

type McpConfig =
  | { readonly ok: true; readonly origin: string; readonly apiKey: string }
  | { readonly ok: false; readonly result: CliResult };

const validateRemoteConfig = (config: CliRuntimeConfig): McpConfig => {
  const origin = brainApiOrigin(config.brainSiteUrl);
  if (origin === undefined)
    return {
      ok: false,
      result: cliFailure(
        "CONVEX_SITE_URL must be an HTTPS origin without credentials, path, query, or fragment.\n",
      ),
    };
  const apiKey = config.brainApiKey;
  return !apiKey || apiKey.trim() !== apiKey
    ? {
        ok: false,
        result: cliFailure("MAESTRO_BRAIN_API_KEY is required.\n"),
      }
    : { ok: true, origin, apiKey };
};

const executeRemoteMcpRequest = async (
  request: Readonly<Record<string, unknown>>,
  config: CliRuntimeConfig,
  kind: McpResultKind,
): Promise<CliResult> => {
  const validated = validateRemoteConfig(config);
  if (!validated.ok) return validated.result;
  try {
    const response = await fetch(`${validated.origin}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${validated.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = await parseJsonRpcBody(response);
    return parsed.ok
      ? remoteMcpResponseResult(parsed.body, response, validated.apiKey, kind)
      : parsed.result;
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
  const command = parseRemoteMcpCommand(argv);
  return command.ok
    ? await executeRemoteMcpRequest(command.request, config, command.kind)
    : command.result;
};
