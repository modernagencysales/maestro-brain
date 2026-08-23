import { brainApiOrigin, containsTenantSelector } from "./remoteSafety";
import { formatJsonOutput } from "./result";
import type { CliResult, CliRuntimeConfig } from "./types";

type DoctorCheck = {
  readonly id:
    | "config.siteUrl"
    | "config.apiKey"
    | "api"
    | "mcp.initialize"
    | "mcp.prompts.list"
    | "mcp.tools.list";
  readonly ok: boolean;
  readonly detail: string;
  readonly status?: "valid" | "missing" | "invalid";
};

type JsonResponse = {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly failure?: string;
};

const postJson = async (
  url: string,
  apiKey: string,
  body: unknown,
  fetcher: typeof fetch,
): Promise<JsonResponse> => {
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    return await decodedJsonResponse(response);
  } catch {
    return { ok: false, failure: "Network error or timeout." };
  }
};

const decodedJsonResponse = async (
  response: Response,
): Promise<JsonResponse> => {
  try {
    const value: unknown = JSON.parse(await response.text());
    return {
      ok: response.ok,
      value,
      ...(response.ok ? {} : { failure: `HTTP ${response.status} response.` }),
    };
  } catch {
    return {
      ok: false,
      failure: `HTTP ${response.status} returned a non-JSON response.`,
    };
  }
};

const recordValue = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;

const failedCheckDetail = (label: string, response: JsonResponse): string =>
  `${label} check failed${response.failure ? `: ${response.failure}` : "."}`;

const apiCheck = async (
  origin: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<DoctorCheck> => {
  const response = await postJson(
    `${origin}/api/brain.rollout.status`,
    apiKey,
    { input: {} },
    fetcher,
  );
  const ok = response.ok && recordValue(response.value, "ok") === true;
  return {
    id: "api",
    ok,
    detail: ok
      ? "Brain API accepted the scoped credential."
      : failedCheckDetail("Brain API", response),
  };
};

const mcpResultIsValid = (
  method: "initialize" | "prompts/list",
  value: unknown,
): boolean => {
  const result = recordValue(value, "result");
  if (method === "initialize")
    return (
      typeof recordValue(result, "protocolVersion") === "string" &&
      typeof recordValue(result, "serverInfo") === "object"
    );
  const prompts = recordValue(result, "prompts");
  return (
    Array.isArray(prompts) &&
    prompts.some((prompt) => recordValue(prompt, "name") === "ask-apero")
  );
};

const mcpSuccessDetail = (method: "initialize" | "prompts/list"): string =>
  method === "initialize"
    ? "MCP initialize succeeded (catalog reachability does not validate the credential)."
    : "MCP prompt catalog is available (tool calls still require a valid credential).";

const mcpCheck = async ({
  id,
  method,
  origin,
  apiKey,
  fetcher,
}: {
  readonly id: "mcp.initialize" | "mcp.prompts.list";
  readonly method: "initialize" | "prompts/list";
  readonly origin: string;
  readonly apiKey: string;
  readonly fetcher: typeof fetch;
}): Promise<DoctorCheck> => {
  const response = await postJson(
    `${origin}/mcp`,
    apiKey,
    {
      jsonrpc: "2.0",
      id: id === "mcp.initialize" ? 1 : 2,
      method,
      ...(method === "initialize"
        ? {
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "maestro-brain-doctor", version: "1.0.0" },
            },
          }
        : {}),
    },
    fetcher,
  );
  const ok =
    response.ok &&
    recordValue(response.value, "jsonrpc") === "2.0" &&
    mcpResultIsValid(method, response.value);
  return {
    id,
    ok,
    detail: ok ? mcpSuccessDetail(method) : failedCheckDetail(method, response),
  };
};

const requiredBrainTools = new Set([
  "template.brain.answers.ask",
  "template.brain.context.get",
  "template.brain.sources.search",
  "template.brain.sources.get",
]);

