export type ClaudeConfig = {
  readonly parsed: Record<string, unknown>;
  readonly servers: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
  if (matches.length !== 1) return false;
  return (
    matches[0]?.replace(/\s+#.*$/, "").trim() === `${name} = ${expectedValue}`
  );
};

export const codexConfigStatus = (
  current: string,
  mcpUrl: string,
  secretEnvName: string,
): "unchanged" | "conflict" | undefined => {
  const entry = codexEntry(current);
  if (entry === undefined)
    return /^\s*(?:\[\s*)?mcp_servers\s*\.\s*(?:"maestro_brain"|'maestro_brain'|maestro_brain)(?:\s*[\].=])/m.test(
      current,
    )
      ? "conflict"
      : undefined;
  return [
    tomlSettingMatches(entry, "url", JSON.stringify(mcpUrl)),
    tomlSettingMatches(
      entry,
      "bearer_token_env_var",
      JSON.stringify(secretEnvName),
    ),
  ].every(Boolean)
    ? "unchanged"
    : "conflict";
};

export const claudeServerMatches = (
  value: unknown,
  mcpUrl: string,
  secretEnvName: string,
): boolean => {
  if (!isRecord(value) || !isRecord(value.headers)) return false;
  return [
    value.type === "http",
    value.url === mcpUrl,
    value.headers.Authorization === `Bearer \${${secretEnvName}}`,
  ].every(Boolean);
};

export const parseClaudeConfig = (
  current: string,
): ClaudeConfig | undefined => {
  try {
    const parsed: unknown = JSON.parse(current);
    if (!isRecord(parsed)) return undefined;
    const servers = parsed.mcpServers ?? {};
    if (!isRecord(servers)) return undefined;
    return { parsed, servers };
  } catch {
    return undefined;
  }
};
