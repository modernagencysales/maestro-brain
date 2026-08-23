import { parseNamedArgs } from "./namedArgs";
import { cliFailure } from "./result";
import type { CliResult } from "./types";
import type { RemoteBrainRequest } from "./remoteApi";

type TerminalRequest = RemoteBrainRequest | CliResult;
type TerminalRequestParser = (argv: readonly string[]) => TerminalRequest;

const textRequest = (
  command: "ask" | "search",
  argv: readonly string[],
): TerminalRequest => {
  const text = argv.slice(1).join(" ").trim();
  if (!text)
    return cliFailure(
      `${command} requires a ${command === "ask" ? "question" : "query"}.\n`,
    );
  return command === "ask"
    ? { operationId: "brain.answers.ask", input: { question: text } }
    : { operationId: "brain.sources.search", input: { query: text } };
};

const sourceRequest: TerminalRequestParser = (argv) => {
  const sourceKey = argv[1];
  if (argv.length !== 2 || !sourceKey?.trim())
    return cliFailure("source requires one source revision key.\n");
  if (!sourceKey.startsWith("citation:"))
    return {
      operationId: "brain.sources.get",
      input: { sourceRevisionKey: sourceKey },
    };
  const citationParts = sourceKey.slice("citation:".length).split(":");
  return citationParts.length === 2
    ? {
        operationId: "brain.sources.get",
        input: {
          publicationSetKey: citationParts[0] as string,
          entryKey: citationParts[1] as string,
        },
      }
    : cliFailure("source requires one source revision key.\n");
};

const healthRequest: TerminalRequestParser = (argv) =>
  argv.length === 1
    ? { operationId: "brain.rollout.status", input: {} }
    : cliFailure("health takes no arguments.\n");

const noteStatusRequest: TerminalRequestParser = (argv) => {
  const sourceKey = argv[2];
  return argv.length === 3 && sourceKey?.trim()
    ? { operationId: "brain.notes.status", input: { sourceKey } }
    : cliFailure("note status requires one source key.\n");
};

const noteSubmitRequest: TerminalRequestParser = (argv) => {
  const parsed = parseNamedArgs(argv.slice(1));
  if (!parsed.ok) return cliFailure(`${parsed.message}\n`);
  const { input, ...unsupported } = parsed.args;
  return input !== undefined &&
    typeof input.title === "string" &&
    typeof input.markdown === "string" &&
    Object.keys(unsupported).length === 0
    ? { operationId: "brain.notes.submit", input }
    : cliFailure('note requires --input with string "title" and "markdown".\n');
};

const noteRequest: TerminalRequestParser = (argv) =>
  argv[1] === "status" ? noteStatusRequest(argv) : noteSubmitRequest(argv);

const feedbackRequest: TerminalRequestParser = (argv) => {
  const parsed = parseNamedArgs(argv.slice(1));
  if (!parsed.ok) return cliFailure(`${parsed.message}\n`);
  const { input, idempotencyKey, ...unsupported } = parsed.args;
  return input !== undefined &&
    idempotencyKey !== undefined &&
    Object.keys(unsupported).length === 0
    ? {
        operationId: "brain.feedback.reportWrongOrStale",
        input,
        idempotencyKey,
      }
    : cliFailure("feedback requires --input and --idempotency-key.\n");
};

const parsers: Readonly<Record<string, TerminalRequestParser | undefined>> = {
  ask: (argv) => textRequest("ask", argv),
  search: (argv) => textRequest("search", argv),
  source: sourceRequest,
  health: healthRequest,
  note: noteRequest,
  feedback: feedbackRequest,
};

export const terminalBrainRequest = (
  argv: readonly string[],
): TerminalRequest | undefined => parsers[argv[0] ?? ""]?.(argv);
