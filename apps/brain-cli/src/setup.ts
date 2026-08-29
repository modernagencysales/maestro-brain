import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { CliResult } from "./api.js";
import { success } from "./api.js";
import type { BrainConfig } from "./config.js";
import { apiKeySettingsUrl, writeConfig } from "./config.js";

type Artifact = {
  readonly path: string;
  readonly status: "created" | "updated" | "unchanged" | "conflict";
};

const MANAGED_ASK_APERO_SKILL_MANIFESTS = new Set([
  [
    "SKILL.md:10e9cfc71c467728f5970744b5d13556fbef8bc06663f091fd3c83d53e03ba2b",
    "references/agent-guidance.md:d6ef63473cf462d10a39e044e25a4e639464feb11248f1db7b89c6f43aa13af6",
    "references/context-pack-v3.md:6a40fbd41df87a47af252fd6de607466473a7f2e0345d50060a8c8fb6fb7cf46",
    "references/glossary.md:d0be9d876579ca1ab16b5e21567cbcd634e5c3394419bbe05fb2039f1dc7c8cc",
    "references/source-map.v1.json:c1f063a31521355343ce7d762cc2cde336a3b57698b7a6476e6ffb3fbff82f0c",
  ].join("\n"),
  "SKILL.md:f1fa5886d77ab97f70b5827ebe19a3c7f3a44bfc390ed2b29093b97e59cdef18",
  [
    "SKILL.md:37b4607a826d61de1c2f0bf84aa7e43ff67a23861406e2d773557abfcb96aa62",
    "references/evidence-reading.md:aa0260241a97103a7f826a98f96a5f4344cb7dfd512d5bb981f7df7747bb8663",
  ].join("\n"),
]);

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const mergeCodexMcpBlock = (
  current: string,
  expectedBlock: string,
): { readonly content: string; readonly changed: boolean } => {
  const managedHeader =
    /^[ \t]*\[mcp_servers\.maestro_brain\][ \t]*(?:#.*)?$/mu.exec(current);
  if (managedHeader === null)
    return {
      content: `${current.trimEnd()}\n\n${expectedBlock}`,
      changed: true,
    };
  const start = managedHeader.index;
  const afterHeader = start + managedHeader[0].length;
  const nextHeaderMatch =
    /^[ \t]*\[{1,2}[^\r\n]+?\]{1,2}[ \t]*(?:#.*)?$/mu.exec(
      current.slice(afterHeader),
    );
  const end =
    nextHeaderMatch === null
      ? current.length
      : afterHeader + nextHeaderMatch.index;
  const installedBlock = current.slice(start, end).trim();
  const expected = expectedBlock.trim();
  if (installedBlock === expected) return { content: current, changed: false };
  return {
    content: `${current.slice(0, start)}${expected}${
      end === current.length ? "\n" : `\n\n${current.slice(end).trimStart()}`
    }`,
    changed: true,
  };
};

const directoryManifest = (root: string, prefix = ""): string | undefined => {
  const records: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = directoryManifest(absolute, path);
      if (nested === undefined) return undefined;
      if (nested.length > 0) records.push(nested);
    } else if (entry.isFile()) {
      records.push(`${path}:${sha256(readFileSync(absolute, "utf8"))}`);
    } else {
      return undefined;
    }
  }
  return records.join("\n");
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
  if (path === ".codex/config.toml") {
    const merged = mergeCodexMcpBlock(current, content);
    if (commit && merged.changed)
      writeFileSync(destination, merged.content, "utf8");
    return { path, status: merged.changed ? "updated" : "unchanged" };
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
      const installedSkill = readFileSync(
        join(destination, "SKILL.md"),
        "utf8",
      );
      const packagedSkill = readFileSync(join(source, "SKILL.md"), "utf8");
      if (installedSkill === packagedSkill)
        return { path, status: "unchanged" };
      if (
        !MANAGED_ASK_APERO_SKILL_MANIFESTS.has(
          directoryManifest(destination) ?? "",
        )
      )
        return { path, status: "conflict" };
      if (commit)
        cpSync(source, destination, {
          recursive: true,
          force: true,
        });
      return { path, status: "updated" };
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
