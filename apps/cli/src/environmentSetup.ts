import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { formatJsonOutput } from "./result";
import { brainApiOrigin } from "./remoteSafety";
import { setupOutput, type SetupArtifact } from "./setupOutput";
import { installSkillDirectory } from "./skillInstaller";
import type { CliResult } from "./types";

export { doctorBrainEnvironment } from "./environmentDoctor";

export { brainApiOrigin } from "./remoteSafety";

type SetupStatus = "created" | "updated" | "unchanged" | "conflict";

const secretEnvName = "MAESTRO_BRAIN_API_KEY";

const setupFileIdForRuntime = (
  runtime: Exclude<SetupRuntime, "all">,
): "codex.config" | "claude-code.config" | "cowork.descriptor" => {
  if (runtime === "codex") return "codex.config";
  if (runtime === "claude-code") return "claude-code.config";
  return "cowork.descriptor";
};

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
    : files.filter(({ id }) => id === setupFileIdForRuntime(runtime));
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

type PreparedConfigFile =
  | { readonly done: true; readonly artifact: SetupArtifact }
  | {
      readonly done: false;
      readonly destination: string;
      readonly current: string;
    };

const prepareConfigFile = (
  repoRoot: string,
  file: ReturnType<typeof generatedFiles>[number],
): PreparedConfigFile => {
  const destination = join(repoRoot, file.path);
  if (!pathExists(destination))
    return { done: true, artifact: writeNewFile(repoRoot, file) };
  if (!lstatSync(destination).isFile())
    return {
      done: true,
      artifact: { id: file.id, path: file.path, status: "conflict" },
    };
  return {
    done: false,
    destination,
    current: readFileSync(destination, "utf8"),
  };
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

const codexConfigStatus = (
  current: string,
  mcpUrl: string,
): SetupStatus | undefined => {
  const entry = codexEntry(current);
  if (entry === undefined)
    return hasCodexEntry(current) ? "conflict" : undefined;
  return tomlSettingMatches(entry, "url", JSON.stringify(mcpUrl)) &&
    tomlSettingMatches(
      entry,
      "bearer_token_env_var",
      JSON.stringify(secretEnvName),
    )
    ? "unchanged"
    : "conflict";
};

const installCodexConfig = (
  repoRoot: string,
  file: ReturnType<typeof generatedFiles>[number],
  mcpUrl: string,
): SetupArtifact => {
  const prepared = prepareConfigFile(repoRoot, file);
  if (prepared.done) return prepared.artifact;
  const status = codexConfigStatus(prepared.current, mcpUrl);
  if (status !== undefined) return { id: file.id, path: file.path, status };

  const separator =
    prepared.current.length === 0
      ? ""
      : prepared.current.endsWith("\n")
        ? "\n"
        : "\n\n";
  writeFileSync(
    prepared.destination,
    `${prepared.current}${separator}${file.content}`,
    "utf8",
  );
  return { id: file.id, path: file.path, status: "updated" };
};

const claudeServerMatches = (value: unknown, mcpUrl: string): boolean =>
  isRecord(value) &&
  isRecord(value.headers) &&
  value.type === "http" &&
  value.url === mcpUrl &&
  value.headers.Authorization === `Bearer \${${secretEnvName}}`;

type ClaudeConfig = {
  readonly parsed: Record<string, unknown>;
  readonly servers: Record<string, unknown>;
};

const parseClaudeConfig = (current: string): ClaudeConfig | undefined => {
  try {
    const parsed: unknown = JSON.parse(current);
    if (!isRecord(parsed)) return undefined;
    const currentServers = parsed.mcpServers;
    if (currentServers !== undefined && !isRecord(currentServers))
      return undefined;
    return { parsed, servers: currentServers ?? {} };
  } catch {
    return undefined;
  }
};

const existingClaudeConfigStatus = (
  servers: Record<string, unknown>,
  mcpUrl: string,
): SetupStatus | undefined => {
  if (!Object.hasOwn(servers, "maestro-brain")) return undefined;
  return claudeServerMatches(servers["maestro-brain"], mcpUrl)
    ? "unchanged"
    : "conflict";
};

const installClaudeConfig = (
  repoRoot: string,
  file: ReturnType<typeof generatedFiles>[number],
  mcpUrl: string,
): SetupArtifact => {
  const prepared = prepareConfigFile(repoRoot, file);
  if (prepared.done) return prepared.artifact;
  const config = parseClaudeConfig(prepared.current);
  if (config === undefined)
    return { id: file.id, path: file.path, status: "conflict" };
  const status = existingClaudeConfigStatus(config.servers, mcpUrl);
  if (status !== undefined) return { id: file.id, path: file.path, status };
  const expected = JSON.parse(file.content) as {
    readonly mcpServers: Record<string, unknown>;
  };
  writeFileSync(
    prepared.destination,
    formatJsonOutput({
      ...config.parsed,
      mcpServers: {
        ...config.servers,
        "maestro-brain": expected.mcpServers["maestro-brain"],
      },
    }),
    "utf8",
  );
  return { id: file.id, path: file.path, status: "updated" };
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

const installSkill = (
  repoRoot: string,
  skillSourceDirectory: string,
  discoveryPath: string,
): SetupArtifact => {
  return installSkillDirectory({
    source: skillSourceDirectory,
    destination: join(repoRoot, discoveryPath),
    artifactPath: discoveryPath,
  });
};

export type SetupRuntime = "all" | "codex" | "claude-code" | "cowork";

const installSetupFile = (
  repoRoot: string,
  origin: string,
  file: ReturnType<typeof generatedFiles>[number],
): SetupArtifact => {
  const mcpUrl = `${origin}/mcp`;
  if (file.id === "codex.config")
    return installCodexConfig(repoRoot, file, mcpUrl);
  if (file.id === "claude-code.config")
    return installClaudeConfig(repoRoot, file, mcpUrl);
  return installGeneratedFile(repoRoot, file);
};

export const setupBrainEnvironment = ({
  repoRoot,
  siteUrl,
  runtime = "all",
  skillSourceDirectory = join(repoRoot, "company-context/skills/ask-apero"),
}: {
  readonly repoRoot: string;
  readonly siteUrl: string | undefined;
  readonly runtime?: SetupRuntime;
  readonly skillSourceDirectory?: string;
}): CliResult => {
  if (!pathExists(repoRoot) || !lstatSync(repoRoot).isDirectory()) {
    return {
      exitCode: 1,
      stdout: formatJsonOutput({
        ok: false,
        error: `Setup target is not an existing directory: ${repoRoot}`,
      }),
      stderr: "",
    };
  }
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
    ...generatedFiles(origin, runtime).map((file) =>
      installSetupFile(repoRoot, origin, file),
    ),
    ...(runtime === "all" || runtime === "codex"
      ? [
          installSkill(
            repoRoot,
            skillSourceDirectory,
            ".agents/skills/ask-apero",
          ),
        ]
      : []),
    ...(runtime === "all" || runtime === "claude-code"
      ? [
          installSkill(
            repoRoot,
            skillSourceDirectory,
            ".claude/skills/ask-apero",
          ),
        ]
      : []),
  ];
  const ok = artifacts.every(({ status }) => status !== "conflict");
  return setupOutput(ok, repoRoot, artifacts);
};
