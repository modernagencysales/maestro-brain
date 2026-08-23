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
import { brainApiOrigin } from "./remoteSafety";
import { setupOutput } from "./setupOutput";
import type { CliResult } from "./types";

export { doctorBrainEnvironment } from "./environmentDoctor";

export { brainApiOrigin } from "./remoteSafety";

type SetupStatus = "created" | "updated" | "unchanged" | "conflict";

type SetupArtifact = {
  readonly id: string;
  readonly path: string;
  readonly status: SetupStatus;
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
    ...generatedFiles(origin, runtime).map((file) =>
      installSetupFile(repoRoot, origin, file),
    ),
    ...(runtime === "all" || runtime === "codex"
      ? [installSkillLink(repoRoot, ".agents/skills/ask-apero")]
      : []),
    ...(runtime === "all" || runtime === "claude-code"
      ? [installSkillLink(repoRoot, ".claude/skills/ask-apero")]
      : []),
  ];
  const ok = artifacts.every(({ status }) => status !== "conflict");
  return setupOutput(ok, artifacts);
};
