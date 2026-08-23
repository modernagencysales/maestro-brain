import { doctorBrainEnvironment } from "./environmentSetup";
import { noteInputFromArgs } from "./noteCommand";
import {
  executeRemoteBrainRequest,
  remoteBrainApiResult,
  remoteBrainConfigError,
} from "./remoteApi";
import { runRemoteMcpCommand } from "./remoteMcp";
import { cliFailure, cliSuccess, formatJsonOutput } from "./result";
import { runSnapshotSubmit } from "./snapshotCommand";
import { runSetupCommand } from "./setupCommand";
import type { CliResult, CliRuntimeConfig } from "./types";

const commandHelp: Readonly<Record<string, string>> = {
  ask: [
    "Ask a source-grounded question of the Company Brain.",
    "",
    "Usage: pnpm brain ask <question>",
    "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
  ].join("\n"),
  search: [
    "Search current Company Brain evidence.",
    "",
    "Usage: pnpm brain search <query>",
    "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
  ].join("\n"),
  source: [
    "Open one source or citation returned by Brain.",
    "",
    "Usage: pnpm brain source <citation-key|source-revision-key>",
    "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
  ].join("\n"),
  health: [
    "Show ingestion freshness, coverage, and rollout readiness.",
    "",
    "Usage: pnpm brain health",
    "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
  ].join("\n"),
  setup: [
    "Configure a terminal runtime in the current repository.",
    "",
    "Usage: pnpm brain setup [codex|claude-code|cowork] [--repo <project-directory>]",
    "Requires: CONVEX_SITE_URL",
    "Copies the Ask Apero skill and writes project-local MCP config.",
    "Never writes MAESTRO_BRAIN_API_KEY.",
  ].join("\n"),
  doctor: [
    "Verify configuration, API access, and hosted MCP prompts/tools.",
    "",
    "Usage: pnpm brain doctor",
    "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
  ].join("\n"),
  note: [
    "Submit one note to the editor review queue.",
    "",
    "Usage:",
    "  pnpm brain note --file <note.md> [--title <title>]",
    "  pnpm brain note --stdin [--title <title>]",
    '  pnpm brain note --input \'{"title":"...","markdown":"..."}\'',
    "  pnpm brain note status <source-key>",
    "Piped Markdown may provide its title as the first H1.",
    "The submit response's sourceKey can be checked with note status.",
    "Statuses: pending_review (waiting), published (searchable), rejected (not published).",
    "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
  ].join("\n"),
  snapshot: [
    "Inspect or submit a Markdown snapshot in stable path order.",
    "",
    "Usage:",
    "  pnpm brain snapshot inspect <directory> --as-of <YYYY-MM-DD> [--source <name>]",
    "  pnpm brain snapshot submit <directory> --as-of <YYYY-MM-DD> [--source <name>]",
    "Inspect is local and prints metadata only. Submit requires both environment variables.",
  ].join("\n"),
  mcp: [
    "Inspect or call the hosted streamable HTTP MCP.",
    "",
    "Usage:",
    "  pnpm brain mcp tools",
    "  pnpm brain mcp prompts",
    "  pnpm brain mcp call <tool-name> [--input <json>]",
    "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
  ].join("\n"),
  feedback: [
    "Report a wrong or stale answer using returned evidence identifiers.",
    "",
    "Usage: pnpm brain feedback --idempotency-key <key> --input <json>",
    "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
  ].join("\n"),
};

const focusedHelp = (argv: readonly string[]): CliResult | undefined => {
  const helpRequested = ["--help", "-h"].includes(argv.at(-1) ?? "");
  if (!helpRequested) return undefined;
  if (argv[0] === "note" && argv[1] === "status" && argv.length === 3)
    return cliSuccess(
      [
        "Check one submitted note's editor-review state.",
        "",
        "Usage: pnpm brain note status <source-key>",
        "Statuses: pending_review (waiting), published (searchable), rejected (not published).",
        "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
      ].join("\n") + "\n",
    );
  if (argv.length !== 2) return undefined;
  const help = commandHelp[argv[0] ?? ""];
  return help === undefined ? undefined : cliSuccess(`${help}\n`);
};

export const withReviewNextStep = (result: CliResult): CliResult => {
  if (result.exitCode !== 0 || !result.stdout) return result;
  try {
    const body = JSON.parse(result.stdout) as Readonly<Record<string, unknown>>;
    return {
      ...result,
      stdout: formatJsonOutput({
        ...body,
        next: [
          "An editor must approve this submission in the /brain review queue.",
          "Save the returned sourceKey and check it with pnpm brain note status <source-key>.",
          "After approval, verify it with pnpm brain search <query>.",
        ],
      }),
    };
  } catch {
    return result;
  }
};

const usesMarkdownNoteInput = (argv: readonly string[]): boolean =>
  argv[0] === "note" &&
  argv
    .slice(1)
    .some((token) => ["--file", "--stdin", "--title"].includes(token));

const contentCommand = async (
  argv: readonly string[],
  config: CliRuntimeConfig,
  readStdin: () => Promise<string>,
): Promise<CliResult | undefined> => {
  if (argv[0] === "snapshot") {
    const configError =
      argv[1] === "submit" ? remoteBrainConfigError(config) : undefined;
    return await runSnapshotSubmit(
      argv,
      (note) =>
        executeRemoteBrainRequest(
          {
            operationId: "brain.notes.submit",
            input: { title: note.title, markdown: note.markdown },
          },
          config,
        ),
      configError,
    );
  }
  if (!usesMarkdownNoteInput(argv)) return undefined;
  const note = await noteInputFromArgs(argv, readStdin);
  if (!note.ok) return note.result;
  return withReviewNextStep(
    await executeRemoteBrainRequest(
      { operationId: "brain.notes.submit", input: note.input },
      config,
    ),
  );
};

const environmentCommand = async (
  argv: readonly string[],
  config: CliRuntimeConfig,
): Promise<CliResult | undefined> => {
  if (argv[0] !== "doctor") return undefined;
  return argv.length === 1
    ? await doctorBrainEnvironment(config)
    : cliFailure("doctor takes no arguments.\n");
};

export const runSpecialCommand = async (
  argv: readonly string[],
  config: CliRuntimeConfig,
  readStdin: () => Promise<string>,
  options: {
    readonly currentDirectory?: string;
    readonly skillSourceDirectory?: string;
  } = {},
): Promise<CliResult | undefined> => {
  const currentDirectory = options.currentDirectory ?? process.cwd();
  const handlers = [
    async () => focusedHelp(argv),
    async () => await contentCommand(argv, config, readStdin),
    async () =>
      runSetupCommand(
        argv,
        config,
        currentDirectory,
        options.skillSourceDirectory,
      ),
    async () => await environmentCommand(argv, config),
    async () => await runRemoteMcpCommand(argv, config),
    async () =>
      argv[0] === "api" && argv[1] === "call"
        ? await remoteBrainApiResult(argv, config)
        : undefined,
  ];
  for (const handler of handlers) {
    const result = await handler();
    if (result !== undefined) return result;
  }
  return undefined;
};
