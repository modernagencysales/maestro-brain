import { containsTenantSelector } from "./remoteSafety";
import { cliFailure, formatJsonOutput } from "./result";
import type { McpResultKind } from "./remoteMcpCommand";
import type { CliResult } from "./types";

type CatalogName = Exclude<McpResultKind, "call">;
export type JsonRpcBodyResult =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly result: CliResult };

const countKeys = {
  tools: "toolCount",
  prompts: "promptCount",
} as const satisfies Record<CatalogName, "toolCount" | "promptCount">;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";
const redactedJson = (value: unknown, apiKey: string): string =>
  formatJsonOutput(value).split(apiKey).join("[REDACTED]");

export const parseJsonRpcBody = async (
  response: Response,
): Promise<JsonRpcBodyResult> => {
  try {
    const body: unknown = JSON.parse(await response.text());
    return isRecord(body)
      ? { ok: true, body }
      : {
          ok: false,
          result: cliFailure(
            "Brain MCP returned an invalid JSON-RPC response.\n",
          ),
        };
  } catch {
    return {
      ok: false,
      result: cliFailure(
        `Brain MCP returned HTTP ${response.status} with a non-JSON response.\n`,
      ),
    };
  }
};

const embeddedToolErrorPayload = (text: string): unknown => {
  try {
    const payload: unknown = JSON.parse(text);
    return isRecord(payload) && Reflect.get(payload, "ok") === false
      ? (Reflect.get(payload, "error") ?? payload)
      : undefined;
  } catch {
    return undefined;
  }
};
const contentText = (item: unknown): readonly string[] => {
  if (!isRecord(item)) return [];
  const text = Reflect.get(item, "text");
  return typeof text === "string" ? [text] : [];
};
const embeddedToolError = (result: unknown): unknown => {
  if (!isRecord(result)) return undefined;
  const content = Reflect.get(result, "content");
  const texts = (Array.isArray(content) ? content : []).flatMap(contentText);
  const typedError = texts
    .map(embeddedToolErrorPayload)
    .find((payload: unknown) => payload !== undefined);
  if (typedError !== undefined) return typedError;
  return Reflect.get(result, "isError") === true
    ? {
        _tag: "McpToolError",
        message:
          texts.find((text) => text.trim().length > 0) ??
          "MCP tool returned an error.",
      }
    : undefined;
};

const transportErrorResult = (
  body: Record<string, unknown>,
  response: Response,
  apiKey: string,
): CliResult => ({
  exitCode: 1,
  stdout: redactedJson(
    {
      ok: false,
      transport: "streamable-http",
      error: Reflect.get(body, "error") ?? {
        code: "HTTP_ERROR",
        status: response.status,
      },
    },
    apiKey,
  ),
  stderr: "",
});
const callResult = (result: unknown, apiKey: string): CliResult => {
  const error = embeddedToolError(result);
  return {
    exitCode: error === undefined ? 0 : 1,
    stdout: redactedJson(
      error === undefined
        ? { ok: true, transport: "streamable-http", result }
        : { ok: false, transport: "streamable-http", error },
      apiKey,
    ),
    stderr: "",
  };
};
const catalogCollection = (
  result: unknown,
  kind: CatalogName,
): readonly unknown[] | undefined => {
  if (!isRecord(result)) return undefined;
  const collection = Reflect.get(result, kind);
  return Array.isArray(collection) ? collection : undefined;
};
const catalogResult = (
  result: unknown,
  kind: CatalogName,
  apiKey: string,
): CliResult => {
  const collection = catalogCollection(result, kind);
  if (collection === undefined)
    return cliFailure(`Brain MCP returned an invalid ${kind} catalog.\n`);
  const unsafe =
    kind === "tools" &&
    collection.some((tool) =>
      containsTenantSelector(
        isRecord(tool) ? Reflect.get(tool, "inputSchema") : undefined,
      ),
    );
  if (unsafe)
    return cliFailure(
      "Brain MCP tool schemas expose a forbidden tenant selector.\n",
    );
  return {
    exitCode: 0,
    stdout: redactedJson(
      {
        ok: true,
        transport: "streamable-http",
        [countKeys[kind]]: collection.length,
        [kind]: collection,
      },
      apiKey,
    ),
    stderr: "",
  };
};

export const remoteMcpResponseResult = (
  body: Record<string, unknown>,
  response: Response,
  apiKey: string,
  kind: McpResultKind,
): CliResult => {
  if (!response.ok || Reflect.get(body, "error") !== undefined)
    return transportErrorResult(body, response, apiKey);
  const result = Reflect.get(body, "result");
  return kind === "call"
    ? callResult(result, apiKey)
    : catalogResult(result, kind, apiKey);
};
