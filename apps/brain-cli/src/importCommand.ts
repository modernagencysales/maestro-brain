import { createHash } from "node:crypto";
import { readFileSync, readdirSync, type Dirent } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { failure, success, type CliResult } from "./api.js";
import { markdownTitle, slugFor } from "./pageCommand.js";
import { request, type CliDependencies } from "./runtime.js";

type ExistingPage = {
  readonly _id: string;
  readonly slug: string;
  readonly title: string;
  readonly markdown: string;
  readonly updatedAt: number;
  readonly status?: "active" | "archived" | undefined;
  readonly importSourceKey?: string | undefined;
};

type PreparedImport = {
  readonly path: string;
  readonly relativePath: string;
  readonly slug: string;
  readonly markdown: string;
  readonly importSourceKey: string;
};

type PlannedImport = PreparedImport & {
  readonly existing?: ExistingPage | undefined;
  readonly adopt?: boolean | undefined;
};

type ImportProgress = {
  readonly created: string[];
  readonly updated: string[];
  readonly unchanged: string[];
};

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

const existingPages = (result: CliResult): ExistingPage[] | CliResult => {
  if (result.exitCode !== 0) return result;
  let body: unknown;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    return failure(
      "Brain page list returned invalid JSON; no files were imported.",
    );
  }
  if (
    body === null ||
    typeof body !== "object" ||
    !("result" in body) ||
    !Array.isArray(body.result)
  )
    return failure(
      "Brain page list returned an invalid result; no files were imported.",
    );
  const pages = body.result.filter(
    (page): page is ExistingPage =>
      page !== null &&
      typeof page === "object" &&
      "_id" in page &&
      typeof page._id === "string" &&
      "slug" in page &&
      typeof page.slug === "string" &&
      "title" in page &&
      typeof page.title === "string" &&
      "markdown" in page &&
      typeof page.markdown === "string" &&
      "updatedAt" in page &&
      typeof page.updatedAt === "number" &&
      Number.isFinite(page.updatedAt) &&
      (!("status" in page) ||
        page.status === "active" ||
        page.status === "archived") &&
      (!("importSourceKey" in page) ||
        typeof page.importSourceKey === "string"),
  );
  return pages.length === body.result.length
    ? pages
    : failure(
        "Brain page list contained an invalid page; no files were imported.",
      );
};

const progressSummary = (progress: ImportProgress, total: number): string => {
  const processed =
    progress.created.length +
    progress.updated.length +
    progress.unchanged.length;
  return `Processed ${processed}/${total} files (${progress.created.length} created, ${progress.updated.length} updated, ${progress.unchanged.length} unchanged) before failure. Rerun the same command to resume safely.`;
};

const planImports = (
  prepared: readonly PreparedImport[],
  pages: readonly ExistingPage[],
  adoptExisting: boolean,
): PlannedImport[] | CliResult => {
  const planned: PlannedImport[] = [];
  for (const candidate of prepared) {
    const slugMatches = pages.filter((page) => page.slug === candidate.slug);
    if (slugMatches.length > 1)
      return failure(
        `Workspace has multiple pages with slug ${candidate.slug}; no files were imported. Resolve the duplicate pages in the web app first.`,
      );
    const sourceMatches = pages.filter(
      (page) => page.importSourceKey === candidate.importSourceKey,
    );
    if (sourceMatches.length > 1)
      return failure(
        `Workspace has multiple pages owned by ${candidate.importSourceKey}; no files were imported. Resolve the duplicate pages in the web app first.`,
      );
    const existing = sourceMatches[0];
    if (existing && existing.slug !== candidate.slug)
      return failure(
        `${candidate.relativePath} has an import identity already assigned to a different page slug; no files were imported.`,
      );
    if (existing && (existing.status ?? "active") !== "active")
      return failure(
        `${candidate.relativePath} maps to an archived Brain page; restore it in the web app before importing. No files were imported.`,
      );
    if (!existing && slugMatches.length > 0 && !adoptExisting)
      return failure(
        `${candidate.relativePath} conflicts with an existing Brain page it does not own (${candidate.slug}); no files were imported. Rename the file or page first.`,
      );
    const adopted = existing ?? (adoptExisting ? slugMatches[0] : undefined);
    if (!existing && adopted?.importSourceKey !== undefined)
      return failure(
        `${candidate.relativePath} conflicts with a page owned by another import source; no files were imported.`,
      );
    if (adopted && (adopted.status ?? "active") !== "active")
      return failure(
        `${candidate.relativePath} maps to an archived Brain page; restore it in the web app before importing. No files were imported.`,
      );
    planned.push({
      ...candidate,
      ...(adopted ? { existing: adopted } : {}),
      ...(!existing && adopted ? { adopt: true } : {}),
    });
  }
  return planned;
};

