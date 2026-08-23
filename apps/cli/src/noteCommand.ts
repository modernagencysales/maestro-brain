import { lstatSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import { cliFailure } from "./result";
import type { CliResult } from "./types";

const maxNoteBytes = 256 * 1024;

export type NoteInput = {
  readonly title: string;
  readonly markdown: string;
};

type NoteInputResult =
  | { readonly ok: true; readonly input: NoteInput }
  | { readonly ok: false; readonly result: CliResult };

const titleFromMarkdown = (markdown: string): string | undefined =>
  markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();

const validTitle = (title: string): boolean =>
  title.length > 0 &&
  title.length <= 160 &&
  title.trim() === title &&
  !/[\r\n]/.test(title);

const missingTitleMessages = {
  stdin: "note --stdin requires --title unless Markdown starts with an H1.\n",
  file: "note --file requires --title, an H1, or a usable filename.\n",
} as const;

const noteInput = (
  markdownValue: string,
  explicitTitle: string | undefined,
  fallbackTitle: string | undefined,
  source: "file" | "stdin",
): NoteInputResult => {
  const markdown = markdownValue.trim();
  const title = explicitTitle ?? titleFromMarkdown(markdown) ?? fallbackTitle;
  let result: NoteInputResult;

  if (!markdown) {
    result = { ok: false, result: cliFailure(`note --${source} is empty.\n`) };
  } else if (Buffer.byteLength(markdown, "utf8") > maxNoteBytes) {
    result = {
      ok: false,
      result: cliFailure("note exceeds the 256 KiB limit.\n"),
    };
  } else if (title === undefined) {
    result = {
      ok: false,
      result: cliFailure(missingTitleMessages[source]),
    };
  } else if (!validTitle(title)) {
    result = {
      ok: false,
      result: cliFailure("note --title must contain 1 to 160 characters.\n"),
    };
  } else {
    result = { ok: true, input: { title, markdown } };
  }

  return result;
};

type NoteFlags = {
  readonly file?: string;
  readonly stdin: boolean;
  readonly title?: string;
};

type NoteValueFlag = "--file" | "--title";

type NoteFlagParseStep =
  | { readonly ok: true; readonly flags: NoteFlags; readonly nextIndex: number }
  | { readonly ok: false; readonly result: CliResult };

const noteFlagResult = (flags: NoteFlags): NoteFlags => ({
  ...(flags.file === undefined ? {} : { file: flags.file }),
  stdin: flags.stdin,
  ...(flags.title === undefined ? {} : { title: flags.title }),
});

const isNoteValueFlag = (flag: string | undefined): flag is NoteValueFlag =>
  flag === "--file" || flag === "--title";

const duplicateFlagResult = (
  flag: "--stdin" | NoteValueFlag,
): NoteFlagParseStep => ({
  ok: false,
  result: cliFailure(`Duplicate option: ${flag}\n`),
});

const parsedStdinFlag = (flags: NoteFlags, index: number): NoteFlagParseStep =>
  flags.stdin
    ? duplicateFlagResult("--stdin")
    : { ok: true, flags: { ...flags, stdin: true }, nextIndex: index + 1 };

const parsedValueFlag = (
  flag: NoteValueFlag,
  value: string,
  flags: NoteFlags,
  index: number,
): NoteFlagParseStep => {
  if (flag === "--file") {
    return flags.file !== undefined
      ? duplicateFlagResult(flag)
      : {
          ok: true,
          flags: { ...flags, file: value },
          nextIndex: index + 2,
        };
  }

  return flags.title !== undefined
    ? duplicateFlagResult(flag)
    : {
        ok: true,
        flags: { ...flags, title: value },
        nextIndex: index + 2,
      };
};

const parseNoteFlagAt = (
  argv: readonly string[],
  index: number,
  flags: NoteFlags,
): NoteFlagParseStep => {
  const flag = argv[index];
  if (flag === "--stdin") return parsedStdinFlag(flags, index);
  if (!isNoteValueFlag(flag)) {
    return {
      ok: false,
      result: cliFailure(`Unknown option: ${flag ?? ""}\n`),
    };
  }

  const value = argv[index + 1];
  return value === undefined
    ? {
        ok: false,
        result: cliFailure(`${flag} requires a value.\n`),
      }
    : parsedValueFlag(flag, value, flags, index);
};

const parseNoteFlags = (argv: readonly string[]): NoteFlags | CliResult => {
  let flags: NoteFlags = { stdin: false };
  let index = 1;

  while (index < argv.length) {
    const parsed = parseNoteFlagAt(argv, index, flags);
    if (!parsed.ok) return parsed.result;
    flags = parsed.flags;
    index = parsed.nextIndex;
  }

  const sourceCount = Number(flags.file !== undefined) + Number(flags.stdin);
  if (sourceCount !== 1)
    return cliFailure(
      "note accepts exactly one of --input, --file, or --stdin.\n",
    );

  return noteFlagResult(flags);
};

const hasMarkdownExtension = (path: string): boolean =>
  [".md", ".markdown"].includes(extname(path).toLowerCase());

const invalidFileResult = (message: string): NoteInputResult => ({
  ok: false,
  result: cliFailure(message),
});

const fileFallbackTitle = (path: string): string =>
  basename(path, extname(path)).replaceAll(/[-_]+/g, " ").trim();

const fileInputFromPath = (
  path: string,
  title: string | undefined,
): NoteInputResult => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return invalidFileResult("note --file requires a regular Markdown file.\n");
  }
  if (stat.size > maxNoteBytes) {
    return invalidFileResult("note exceeds the 256 KiB limit.\n");
  }
  return noteInput(
    readFileSync(path, "utf8"),
    title,
    fileFallbackTitle(path),
    "file",
  );
};

const fileNoteInput = (
  file: string,
  title: string | undefined,
): NoteInputResult => {
  const path = resolve(file);
  try {
    return hasMarkdownExtension(path)
      ? fileInputFromPath(path, title)
      : invalidFileResult("note --file requires a Markdown file.\n");
  } catch {
    return {
      ok: false,
      result: cliFailure("note file does not exist or could not be read.\n"),
    };
  }
};

export const noteInputFromArgs = async (
  argv: readonly string[],
  readStdin: () => Promise<string>,
): Promise<NoteInputResult> => {
  const flags = parseNoteFlags(argv);
  if ("exitCode" in flags) return { ok: false, result: flags };
  if (flags.file !== undefined) return fileNoteInput(flags.file, flags.title);
  try {
    return noteInput(await readStdin(), flags.title, undefined, "stdin");
  } catch {
    return { ok: false, result: cliFailure("note stdin could not be read.\n") };
  }
};
