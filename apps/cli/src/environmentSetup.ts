import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { formatJsonOutput } from "./result";
import type { CliResult, CliRuntimeConfig } from "./types";

type SetupStatus = "created" | "updated" | "unchanged" | "conflict";

type SetupArtifact = {
  readonly id: string;
  readonly path: string;
  readonly status: SetupStatus;
};

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

const secretEnvName = "MAESTRO_BRAIN_API_KEY";

const pathExists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
};

const isMissingPathError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  Reflect.get(error, "code") === "ENOENT";

export const brainApiOrigin = (
  value: string | undefined,
): string | undefined => {
  if (value === undefined || value.trim() !== value) return undefined;
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" && url.hostname.toLowerCase() === "localhost";
    return (url.protocol === "https:" || localHttp) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
};

const generatedFiles = (origin: string, runtime: SetupRuntime) => {
  const mcpUrl = `${origin}/mcp`;
  const files = [
    {
      id: "codex.config",
      path: ".codex/config.toml",
      content: `[mcp_servers.maestro_brain]\nurl = ${JSON.stringify(mcpUrl)}\nbearer_token_env_var = ${JSON.stringify(secretEnvName)}\n`,
    },
    {
      id: "claude-code.config",
      path: ".mcp.json",
      content: formatJsonOutput({
        mcpServers: {
          "maestro-brain": {
            type: "http",
            url: mcpUrl,
            headers: {
              Authorization: `Bearer \${${secretEnvName}}`,
            },
          },
        },
      }),
    },
    {
      id: "cowork.descriptor",
      path: ".cowork/maestro-brain.json",
      content: formatJsonOutput({
        schemaVersion: 1,
        name: "maestro-brain",
        description: "Read-only Apero company Brain context.",
        transport: { type: "streamable-http", url: mcpUrl },
        authentication: { scheme: "bearer", secretEnv: secretEnvName },
      }),
    },
  ] as const;
  return runtime === "all"
    ? files
    : files.filter(({ id }) =>
        runtime === "codex"
          ? id === "codex.config"
          : runtime === "claude-code"
            ? id === "claude-code.config"
            : id === "cowork.descriptor",
      );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const writeNewFile = (
  repoRoot: string,
  file: ReturnType<typeof generatedFiles>[number],
): SetupArtifact => {
  const destination = join(repoRoot, file.path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, file.content, { encoding: "utf8", mode: 0o600 });
  return { id: file.id, path: file.path, status: "created" };
};

const codexEntry = (content: string): string | undefined => {
  const header =
    /^\s*\[\s*mcp_servers\s*\.\s*(?:"maestro_brain"|'maestro_brain'|maestro_brain)\s*\]\s*(?:#.*)?$/m;
  const match = header.exec(content);
  if (match === null) return undefined;
  const remainder = content.slice(match.index + match[0].length);
  const nextHeader = /^\s*\[/m.exec(remainder);
  return content.slice(
    match.index,
    nextHeader === null
      ? content.length
      : match.index + match[0].length + nextHeader.index,
  );
};

const tomlSettingMatches = (
  block: string,
  name: string,
  expectedValue: string,
): boolean => {
  const matches = block
    .split("\n")
    .filter((line) => new RegExp(`^\\s*${name}\\s*=`).test(line));
  return (
    matches.length === 1 &&
    matches[0]?.replace(/\s+#.*$/, "").trim() === `${name} = ${expectedValue}`
  );
};

const hasCodexEntry = (content: string): boolean =>
  /^\s*(?:\[\s*)?mcp_servers\s*\.\s*(?:"maestro_brain"|'maestro_brain'|maestro_brain)(?:\s*[\].=])/m.test(
    content,
  );

const installCodexConfig = (
  repoRoot: string,
  file: ReturnType<typeof generatedFiles>[number],
  mcpUrl: string,
): SetupArtifact => {
  const destination = join(repoRoot, file.path);
  if (!pathExists(destination)) return writeNewFile(repoRoot, file);
  if (!lstatSync(destination).isFile())
    return { id: file.id, path: file.path, status: "conflict" };

  const current = readFileSync(destination, "utf8");
  const entry = codexEntry(current);
  if (entry !== undefined) {
    const matches =
      tomlSettingMatches(entry, "url", JSON.stringify(mcpUrl)) &&
      tomlSettingMatches(
        entry,
        "bearer_token_env_var",
        JSON.stringify(secretEnvName),
      );
    return {
      id: file.id,
      path: file.path,
      status: matches ? "unchanged" : "conflict",
    };
  }
  if (hasCodexEntry(current))
    return { id: file.id, path: file.path, status: "conflict" };

  const separator =
    current.length === 0 ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(destination, `${current}${separator}${file.content}`, "utf8");
  return { id: file.id, path: file.path, status: "updated" };
};

const claudeServerMatches = (value: unknown, mcpUrl: string): boolean =>
  isRecord(value) &&
  isRecord(value.headers) &&
  value.type === "http" &&
  value.url === mcpUrl &&
  value.headers.Authorization === `Bearer \${${secretEnvName}}`;

const installClaudeConfig = (
  repoRoot: string,
  file: ReturnType<typeof generatedFiles>[number],
  mcpUrl: string,
): SetupArtifact => {
  const destination = join(repoRoot, file.path);
  if (!pathExists(destination)) return writeNewFile(repoRoot, file);
  if (!lstatSync(destination).isFile())
    return { id: file.id, path: file.path, status: "conflict" };

  try {
    const parsed: unknown = JSON.parse(readFileSync(destination, "utf8"));
    if (!isRecord(parsed)) throw new Error("invalid root");
    const currentServers = parsed.mcpServers;
    if (currentServers !== undefined && !isRecord(currentServers))
      throw new Error("invalid mcpServers");
    const servers = currentServers ?? {};
    if (Object.hasOwn(servers, "maestro-brain")) {
      return {
        id: file.id,
        path: file.path,
        status: claudeServerMatches(servers["maestro-brain"], mcpUrl)
          ? "unchanged"
          : "conflict",
      };
    }
    const expected = JSON.parse(file.content) as {
      readonly mcpServers: Record<string, unknown>;
    };
    writeFileSync(
      destination,
      formatJsonOutput({
        ...parsed,
        mcpServers: {
          ...servers,
          "maestro-brain": expected.mcpServers["maestro-brain"],
        },
      }),
      "utf8",
    );
    return { id: file.id, path: file.path, status: "updated" };
  } catch {
    return { id: file.id, path: file.path, status: "conflict" };
  }
};

const installGeneratedFile = (
  repoRoot: string,
  file: ReturnType<typeof generatedFiles>[number],
): SetupArtifact => {
  const destination = join(repoRoot, file.path);
  if (pathExists(destination)) {
    if (!lstatSync(destination).isFile())
      return { id: file.id, path: file.path, status: "conflict" };
    const existing = readFileSync(destination, "utf8");
    if (existing === file.content)
      return { id: file.id, path: file.path, status: "unchanged" };
    return { id: file.id, path: file.path, status: "conflict" };
  }
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, file.content, { encoding: "utf8", mode: 0o600 });
  return { id: file.id, path: file.path, status: "created" };
};

const installSkillLink = (
  repoRoot: string,
  discoveryPath: string,
): SetupArtifact => {
  const source = join(repoRoot, "company-context/skills/ask-apero");
  const destination = join(repoRoot, discoveryPath);
  if (!pathExists(source)) {
    return { id: "ask-apero.skill", path: discoveryPath, status: "conflict" };
  }
  if (pathExists(destination)) {
    const matches =
      lstatSync(destination).isSymbolicLink() &&
      resolve(dirname(destination), readlinkSync(destination)) === source;
    return {
      id: "ask-apero.skill",
      path: discoveryPath,
      status: matches ? "unchanged" : "conflict",
    };
  }
  mkdirSync(dirname(destination), { recursive: true });
  symlinkSync(relative(dirname(destination), source), destination, "dir");
  return { id: "ask-apero.skill", path: discoveryPath, status: "created" };
};

export type SetupRuntime = "all" | "codex" | "claude-code" | "cowork";

export const setupBrainEnvironment = ({
  repoRoot,
  siteUrl,
  runtime = "all",
}: {
  readonly repoRoot: string;
  readonly siteUrl: string | undefined;
  readonly runtime?: SetupRuntime;
}): CliResult => {
  const origin = brainApiOrigin(siteUrl);
  if (origin === undefined) {
    return {
      exitCode: 1,
      stdout: formatJsonOutput({
        ok: false,
        error:
          "CONVEX_SITE_URL must be an HTTPS origin without credentials, path, query, or fragment.",
      }),
      stderr: "",
    };
  }
  const artifacts = [
    ...generatedFiles(origin, runtime).map((file) => {
      const mcpUrl = `${origin}/mcp`;
      if (file.id === "codex.config")
        return installCodexConfig(repoRoot, file, mcpUrl);
      if (file.id === "claude-code.config")
        return installClaudeConfig(repoRoot, file, mcpUrl);
      return installGeneratedFile(repoRoot, file);
    }),
    ...(runtime === "all" || runtime === "codex"
      ? [installSkillLink(repoRoot, ".agents/skills/ask-apero")]
      : []),
    ...(runtime === "all" || runtime === "claude-code"
      ? [installSkillLink(repoRoot, ".claude/skills/ask-apero")]
      : []),
  ];
  const ok = artifacts.every(({ status }) => status !== "conflict");
  return {
    exitCode: ok ? 0 : 1,
    stdout: formatJsonOutput({ ok, artifacts }),
    stderr: "",
  };
};

const postJson = async (
  url: string,
  apiKey: string,
  body: unknown,
  fetcher: typeof fetch,
): Promise<{ readonly ok: boolean; readonly value?: unknown }> => {
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
    const value: unknown = await response.json();
    return { ok: response.ok, value };
  } catch {
    return { ok: false };
  }
};

const recordValue = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;

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
      : "Brain API check failed.",
  };
};

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
  const result = recordValue(response.value, "result");
  const prompts = recordValue(result, "prompts");
  const validResult =
    method === "initialize"
      ? typeof recordValue(result, "protocolVersion") === "string" &&
        typeof recordValue(result, "serverInfo") === "object"
      : Array.isArray(prompts) &&
        prompts.some((prompt) => recordValue(prompt, "name") === "ask-apero");
  const ok =
    response.ok &&
    recordValue(response.value, "jsonrpc") === "2.0" &&
    validResult;
  return {
    id,
    ok,
    detail: ok
      ? method === "initialize"
        ? "MCP initialize succeeded."
        : "MCP prompt catalog is available."
      : `${method} check failed.`,
  };
};