export const importCommand = async (
  folder: string | undefined,
  dependencies: CliDependencies,
  options: { readonly adoptExisting?: boolean | undefined } = {},
): Promise<CliResult> => {
  if (!folder) return failure("import requires a folder.");
  const files = importPaths(folder);
  if ("exitCode" in files) return files;
  const prepared: PreparedImport[] = [];
  const pathsBySlug = new Map<string, string>();
  for (const path of files.paths) {
    const markdown = readFileSync(path, "utf8").trim();
    const relativePath = relative(files.root, path).split("\\").join("/");
    if (!markdown)
      return failure(`${relativePath} is empty; nothing was imported.`);
    const slug = slugFor(relativePath);
    const priorPath = pathsBySlug.get(slug);
    if (priorPath)
      return failure(
        `${priorPath} and ${relativePath} map to the same page slug (${slug}); nothing was imported.`,
      );
    pathsBySlug.set(slug, relativePath);
    prepared.push({
      path,
      relativePath,
      slug,
      markdown,
      importSourceKey: `cli-import:${slug}`,
    });
  }
  const listed = existingPages(
    await request(dependencies, {
      operationId: "brain.pages.list",
      input: { includeArchived: true },
    }),
  );
  if ("exitCode" in listed) return listed;
  const planned = planImports(prepared, listed, options.adoptExisting === true);
  if ("exitCode" in planned) return planned;
  const progress: ImportProgress = { created: [], updated: [], unchanged: [] };
  for (const candidate of planned) {
    const {
      path,
      relativePath,
      slug,
      markdown,
      importSourceKey,
      existing,
      adopt,
    } = candidate;
    const title = markdownTitle(path, markdown);
    if (!adopt && existing?.markdown === markdown && existing.title === title) {
      progress.unchanged.push(relativePath);
      continue;
    }
    const result = existing
      ? await request(dependencies, {
          operationId: "brain.pages.updateMarkdown",
          input: {
            pageId: existing._id,
            title,
            markdown,
            ...(adopt
              ? { adoptImportSourceKey: importSourceKey }
              : { expectedImportSourceKey: importSourceKey }),
            expectedUpdatedAt: existing.updatedAt,
          },
          idempotencyKey: createHash("sha256")
            .update(`${existing._id}\0${existing.updatedAt}\0${markdown}`)
            .digest("hex"),
        })
      : await request(dependencies, {
          operationId: "brain.pages.createMarkdown",
          input: {
            slug,
            title,
            markdown,
            importSourceKey,
          },
          idempotencyKey: createHash("sha256")
            .update(`${relativePath}\0${markdown}`)
            .digest("hex"),
        });
    if (result.exitCode !== 0)
      return {
        ...result,
        stderr: `${result.stderr.trim() || result.stdout.trim()}\n${progressSummary(progress, planned.length)}\n`,
      };
    (existing ? progress.updated : progress.created).push(relativePath);
  }
  return success({
    ok: true,
    processed: planned.length,
    created: progress.created.length,
    updated: progress.updated.length,
    unchanged: progress.unchanged.length,
    files: progress,
  });
};
