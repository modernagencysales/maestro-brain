import { cliFailure } from "./result";
import type {
  CliCommandContext,
  CliCommandHandler,
  CliResult,
  CliRuntimeConfig,
} from "./types";

export const parseCliCommandContext = (
  argv: readonly string[],
): CliCommandContext => {
  const [command, subcommand, target] = argv;

  return { argv, command, subcommand, target };
};

export const findCliHandler = (
  handlers: readonly CliCommandHandler[],
  context: CliCommandContext,
): CliCommandHandler | undefined =>
  handlers.find((candidate) => candidate.matches(context));

export const dispatchCliCommand = (
  handlers: readonly CliCommandHandler[],
  argv: readonly string[],
  config: CliRuntimeConfig,
): CliResult => {
  const context = parseCliCommandContext(argv);
  const handler = findCliHandler(handlers, context);

  return (
    handler?.run(context, config) ??
    cliFailure(`Unknown command: ${argv.join(" ")}\n`)
  );
};
