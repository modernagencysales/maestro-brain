import { cliFailure, formatJsonOutput } from "./result";
import { snapshotNotesForDirectory, type SnapshotNote } from "./snapshotImport";
import type { CliResult } from "./types";

const usage =
  "snapshot usage: snapshot submit <directory> --as-of <YYYY-MM-DD> [--source <name>].\n";
const defaultSource = "Claude Ask Apero Advisors";

type SubmitNote = (note: SnapshotNote) => Promise<CliResult>;

type SnapshotOptionsResult =
  | {
      readonly ok: true;
      readonly directory: string;
      readonly asOf: string;
      readonly source: string;
    }
  | { readonly ok: false; readonly result: CliResult };

type SubmittedNote = {
  readonly path: string;
  readonly title: string;
  readonly sourceKey: string | null;
  readonly status: string | null;
};

const snapshotOptions = (argv: readonly string[]): SnapshotOptionsResult => {
  if (argv[1] !== "submit") return { ok: false, result: cliFailure(usage) };
  const tokens = argv.slice(3);
  const flags = tokens.filter((_, index) => index % 2 === 0);
  if (
    tokens.length % 2 !== 0 ||
    flags.some((flag) => flag !== "--as-of" && flag !== "--source")
  )
    return { ok: false, result: cliFailure(usage) };

  const options = Object.fromEntries(
    flags.map((flag, index) => [flag, tokens[index * 2 + 1] ?? ""]),
  );
  const asOf = options["--as-of"];
  return asOf === undefined
    ? {
        ok: false,
        result: cliFailure("snapshot submit requires --as-of <YYYY-MM-DD>.\n"),
      }
    : {
        ok: true,
        directory: argv[2] ?? "",
        asOf,
        source: options["--source"] ?? defaultSource,
      };
};

const submittedNote = (
  note: SnapshotNote,
  result: CliResult,
): SubmittedNote => {
  try {
    const response = JSON.parse(result.stdout) as {
      readonly result?: {
        readonly sourceKey?: unknown;
        readonly status?: unknown;
      };
    };
    return {
      path: note.path,
      title: note.title,
      sourceKey:
        typeof response.result?.sourceKey === "string"
          ? response.result.sourceKey
          : null,
      status:
        typeof response.result?.status === "string"
          ? response.result.status
          : null,
    };
  } catch {
    return {
      path: note.path,
      title: note.title,
      sourceKey: null,
      status: null,
    };
  }
};

export const runSnapshotSubmit = async (
  argv: readonly string[],
  submitNote: SubmitNote,
): Promise<CliResult> => {
  const options = snapshotOptions(argv);
  if (!options.ok) return options.result;
  const snapshot = snapshotNotesForDirectory(options.directory, options);
  if (!snapshot.ok) return cliFailure(`${snapshot.message}\n`);

  const submitted: SubmittedNote[] = [];
  for (const note of snapshot.notes) {
    const result = await submitNote(note);
    if (result.exitCode !== 0)
      return {
        exitCode: 1,
        stdout: formatJsonOutput({
          ok: false,
          operationId: "brain.snapshot.submit",
          result: { submitted, failedPath: note.path },
          error: "Snapshot submission stopped at the first rejected file.",
        }),
        stderr: result.stderr,
      };
    submitted.push(submittedNote(note, result));
  }

  return {
    exitCode: 0,
    stdout: formatJsonOutput({
      ok: true,
      operationId: "brain.snapshot.submit",
      result: {
        directory: snapshot.directory,
        submittedCount: submitted.length,
        status: "pending_review",
        submitted,
      },
    }),
    stderr: "",
  };
};