const tenantSelectorNames = new Set([
  "organizationId",
  "organizationKey",
  "agencyKey",
  "workspaceId",
  "workspaceKey",
  "workspaceSlug",
  "brainId",
  "brainKey",
  "userId",
  "memberId",
  "keyId",
  "apiKeyId",
]);

const containsTenantSelector = (value: unknown): boolean => {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsTenantSelector);
  return Object.entries(value).some(
    ([key, nested]) =>
      tenantSelectorNames.has(key) || containsTenantSelector(nested),
  );
};

const requiredBrainTools = new Set([
  "template.brain.answers.ask",
  "template.brain.context.get",
  "template.brain.sources.search",
  "template.brain.sources.get",
]);

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
  const tools = recordValue(recordValue(response.value, "result"), "tools");
  const toolRecords = Array.isArray(tools) ? tools : [];
  const names = new Set(
    toolRecords
      .map((tool) => recordValue(tool, "name"))
      .filter((name): name is string => typeof name === "string"),
  );
  const missing = [...requiredBrainTools].filter((name) => !names.has(name));
  const unsafe = toolRecords.some((tool) =>
    containsTenantSelector(recordValue(tool, "inputSchema")),
  );
  const ok = response.ok && missing.length === 0 && !unsafe;
  return {
    id: "mcp.tools.list",
    ok,
    detail: ok
      ? `MCP exposes ${toolRecords.length} scoped tools with no tenant selectors.`
      : unsafe
        ? "MCP tool schemas expose a forbidden tenant selector."
        : `MCP tool catalog is missing: ${missing.join(", ") || "valid tools/list response"}.`,
  };
};

