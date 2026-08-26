import { apiKeySettingsUrl, type BrainConfig } from "./config.js";

export type CliResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export const success = (value: unknown): CliResult => ({
  exitCode: 0,
  stdout: `${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`,
  stderr: "",
});

export const failure = (message: string): CliResult => ({
  exitCode: 1,
  stdout: "",
  stderr: message.endsWith("\n") ? message : `${message}\n`,
});

const redacted = (text: string, secret: string): string =>
  secret ? text.split(secret).join("[REDACTED]") : text;

type ApiRequest = {
  readonly config: BrainConfig;
  readonly fetcher: typeof fetch;
  readonly operationId: string;
  readonly input: Record<string, unknown>;
  readonly idempotencyKey?: string;
};

const successfulApiBody = (response: Response, body: unknown): boolean => {
  if (!response.ok || body === null || typeof body !== "object") return false;
  return "ok" in body && body.ok === true;
};

const apiResponseResult = async (
  response: Response,
  apiKey: string,
): Promise<CliResult> => {
  const text = redacted(await response.text(), apiKey);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return failure(
      `Brain API returned HTTP ${response.status} with invalid JSON.`,
    );
  }
  return {
    exitCode: successfulApiBody(response, body) ? 0 : 1,
    stdout: `${JSON.stringify(body, null, 2)}\n`,
    stderr: "",
  };
};

export const callApi = async ({
  config,
  fetcher,
  operationId,
  input,
  idempotencyKey,
}: ApiRequest): Promise<CliResult> => {
  const apiKey = config.apiKey;
  if (!apiKey)
    return failure(
      `No API key is configured. Create one at ${apiKeySettingsUrl(config)} and rerun setup.`,
    );
  try {
    const response = await fetcher(`${config.apiUrl}/api/${operationId}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceSlug: config.workspaceSlug,
        input,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    return await apiResponseResult(response, apiKey);
  } catch {
    return failure("Could not reach Maestro Brain (network error or timeout).");
  }
};

export const callMcp = async (
  config: BrainConfig,
  fetcher: typeof fetch,
  method: "initialize" | "tools/list" | "prompts/list",
): Promise<CliResult> => {
  if (!config.apiKey) return failure("No API key is configured.");
  const params =
    method === "initialize"
      ? {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "maestro-brain-cli", version: "0.1.0" },
        }
      : {};
  try {
    const response = await fetcher(`${config.apiUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const text = redacted(await response.text(), config.apiKey);
    return response.ok
      ? success({ ok: true, method, response: text })
      : failure(`HTTP MCP ${method} failed with HTTP ${response.status}.`);
  } catch {
    return failure(`HTTP MCP ${method} could not reach ${config.apiUrl}/mcp.`);
  }
};