const toolCatalog = (value: unknown) => {
  const tools = recordValue(recordValue(value, "result"), "tools");
  const records = Array.isArray(tools) ? tools : [];
  const names = new Set(
    records
      .map((tool) => recordValue(tool, "name"))
      .filter((name): name is string => typeof name === "string"),
  );
  return {
    records,
    missing: [...requiredBrainTools].filter((name) => !names.has(name)),
    unsafe: records.some((tool) =>
      containsTenantSelector(recordValue(tool, "inputSchema")),
    ),
  };
};

const toolFailureDetail = (
  response: JsonResponse,
  catalog: ReturnType<typeof toolCatalog>,
): string => {
  if (response.failure)
    return `MCP tools/list check failed: ${response.failure}`;
  if (catalog.unsafe)
    return "MCP tool schemas expose a forbidden tenant selector.";
  return `MCP tool catalog is missing: ${catalog.missing.join(", ") || "valid tools/list response"}.`;
};

const mcpToolsCheck = async (
  origin: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<DoctorCheck> => {
  const response = await postJson(
    `${origin}/mcp`,
    apiKey,
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    fetcher,
  );
  const catalog = toolCatalog(response.value);
  const ok = response.ok && catalog.missing.length === 0 && !catalog.unsafe;
  return {
    id: "mcp.tools.list",
    ok,
    detail: ok
      ? `MCP exposes ${catalog.records.length} scoped tools with no tenant selectors.`
      : toolFailureDetail(response, catalog),
  };
};

const valueStatus = (
  value: string | undefined,
  isValid: (present: string) => boolean,
): "valid" | "missing" | "invalid" => {
  if (value === undefined || value.length === 0) return "missing";
  return isValid(value) ? "valid" : "invalid";
};

const configChecks = (
  siteStatus: "valid" | "missing" | "invalid",
  keyStatus: "valid" | "missing" | "invalid",
): DoctorCheck[] => [
  {
    id: "config.siteUrl",
    ok: siteStatus === "valid",
    status: siteStatus,
    detail:
      siteStatus === "valid"
        ? "CONVEX_SITE_URL is a valid origin."
        : `CONVEX_SITE_URL is ${siteStatus}.`,
  },
  {
    id: "config.apiKey",
    ok: keyStatus === "valid",
    status: keyStatus,
    detail:
      keyStatus === "valid"
        ? "MAESTRO_BRAIN_API_KEY is present and syntactically valid; API acceptance is checked below."
        : `MAESTRO_BRAIN_API_KEY is ${keyStatus}.`,
  },
];

const doctorResult = (checks: readonly DoctorCheck[]): CliResult => {
  const ok = checks.every((check) => check.ok);
  return {
    exitCode: ok ? 0 : 1,
    stdout: formatJsonOutput({
      ok,
      checks,
      next: ok
        ? ["pnpm brain health", 'pnpm brain ask "What is our ICP?"']
        : ["Fix the failed check shown above.", "Rerun pnpm brain doctor."],
    }),
    stderr: "",
  };
};

export const doctorBrainEnvironment = async (
  config: CliRuntimeConfig,
  fetcher: typeof fetch = fetch,
): Promise<CliResult> => {
  const origin = brainApiOrigin(config.brainSiteUrl);
  const apiKey = config.brainApiKey;
  const siteStatus = valueStatus(
    config.brainSiteUrl,
    () => origin !== undefined,
  );
  const keyStatus = valueStatus(apiKey, (value) => value.trim() === value);
  const initialChecks = configChecks(siteStatus, keyStatus);
  if (origin === undefined || apiKey === undefined || keyStatus !== "valid")
    return {
      exitCode: 1,
      stdout: formatJsonOutput({
        ok: false,
        checks: initialChecks,
        next: "Export the missing value(s), use an HTTPS origin with no path, then rerun pnpm brain doctor.",
      }),
      stderr: "",
    };
  return doctorResult([
    ...initialChecks,
    await apiCheck(origin, apiKey, fetcher),
    await mcpCheck({
      id: "mcp.initialize",
      method: "initialize",
      origin,
      apiKey,
      fetcher,
    }),
    await mcpCheck({
      id: "mcp.prompts.list",
      method: "prompts/list",
      origin,
      apiKey,
      fetcher,
    }),
    await mcpToolsCheck(origin, apiKey, fetcher),
  ]);
};
