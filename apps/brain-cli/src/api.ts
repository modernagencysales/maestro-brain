import { apiKeySettingsUrl, type BrainConfig } from "./config.js";
import { cliVersion } from "./version.js";

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

const exitCodeForTag = (tag: string | undefined): number => {
  if (tag === "Unauthorized" || tag === "Forbidden") return 2;
  if (tag === "StaleRevision" || tag === "Conflict") return 3;
  if (tag === "NotFound" || tag === "EvidenceInaccessible") return 4;
  if (
    tag === "ProviderFailure" ||
    tag === "ProviderUnavailable" ||
    tag === "ToolExecutionFailed"
  )
    return 5;
  return 1;
};

const errorTagFrom = (value: unknown): string | undefined =>
  value !== null &&
  typeof value === "object" &&
  "error" in value &&
  value.error !== null &&
  typeof value.error === "object" &&
  "_tag" in value.error &&
  typeof value.error._tag === "string"
    ? value.error._tag
    : undefined;

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
  const ok = successfulApiBody(response, body);
  const errorTag =
    !ok &&
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    body.error !== null &&
    typeof body.error === "object" &&
    "_tag" in body.error &&
    typeof body.error._tag === "string"
      ? ` (${body.error._tag})`
      : "";
  const tag = errorTag === "" ? undefined : errorTag.slice(2, -1);
  return {
    exitCode: ok ? 0 : exitCodeForTag(tag),
    stdout: `${JSON.stringify(body, null, 2)}\n`,
    stderr: ok
      ? ""
      : `Brain API request failed with HTTP ${response.status}${errorTag}.\n`,
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
          clientInfo: { name: "maestro-brain-cli", version: cliVersion },
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
    if (!response.ok)
      return failure(`HTTP MCP ${method} failed with HTTP ${response.status}.`);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return failure(`HTTP MCP ${method} returned invalid JSON.`);
    }
    if (
      body === null ||
      typeof body !== "object" ||
      !("jsonrpc" in body) ||
      body.jsonrpc !== "2.0" ||
      "error" in body ||
      !("result" in body)
    )
      return failure(`HTTP MCP ${method} returned a JSON-RPC error.`);
    if (
      method === "initialize" &&
      (body.result === null ||
        typeof body.result !== "object" ||
        !("protocolVersion" in body.result) ||
        body.result.protocolVersion !== "2025-03-26")
    )
      return failure("HTTP MCP server negotiated an incompatible protocol.");
    return success({ ok: true, method, response: body });
  } catch {
    return failure(`HTTP MCP ${method} could not reach ${config.apiUrl}/mcp.`);
  }
};

export const callMcpTool = async (
  config: BrainConfig,
  fetcher: typeof fetch,
  name: string,
  args: Record<string, unknown>,
): Promise<CliResult> => {
  if (!config.apiKey) return failure("No API key is configured.");
  try {
    const response = await fetcher(`${config.apiUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const text = redacted(await response.text(), config.apiKey);
    if (!response.ok)
      return failure(`HTTP MCP tool call failed with HTTP ${response.status}.`);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return failure("HTTP MCP tool call returned invalid JSON.");
    }
    if (
      body === null ||
      typeof body !== "object" ||
      !("result" in body) ||
      body.result === null ||
      typeof body.result !== "object" ||
      !("content" in body.result) ||
      !Array.isArray(body.result.content)
    )
      return failure("HTTP MCP tool call returned a JSON-RPC error.");
    const textBlock = body.result.content.find(
      (candidate): candidate is { type: "text"; text: string } =>
        candidate !== null &&
        typeof candidate === "object" &&
        "type" in candidate &&
        candidate.type === "text" &&
        "text" in candidate &&
        typeof candidate.text === "string",
    );
    if (textBlock === undefined)
      return failure("HTTP MCP tool call returned no text result.");
    let payload: unknown;
    try {
      payload = JSON.parse(textBlock.text);
    } catch {
      return failure("HTTP MCP tool call returned invalid tool JSON.");
    }
    if (
      payload === null ||
      typeof payload !== "object" ||
      !("ok" in payload) ||
      payload.ok !== true
    )
      return {
        exitCode: exitCodeForTag(errorTagFrom(payload)),
        stdout: `${JSON.stringify(payload, null, 2)}\n`,
        stderr: "",
      };
    return success(payload);
  } catch {
    return failure(`HTTP MCP tool call could not reach ${config.apiUrl}/mcp.`);
  }
};
