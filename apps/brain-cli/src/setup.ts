import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CliResult } from "./api.js";
import { success } from "./api.js";
import type { BrainConfig } from "./config.js";
import { apiKeySettingsUrl, writeConfig } from "./config.js";

type Artifact = {
  readonly path: string;
  readonly status: "created" | "updated" | "unchanged" | "conflict";
};

const writeGenerated = (
  root: string,
  path: string,
  content: string,
  commit = true,
): Artifact => {
  const destination = join(root, path);
  const stat = lstatSync(destination, { throwIfNoEntry: false });
  if (stat === undefined) {
    if (commit) {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content, { encoding: "utf8", mode: 0o600 });
    }
    return { path, status: "created" };
  }
  if (!stat.isFile()) return { path, status: "conflict" };
  const current = readFileSync(destination, "utf8");
  if (current === content) return { path, status: "unchanged" };
  if (
    path === ".codex/config.toml" &&
    !current.includes("[mcp_servers.maestro_brain]")
  ) {
    if (commit)
      writeFileSync(destination, `${current.trimEnd()}\n\n${content}`, "utf8");
    return { path, status: "updated" };
  }
  if (path === ".mcp.json") {
    try {
      const parsed = JSON.parse(current) as Record<string, unknown>;
      const servers =
        parsed.mcpServers !== null && typeof parsed.mcpServers === "object"
          ? (parsed.mcpServers as Record<string, unknown>)
          : {};
      if (servers["maestro-brain"] !== undefined)
        return { path, status: "conflict" };
      const expected = JSON.parse(content) as {
        mcpServers: Record<string, unknown>;
      };
      if (commit)
        writeFileSync(
          destination,
          `${JSON.stringify({ ...parsed, mcpServers: { ...servers, ...expected.mcpServers } }, null, 2)}\n`,
          "utf8",
        );
      return { path, status: "updated" };
    } catch {
      return { path, status: "conflict" };
    }
  }
  return { path, status: "conflict" };
};

const installSkill = (
  root: string,
  path: string,
  source: string,
  commit = true,
): Artifact => {
  const destination = join(root, path);
  const stat = lstatSync(destination, { throwIfNoEntry: false });
  if (stat !== undefined) {
    if (!stat.isDirectory()) return { path, status: "conflict" };
    try {
      return readFileSync(join(destination, "SKILL.md"), "utf8") ===
        readFileSync(join(source, "SKILL.md"), "utf8")
        ? { path, status: "unchanged" }
        : { path, status: "conflict" };
    } catch {
      return { path, status: "conflict" };
    }
  }
  if (commit) {
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, errorOnExist: true });
  }
  return { path, status: "created" };
};

export const setupProject = (input: {
  readonly root: string;
  readonly configDirectory: string;
  readonly assetDirectory: string;
  readonly config: BrainConfig;
}): CliResult => {
  const root = resolve(input.root);
  const mcpUrl = `${input.config.apiUrl}/mcp`;
  const bearerTemplate = "Bearer ${MAESTRO_BRAIN_API_KEY}";
  const projectArtifacts = (commit: boolean): Artifact[] => [
    writeGenerated(
      root,
      ".codex/config.toml",
      `[mcp_servers.maestro_brain]\nurl = ${JSON.stringify(mcpUrl)}\nbearer_token_env_var = "MAESTRO_BRAIN_API_KEY"\n`,
      commit,
    ),
    writeGenerated(
      root,
      ".mcp.json",
      `${JSON.stringify({ mcpServers: { "maestro-brain": { type: "http", url: mcpUrl, headers: { Authorization: bearerTemplate } } } }, null, 2)}\n`,
      commit,
    ),
    writeGenerated(
      root,
      ".cowork/maestro-brain.json",
      `${JSON.stringify({ schemaVersion: 1, name: "maestro-brain", transport: { type: "streamable-http", url: mcpUrl }, authentication: { scheme: "bearer", secretEnv: "MAESTRO_BRAIN_API_KEY" } }, null, 2)}\n`,
      commit,
    ),
    installSkill(
      root,
      ".agents/skills/ask-apero",
      input.assetDirectory,
      commit,
    ),
    installSkill(
      root,
      ".claude/skills/ask-apero",
      input.assetDirectory,
      commit,
    ),
  ];
  const plannedArtifacts = projectArtifacts(false);
  const ok = plannedArtifacts.every(({ status }) => status !== "conflict");
  if (!ok)
    return {
      ...success({
        ok: false,
        project: root,
        artifacts: plannedArtifacts,
        next: [
          "Resolve the listed project-file conflicts, then rerun setup. No credential was stored and no project file was changed.",
        ],
      }),
      exitCode: 1,
    };
  writeConfig(input.configDirectory, input.config);
  const artifacts = projectArtifacts(true);
  const result = success({
    ok,
    project: root,
    config: {
      appUrl: input.config.appUrl,
      apiUrl: input.config.apiUrl,
      workspaceSlug: input.config.workspaceSlug,
      apiKeyPresent: Boolean(input.config.apiKey),
    },
    artifacts,
    next: [
      ...(input.config.apiKey
        ? []
        : [
            `Create a workspace API key at ${apiKeySettingsUrl(input.config)}, then rerun setup.`,
          ]),
      'Run eval "$(maestro-brain env)" once in each agent terminal.',
      "Or launch a terminal agent with maestro-brain run -- codex (or claude) so the key is injected without changing shell state.",
      "Codex or Claude will ask once to trust/approve this project's maestro-brain MCP server.",
      "For Claude Cowork, add the generated .cowork/maestro-brain.json HTTP connector in Cowork if it is not discovered automatically.",
      "Run maestro-brain doctor.",
    ],
  });
  return { ...result, exitCode: ok ? 0 : 1 };
};
