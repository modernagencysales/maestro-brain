import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  claudeServerMatches,
  codexConfigStatus,
  parseClaudeConfig,
} from "./environmentConfig";
import { formatJsonOutput } from "./result";
import { brainApiOrigin } from "./remoteSafety";
import { setupOutput, type SetupArtifact } from "./setupOutput";
import { installSkillDirectory } from "./skillInstaller";
import type { CliResult } from "./types";

export { doctorBrainEnvironment } from "./environmentDoctor";

export { brainApiOrigin } from "./remoteSafety";

const secretEnvName = "MAESTRO_BRAIN_API_KEY";

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
  const filesByRuntime: Record<
    SetupRuntime,
    readonly (typeof files)[number][]
  > = {
    all: files,
    codex: [files[0]],
    "claude-code": [files[1]],
    cowork: [files[2]],
  };
  return filesByRuntime[runtime];
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
  const destinationStat = lstatSync(destination, { throwIfNoEntry: false });
  if (destinationStat === undefined) {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.content, { encoding: "utf8", mode: 0o600 });
    return {
      done: true,
      artifact: { id: file.id, path: file.path, status: "created" },
    };
  }
  if (!destinationStat.isFile())
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

const installCodexConfig = (
  repoRoot: string,
  file: ReturnType<typeof generatedFiles>[number],
  mcpUrl: string,
): SetupArtifact => {
  const prepared = prepareConfigFile(repoRoot, file);
  if (prepared.done) return prepared.artifact;
  const status = codexConfigStatus(prepared.current, mcpUrl, secretEnvName);
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
  if (Object.hasOwn(config.servers, "maestro-brain")) {
    const status = claudeServerMatches(
      config.servers["maestro-brain"],
      mcpUrl,
      secretEnvName,
    )
      ? "unchanged"
      : "conflict";
    return { id: file.id, path: file.path, status };
  }
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
  const prepared = prepareConfigFile(repoRoot, file);
  if (prepared.done) return prepared.artifact;
  const status = prepared.current === file.content ? "unchanged" : "conflict";
  return { id: file.id, path: file.path, status };
};

export type SetupRuntime = "all" | "codex" | "claude-code" | "cowork";

const skillDiscoveryPaths: Record<SetupRuntime, readonly string[]> = {
  all: [".agents/skills/ask-apero", ".claude/skills/ask-apero"],
  codex: [".agents/skills/ask-apero"],
  "claude-code": [".claude/skills/ask-apero"],
  cowork: [],
};

const installSetupFile = (
  repoRoot: string,
  origin: string,
  file: ReturnType<typeof generatedFiles>[number],
): SetupArtifact => {
  const mcpUrl = `${origin}/mcp`;
  const installers = {
    "codex.config": () => installCodexConfig(repoRoot, file, mcpUrl),
    "claude-code.config": () => installClaudeConfig(repoRoot, file, mcpUrl),
    "cowork.descriptor": () => installGeneratedFile(repoRoot, file),
  };
  return installers[file.id]();
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
  if (lstatSync(repoRoot, { throwIfNoEntry: false })?.isDirectory() !== true) {
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
    ...skillDiscoveryPaths[runtime].map((discoveryPath) =>
      installSkillDirectory({
        source: skillSourceDirectory,
        destination: join(repoRoot, discoveryPath),
        artifactPath: discoveryPath,
      }),
    ),
  ];
  const ok = artifacts.every(({ status }) => status !== "conflict");
  return setupOutput(ok, repoRoot, artifacts);
};
