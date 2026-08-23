import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  type Dirent,
} from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import {
  markdownWithSnapshotProvenance,
  type SnapshotProvenance,
  type ValidSnapshotProvenance,
  validateSnapshotProvenance,
} from "./snapshotProvenance";

const maxSnapshotFiles = 100;
const maxSnapshotFileBytes = 256 * 1024;
const maxSnapshotBytes = 5 * 1024 * 1024;

export type SnapshotNote = {
  readonly path: string;
  readonly title: string;
  readonly markdown: string;
  readonly bytes: number;
};

export type SnapshotNotesResult =
  | {
      readonly ok: true;
      readonly directory: string;
      readonly notes: readonly SnapshotNote[];
    }
  | { readonly ok: false; readonly message: string };

type SnapshotFailure = Extract<SnapshotNotesResult, { readonly ok: false }>;

type ValidSnapshotInput = {
  readonly ok: true;
  readonly requested: string;
  readonly provenance: ValidSnapshotProvenance;
};

type SnapshotFiles = {
  readonly ok: true;
  readonly root: string;
  readonly paths: readonly string[];
};

type SnapshotMarkdown = {
  readonly ok: true;
  readonly markdown: string;
  readonly bytes: number;
  readonly totalBytes: number;
};

type SnapshotNoteList = {
  readonly ok: true;
  readonly notes: readonly SnapshotNote[];
};

const snapshotFailure = (message: string): SnapshotFailure => ({
  ok: false,
  message,
});

const titleFor = (path: string, markdown: string): string => {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return basename(path, extname(path)).replaceAll(/[-_]+/g, " ").trim();
};

const validSnapshotInput = (
  directory: string,
  provenance: SnapshotProvenance,
): ValidSnapshotInput | SnapshotFailure => {
  const requested = directory.trim();
  if (!requested)
    return snapshotFailure("snapshot submit requires a directory.");

  const validatedProvenance = validateSnapshotProvenance(provenance);
  return validatedProvenance.ok
    ? { ok: true, requested, provenance: validatedProvenance }
    : validatedProvenance;
};

const snapshotRoot = (requested: string): string | SnapshotFailure => {
  try {
    const root = realpathSync(resolve(requested));
    return lstatSync(root).isDirectory()
      ? root
      : snapshotFailure("snapshot submit requires a directory.");
  } catch {
    return snapshotFailure("snapshot directory does not exist.");
  }
};

const markdownPathsForEntry = (
  directoryPath: string,
  entry: Dirent,
): readonly string[] => {
  if (entry.name.startsWith(".") || entry.isSymbolicLink()) return [];
  const path = resolve(directoryPath, entry.name);
  if (entry.isDirectory()) return markdownPathsForDirectory(path);
  return entry.isFile() && extname(entry.name).toLowerCase() === ".md"
    ? [path]
    : [];
};

const markdownPathsForDirectory = (directoryPath: string): readonly string[] =>
  readdirSync(directoryPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => markdownPathsForEntry(directoryPath, entry));

const supportedSnapshotFiles = (
  root: string,
  paths: readonly string[],
): SnapshotFiles | SnapshotFailure => {
  if (paths.length === 0)
    return snapshotFailure("snapshot directory contains no Markdown files.");
  return paths.length <= maxSnapshotFiles
    ? { ok: true, root, paths }
    : snapshotFailure(`snapshot exceeds the ${maxSnapshotFiles}-file limit.`);
};

const snapshotFiles = (requested: string): SnapshotFiles | SnapshotFailure => {
  const root = snapshotRoot(requested);
  if (typeof root !== "string") return root;
  try {
    return supportedSnapshotFiles(root, markdownPathsForDirectory(root));
  } catch {
    return snapshotFailure("snapshot directory could not be read.");
  }
};

const portableRelativePath = (root: string, path: string): string =>
  relative(root, path).split("\\").join("/");

const snapshotMarkdown = (
  root: string,
  path: string,
  totalBytes: number,
): SnapshotMarkdown | SnapshotFailure => {
  const relativePath = relative(root, path);
  try {
    const bytes = lstatSync(path).size;
    if (bytes > maxSnapshotFileBytes)
      return snapshotFailure(`${relativePath} exceeds the 256 KiB file limit.`);
    const nextTotalBytes = totalBytes + bytes;
    if (nextTotalBytes > maxSnapshotBytes)
      return snapshotFailure("snapshot exceeds the 5 MiB total limit.");
    const markdown = readFileSync(path, "utf8").trim();
    return markdown
      ? { ok: true, markdown, bytes, totalBytes: nextTotalBytes }
      : snapshotFailure(`${relativePath} is empty.`);
  } catch {
    return snapshotFailure(
      `${relativePath} could not be read as UTF-8 Markdown.`,
    );
  }
};

const snapshotNotes = (
  files: SnapshotFiles,
  provenance: ValidSnapshotProvenance,
): SnapshotNoteList | SnapshotFailure => {
  let totalBytes = 0;
  const notes: SnapshotNote[] = [];
  for (const path of files.paths) {
    const content = snapshotMarkdown(files.root, path, totalBytes);
    if (!content.ok) return content;
    totalBytes = content.totalBytes;
    notes.push({
      path: portableRelativePath(files.root, path),
      title: titleFor(path, content.markdown),
      markdown: markdownWithSnapshotProvenance(content.markdown, provenance),
      bytes: content.bytes,
    });
  }
  return { ok: true, notes };
};

export const snapshotNotesForDirectory = (
  directory: string,
  provenance: SnapshotProvenance,
): SnapshotNotesResult => {
  const input = validSnapshotInput(directory, provenance);
  if (!input.ok) return input;
  const files = snapshotFiles(input.requested);
  if (!files.ok) return files;
  const notes = snapshotNotes(files, input.provenance);
  return notes.ok
    ? { ok: true, directory: input.requested, notes: notes.notes }
    : notes;
};
