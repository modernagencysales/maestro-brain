import { parseNamedArgs } from "./namedArgs";
import { cliFailure } from "./result";
import type { CliResult } from "./types";
import type { RemoteBrainRequest } from "./remoteApi";

type TerminalRequest = RemoteBrainRequest | CliResult;
type TerminalRequestParser = (argv: readonly string[]) => TerminalRequest;

const usageFailure = (
  commandPath: string,
  message: string,
  usage: string,
): CliResult =>
  cliFailure(
    `${message}\nUsage: maestro-brain ${usage}\nRun maestro-brain ${commandPath} --help for details.\n`,
  );

const textRequest = (
  command: "ask" | "search",
  argv: readonly string[],
): TerminalRequest => {
  const text = argv.slice(1).join(" ").trim();
  if (!text)
    return usageFailure(
      command,
      `${command} requires a ${command === "ask" ? "question" : "query"}.`,
      `${command} <${command === "ask" ? "question" : "query"}>`,
    );
  return command === "ask"
    ? { operationId: "brain.answers.ask", input: { question: text } }
    : { operationId: "brain.sources.search", input: { query: text } };
};

const sourceRequest: TerminalRequestParser = (argv) => {
  const sourceKey = argv[1];
  if (argv.length !== 2 || !sourceKey?.trim())
    return usageFailure(
      "source",
      "source requires one citation or source revision key.",
      "source <citation-key|source-revision-key>",
    );
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
    : usageFailure(
        "source",
        "source received an invalid citation key.",
        "source <citation-key|source-revision-key>",
      );
};

const healthRequest: TerminalRequestParser = (argv) =>
  argv.length === 1
    ? { operationId: "brain.rollout.status", input: {} }
    : usageFailure("health", "health takes no arguments.", "health");

const noteStatusRequest: TerminalRequestParser = (argv) => {
  const sourceKey = argv[2];
  return argv.length === 3 && sourceKey?.trim()
    ? { operationId: "brain.notes.status", input: { sourceKey } }
    : usageFailure(
        "note status",
        "note status requires one source key.",
        "note status <source-key>",
      );
};

const noteStatuses = new Set(["pending_review", "published", "rejected"]);

const noteListRequest: TerminalRequestParser = (argv) => {
  const status = argv[2];
  if (argv.length > 3 || (status !== undefined && !noteStatuses.has(status)))
    return usageFailure(
      "note list",
      "note list status must be pending_review, published, or rejected.",
      "note list [pending_review|published|rejected]",
    );
  return {
    operationId: "brain.notes.list",
    input: status === undefined ? {} : { status },
  };
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
    : usageFailure(
        "note",
        'note requires --input with string "title" and "markdown".',
        "note --input <json>",
      );
};

const noteRequest: TerminalRequestParser = (argv) =>
  argv[1] === "status"
    ? noteStatusRequest(argv)
    : argv[1] === "list"
      ? noteListRequest(argv)
      : noteSubmitRequest(argv);

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
    : usageFailure(
        "feedback",
        "feedback requires --input and --idempotency-key.",
        "feedback --idempotency-key <key> --input <json>",
      );
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
