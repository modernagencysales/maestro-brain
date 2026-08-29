import { resolve } from "node:path";
import type { CliResult } from "./api.js";
import { success } from "./api.js";
import type { BrainConfig } from "./config.js";
import { apiKeySettingsUrl, writeConfig } from "./config.js";
import { writeGenerated, type SetupArtifact } from "./setupGeneratedFile.js";
import { installSkill } from "./setupSkill.js";

export const setupProject = (input: {
  readonly root: string;
  readonly configDirectory: string;
  readonly assetDirectory: string;
  readonly config: BrainConfig;
}): CliResult => {
  const root = resolve(input.root);
  const mcpUrl = `${input.config.apiUrl}/mcp`;
  const bearerTemplate = "Bearer ${MAESTRO_BRAIN_API_KEY}";
  const projectArtifacts = (commit: boolean): SetupArtifact[] => [
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
