import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import {
  markdownWithSnapshotProvenance,
  type SnapshotProvenance,
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

const titleFor = (path: string, markdown: string): string => {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return basename(path, extname(path)).replaceAll(/[-_]+/g, " ").trim();
};

export const snapshotNotesForDirectory = (
  directory: string,
  provenance: SnapshotProvenance,
): SnapshotNotesResult => {
  const requested = directory.trim();
  if (!requested)
    return { ok: false, message: "snapshot submit requires a directory." };
  const validatedProvenance = validateSnapshotProvenance(provenance);
  if (!validatedProvenance.ok) return validatedProvenance;

  let root: string;
  try {
    root = realpathSync(resolve(requested));
    if (!lstatSync(root).isDirectory())
      return { ok: false, message: "snapshot submit requires a directory." };
  } catch {
    return { ok: false, message: "snapshot directory does not exist." };
  }

  const markdownPaths: string[] = [];
  const visit = (directoryPath: string): void => {
    for (const entry of readdirSync(directoryPath, {
      withFileTypes: true,
    }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith(".")) continue;
      const path = resolve(directoryPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md")
        markdownPaths.push(path);
    }
  };

  try {
    visit(root);
  } catch {
    return { ok: false, message: "snapshot directory could not be read." };
  }

  if (markdownPaths.length === 0)
    return {
      ok: false,
      message: "snapshot directory contains no Markdown files.",
    };
  if (markdownPaths.length > maxSnapshotFiles)
    return {
      ok: false,
      message: `snapshot exceeds the ${maxSnapshotFiles}-file limit.`,
    };

  let totalBytes = 0;
  const notes: SnapshotNote[] = [];
  for (const path of markdownPaths) {
    let markdown: string;
    let bytes: number;
    try {
      bytes = lstatSync(path).size;
      if (bytes > maxSnapshotFileBytes)
        return {
          ok: false,
          message: `${relative(root, path)} exceeds the 256 KiB file limit.`,
        };
      totalBytes += bytes;
      if (totalBytes > maxSnapshotBytes)
        return {
          ok: false,
          message: "snapshot exceeds the 5 MiB total limit.",
        };
      markdown = readFileSync(path, "utf8").trim();
    } catch {
      return {
        ok: false,
        message: `${relative(root, path)} could not be read as UTF-8 Markdown.`,
      };
    }
    if (!markdown)
      return { ok: false, message: `${relative(root, path)} is empty.` };
    notes.push({
      path: relative(root, path).split("\\").join("/"),
      title: titleFor(path, markdown),
      markdown: markdownWithSnapshotProvenance(markdown, validatedProvenance),
      bytes,
    });
  }

  return { ok: true, directory: requested, notes };
};
