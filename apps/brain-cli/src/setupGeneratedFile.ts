import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mergeCodexMcpBlock } from "./setupCodexConfig.js";

export type SetupArtifact = {
  readonly path: string;
  readonly status: "created" | "updated" | "unchanged" | "conflict";
};

const artifact = (
  path: string,
  status: SetupArtifact["status"],
): SetupArtifact => ({ path, status });

type UpdateInput = {
  readonly destination: string;
  readonly path: string;
  readonly current: string;
  readonly content: string;
  readonly commit: boolean;
};

const createGenerated = (
  destination: string,
  path: string,
  content: string,
  commit: boolean,
): SetupArtifact => {
  if (commit) {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content, { encoding: "utf8", mode: 0o600 });
  }
  return artifact(path, "created");
};

const updateCodexConfig = (input: UpdateInput): SetupArtifact => {
  const merged = mergeCodexMcpBlock(input.current, input.content);
  if (input.commit && merged.changed)
    writeFileSync(input.destination, merged.content, "utf8");
  return artifact(input.path, merged.changed ? "updated" : "unchanged");
};

const parsedObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

const updateClaudeMcpConfig = (input: UpdateInput): SetupArtifact => {
  try {
    const parsed = parsedObject(JSON.parse(input.current));
    const servers = parsedObject(parsed.mcpServers);
    if (servers["maestro-brain"] !== undefined)
      return artifact(input.path, "conflict");
    const expected = parsedObject(JSON.parse(input.content));
    const expectedServers = parsedObject(expected.mcpServers);
    if (input.commit)
      writeFileSync(
        input.destination,
        `${JSON.stringify({ ...parsed, mcpServers: { ...servers, ...expectedServers } }, null, 2)}\n`,
        "utf8",
      );
    return artifact(input.path, "updated");
  } catch {
    return artifact(input.path, "conflict");
  }
};

const updateGenerated = (
  destination: string,
  path: string,
  content: string,
  commit: boolean,
): SetupArtifact => {
  const current = readFileSync(destination, "utf8");
  if (current === content) return artifact(path, "unchanged");
  const input = { destination, path, current, content, commit };
  if (path === ".codex/config.toml") return updateCodexConfig(input);
  if (path === ".mcp.json") return updateClaudeMcpConfig(input);
  return artifact(path, "conflict");
};

export const writeGenerated = (
  root: string,
  path: string,
  content: string,
  commit = true,
): SetupArtifact => {
  const destination = join(root, path);
  const stat = lstatSync(destination, { throwIfNoEntry: false });
  if (stat === undefined)
    return createGenerated(destination, path, content, commit);
  return stat.isFile()
    ? updateGenerated(destination, path, content, commit)
    : artifact(path, "conflict");
};