export const doctorBrainEnvironment = async (
  config: CliRuntimeConfig,
  fetcher: typeof fetch = fetch,
): Promise<CliResult> => {
  const origin = brainApiOrigin(config.brainSiteUrl);
  const apiKey = config.brainApiKey;
  const siteStatus =
    config.brainSiteUrl === undefined
      ? "missing"
      : origin === undefined
        ? "invalid"
        : "valid";
  const keyStatus =
    apiKey === undefined || apiKey.length === 0
      ? "missing"
      : apiKey.trim() !== apiKey
        ? "invalid"
        : "valid";
  const configChecks: DoctorCheck[] = [
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
          ? "MAESTRO_BRAIN_API_KEY is set."
          : `MAESTRO_BRAIN_API_KEY is ${keyStatus}.`,
    },
  ];
  if (
    origin === undefined ||
    apiKey === undefined ||
    apiKey.length === 0 ||
    apiKey.trim() !== apiKey
  ) {
    return {
      exitCode: 1,
      stdout: formatJsonOutput({
        ok: false,
        checks: configChecks,
        next: "Export the missing value(s), use an HTTPS origin with no path, then rerun pnpm brain doctor.",
      }),
      stderr: "",
    };
  }

  const checks = [
    ...configChecks,
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
  ];
  const ok = checks.every((check) => check.ok);
  return {
    exitCode: ok ? 0 : 1,
    stdout: formatJsonOutput({ ok, checks }),
    stderr: "",
  };
};
