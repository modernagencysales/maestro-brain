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

const noteInput = (
  markdownValue: string,
  explicitTitle: string | undefined,
  fallbackTitle: string | undefined,
  source: "file" | "stdin",
): NoteInputResult => {
  const markdown = markdownValue.trim();
  if (!markdown)
    return { ok: false, result: cliFailure(`note --${source} is empty.\n`) };
  if (Buffer.byteLength(markdown, "utf8") > maxNoteBytes)
    return {
      ok: false,
      result: cliFailure("note exceeds the 256 KiB limit.\n"),
    };
  const title = explicitTitle ?? titleFromMarkdown(markdown) ?? fallbackTitle;
  if (title === undefined)
    return {
      ok: false,
      result: cliFailure(
        source === "stdin"
          ? "note --stdin requires --title unless Markdown starts with an H1.\n"
          : "note --file requires --title, an H1, or a usable filename.\n",
      ),
    };
  if (!validTitle(title))
    return {
      ok: false,
      result: cliFailure("note --title must contain 1 to 160 characters.\n"),
    };
  return { ok: true, input: { title, markdown } };
};

type NoteFlags = {
  readonly file?: string;
  readonly stdin: boolean;
  readonly title?: string;
};

const parseNoteFlags = (argv: readonly string[]): NoteFlags | CliResult => {
  let file: string | undefined;
  let stdin = false;
  let title: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--stdin") {
      if (stdin) return cliFailure("Duplicate option: --stdin\n");
      stdin = true;
      continue;
    }
    if (flag !== "--file" && flag !== "--title")
      return cliFailure(`Unknown option: ${flag ?? ""}\n`);
    const value = argv[index + 1];
    if (value === undefined) return cliFailure(`${flag} requires a value.\n`);
    if (flag === "--file") {
      if (file !== undefined) return cliFailure("Duplicate option: --file\n");
      file = value;
    } else {
      if (title !== undefined) return cliFailure("Duplicate option: --title\n");
      title = value;
    }
    index += 1;
  }
  const sourceCount = Number(file !== undefined) + Number(stdin);
  if (sourceCount !== 1)
    return cliFailure(
      "note accepts exactly one of --input, --file, or --stdin.\n",
    );
  return {
    ...(file === undefined ? {} : { file }),
    stdin,
    ...(title === undefined ? {} : { title }),
  };
};

const fileNoteInput = (
  file: string,
  title: string | undefined,
): NoteInputResult => {
  const path = resolve(file);
  try {
    if (![".md", ".markdown"].includes(extname(path).toLowerCase()))
      return {
        ok: false,
        result: cliFailure("note --file requires a Markdown file.\n"),
      };
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      return {
        ok: false,
        result: cliFailure("note --file requires a regular Markdown file.\n"),
      };
    if (stat.size > maxNoteBytes)
      return {
        ok: false,
        result: cliFailure("note exceeds the 256 KiB limit.\n"),
      };
    const fallback = basename(path, extname(path))
      .replaceAll(/[-_]+/g, " ")
      .trim();
    return noteInput(readFileSync(path, "utf8"), title, fallback, "file");
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
