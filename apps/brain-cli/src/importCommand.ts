import { createHash } from "node:crypto";
import { readFileSync, readdirSync, type Dirent } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { failure, success, type CliResult } from "./api.js";
import { markdownTitle, slugFor } from "./pageCommand.js";
import { request, type CliDependencies } from "./runtime.js";

const pathsForEntry = (directory: string, entry: Dirent): string[] => {
  if (entry.name.startsWith(".") || entry.isSymbolicLink()) return [];
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return markdownPaths(path);
  return entry.isFile() && extname(entry.name).toLowerCase() === ".md"
    ? [path]
    : [];
};

const markdownPaths = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => pathsForEntry(directory, entry));

const importPaths = (
  folder: string,
): { root: string; paths: string[] } | CliResult => {
  const root = resolve(folder);
  try {
    const paths = markdownPaths(root);
    return paths.length > 0
      ? { root, paths }
      : failure("Import folder contains no Markdown files.");
  } catch {
    return failure("Import folder could not be read.");
  }
};

export const importCommand = async (
  folder: string | undefined,
  dependencies: CliDependencies,
): Promise<CliResult> => {
  if (!folder) return failure("import requires a folder.");
  const files = importPaths(folder);
  if ("exitCode" in files) return files;
  const imported: string[] = [];
  for (const path of files.paths) {
    const markdown = readFileSync(path, "utf8").trim();
    const relativePath = relative(files.root, path).split("\\").join("/");
    if (!markdown) return failure(`${relativePath} is empty.`);
    const result = await request(dependencies, {
      operationId: "brain.pages.createMarkdown",
      input: {
        slug: slugFor(relativePath),
        title: markdownTitle(path, markdown),
        markdown,
      },
      idempotencyKey: createHash("sha256")
        .update(`${relativePath}\0${markdown}`)
        .digest("hex"),
    });
    if (result.exitCode !== 0) return result;
    imported.push(relativePath);
  }
  return success({ ok: true, importedCount: imported.length, imported });
};
