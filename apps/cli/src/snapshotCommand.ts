import { cliFailure, formatJsonOutput } from "./result";
import { snapshotNotesForDirectory, type SnapshotNote } from "./snapshotImport";
import type { CliResult } from "./types";

const usage =
  "snapshot usage: snapshot <inspect|submit> <directory> --as-of <YYYY-MM-DD> [--source <name>].\n";
const defaultSource = "Claude Ask Apero Advisors";

type SubmitNote = (note: SnapshotNote) => Promise<CliResult>;

type SnapshotOptionsResult =
  | {
      readonly ok: true;
      readonly action: "inspect" | "submit";
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

type SnapshotSubmissionResult =
  | { readonly ok: true; readonly submitted: readonly SubmittedNote[] }
  | { readonly ok: false; readonly result: CliResult };

const snapshotOptions = (argv: readonly string[]): SnapshotOptionsResult => {
  if (argv[1] !== "inspect" && argv[1] !== "submit")
    return { ok: false, result: cliFailure(usage) };
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
        result: cliFailure(
          `snapshot ${argv[1]} requires --as-of <YYYY-MM-DD>.\n`,
        ),
      }
    : {
        ok: true,
        action: argv[1],
        directory: argv[2] ?? "",
        asOf,
        source: options["--source"] ?? defaultSource,
      };
};

const inspectResult = (
  snapshot: Extract<
    ReturnType<typeof snapshotNotesForDirectory>,
    { readonly ok: true }
  >,
  options: Extract<SnapshotOptionsResult, { readonly ok: true }>,
): CliResult => ({
  exitCode: 0,
  stdout: formatJsonOutput({
    ok: true,
    operationId: "brain.snapshot.inspect",
    result: {
      directory: snapshot.directory,
      source: options.source,
      asOf: options.asOf,
      fileCount: snapshot.notes.length,
      totalBytes: snapshot.notes.reduce((total, note) => total + note.bytes, 0),
      files: snapshot.notes.map(({ path, title, bytes }) => ({
        path,
        title,
        bytes,
      })),
    },
  }),
  stderr: "",
});

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

const submissionError = (result: CliResult): unknown => {
  if (result.stderr.trim()) return result.stderr.trim();
  try {
    const response = JSON.parse(result.stdout) as {
      readonly error?: unknown;
    };
    return response.error ?? defaultSubmissionError;
  } catch {
    return defaultSubmissionError;
  }
};

const defaultSubmissionError =
  "Snapshot submission stopped at the first rejected file.";

const failedSubmissionResult = (
  note: SnapshotNote,
  submitted: readonly SubmittedNote[],
  result: CliResult,
): CliResult => ({
  exitCode: 1,
  stdout: formatJsonOutput({
    ok: false,
    operationId: "brain.snapshot.submit",
    result: { submitted, failedPath: note.path },
    error: submissionError(result),
  }),
  stderr: "",
});

const submitSnapshotNotes = async (
  notes: readonly SnapshotNote[],
  submitNote: SubmitNote,
): Promise<SnapshotSubmissionResult> => {
  const submitted: SubmittedNote[] = [];
  for (const note of notes) {
    const result = await submitNote(note);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        result: failedSubmissionResult(note, submitted, result),
      };
    }
    submitted.push(submittedNote(note, result));
  }
  return { ok: true, submitted };
};

const statusCountsFor = (
  submitted: readonly SubmittedNote[],
): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const note of submitted) {
    const status = note.status ?? "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
};

const submitResult = (
  directory: string,
  submitted: readonly SubmittedNote[],
): CliResult => {
  const statusCounts = statusCountsFor(submitted);
  const statuses = Object.keys(statusCounts);
  return {
    exitCode: 0,
    stdout: formatJsonOutput({
      ok: true,
      operationId: "brain.snapshot.submit",
      result: {
        directory,
        submittedCount: submitted.length,
        status: statuses.length === 1 ? statuses[0] : "mixed",
        statusCounts,
        submitted,
      },
      next: [
        "An editor must approve these submissions in the /brain review queue.",
        "After approval, verify them with maestro-brain search <query>.",
      ],
    }),
    stderr: "",
  };
};

const preparedSnapshotResult = async (
  snapshot: Extract<
    ReturnType<typeof snapshotNotesForDirectory>,
    { readonly ok: true }
  >,
  options: Extract<SnapshotOptionsResult, { readonly ok: true }>,
  submitNote: SubmitNote,
  configError?: string,
): Promise<CliResult> => {
  if (options.action === "inspect") return inspectResult(snapshot, options);
  if (configError !== undefined) return cliFailure(configError);
  const submission = await submitSnapshotNotes(snapshot.notes, submitNote);
  return submission.ok
    ? submitResult(snapshot.directory, submission.submitted)
    : submission.result;
};

export const runSnapshotSubmit = async (
  argv: readonly string[],
  submitNote: SubmitNote,
  configError?: string,
): Promise<CliResult> => {
  const options = snapshotOptions(argv);
  if (!options.ok) return options.result;
  const snapshot = snapshotNotesForDirectory(options.directory, options);
  return snapshot.ok
    ? await preparedSnapshotResult(snapshot, options, submitNote, configError)
    : cliFailure(`${snapshot.message}\n`);
};
