import { parseNamedArgs } from "./namedArgs";
import { containsTenantSelector } from "./remoteSafety";
import { cliFailure } from "./result";
import type { CliResult } from "./types";

export type McpResultKind = "tools" | "prompts" | "call";
export type McpCommand =
  | {
      readonly ok: true;
      readonly kind: McpResultKind;
      readonly request: Readonly<Record<string, unknown>>;
    }
  | { readonly ok: false; readonly result: CliResult };

const usageResult = cliFailure(
  "mcp usage: mcp tools | mcp prompts | mcp call <tool-name> [--input <json>].\n",
);
const listCommands = {
  tools: {
    ok: true,
    kind: "tools",
    request: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  },
  prompts: {
    ok: true,
    kind: "prompts",
    request: { jsonrpc: "2.0", id: 1, method: "prompts/list" },
  },
} as const satisfies Record<"tools" | "prompts", McpCommand>;

const failedCommand = (result: CliResult): McpCommand => ({
  ok: false,
  result,
});

const invalidCallInput = (
  input: Record<string, unknown>,
  unsupported: Readonly<Record<string, unknown>>,
): CliResult | undefined => {
  if (Object.keys(unsupported).length > 0)
    return cliFailure("mcp call accepts only --input <json>.\n");
  return containsTenantSelector(input)
    ? cliFailure("Brain scope must be derived from MAESTRO_BRAIN_API_KEY.\n")
    : undefined;
};

const mcpCallRequest = (argv: readonly string[]): McpCommand => {
  if (argv[1] !== "call" || !argv[2]) return failedCommand(usageResult);
  const parsed = parseNamedArgs(argv.slice(3));
  if (!parsed.ok) return failedCommand(cliFailure(`${parsed.message}\n`));
  const { input = {}, ...unsupported } = parsed.args;
  const invalid = invalidCallInput(input, unsupported);
  if (invalid !== undefined) return failedCommand(invalid);
  return {
    ok: true,
    kind: "call",
    request: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: argv[2], arguments: input },
    },
  };
};

export const parseRemoteMcpCommand = (argv: readonly string[]): McpCommand => {
  if (argv[1] === "tools" && argv.length === 2) return listCommands.tools;
  if (argv[1] === "prompts" && argv.length === 2) return listCommands.prompts;
  return mcpCallRequest(argv);
};
