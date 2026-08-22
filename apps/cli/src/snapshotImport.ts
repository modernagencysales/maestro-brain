import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";

const maxSnapshotFiles = 100;
const maxSnapshotFileBytes = 256 * 1024;
const maxSnapshotBytes = 5 * 1024 * 1024;

export type SnapshotNote = {
  readonly path: string;
  readonly title: string;
  readonly markdown: string;
};

export type SnapshotProvenance = {
  readonly asOf: string;
  readonly source: string;
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

const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

const markdownWithProvenance = (
  markdown: string,
  provenance: SnapshotProvenance,
): string =>
  [
    `> Snapshot source: ${provenance.source}`,
    `> Snapshot date: ${provenance.asOf}`,
    "> This is reviewed point-in-time evidence, not a live synchronization.",
    "",
    markdown,
  ].join("\n");

export const snapshotNotesForDirectory = (
  directory: string,
  provenance: SnapshotProvenance,
): SnapshotNotesResult => {
  const requested = directory.trim();
  if (!requested)
    return { ok: false, message: "snapshot submit requires a directory." };
  if (!isIsoDate(provenance.asOf))
    return {
      ok: false,
      message: "snapshot --as-of must be a real date in YYYY-MM-DD format.",
    };
  const source = provenance.source.trim();
  if (!source || source.length > 120 || /[\r\n]/.test(source))
    return {
      ok: false,
      message: "snapshot --source must contain 1 to 120 characters.",
    };

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
    try {
      const bytes = lstatSync(path).size;
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
      markdown: markdownWithProvenance(markdown, {
        asOf: provenance.asOf,
        source,
      }),
    });
  }

  return { ok: true, directory: requested, notes };
};
