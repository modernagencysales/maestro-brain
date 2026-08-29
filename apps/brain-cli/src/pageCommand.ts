import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { failure, type CliResult } from "./api.js";
import { compactMarkdownRows } from "./compactMarkdownRows.js";
import { option, request, type CliDependencies } from "./runtime.js";

export const markdownTitle = (path: string, markdown: string): string =>
  markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
  path.split(/[\\/]/u).at(-1)?.replace(/\.md$/iu, "") ??
  "Untitled";

export const slugFor = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\.md$/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80) || "page";

type MarkdownFile = { readonly path: string; readonly markdown: string };

const markdownFile = (path: string | undefined): MarkdownFile | CliResult => {
  if (!path || extname(path).toLowerCase() !== ".md")
    return failure("A Markdown file path is required.");
  try {
    const resolved = resolve(path);
    if (!lstatSync(resolved).isFile())
      return failure("Markdown path is not a file.");
    const markdown = readFileSync(resolved, "utf8").trim();
    return markdown
      ? { path: resolved, markdown }
      : failure("Markdown file is empty.");
  } catch {
    return failure(`Markdown file could not be read: ${path}`);
  }
};

const createPage = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const file = markdownFile(argv[2]);
  if ("exitCode" in file) return file;
  const slug = option(argv, "--slug") ?? slugFor(file.path);
  const title =
    option(argv, "--title") ?? markdownTitle(file.path, file.markdown);
  return await request(dependencies, {
    operationId: "brain.pages.createMarkdown",
    input: { slug, title, markdown: file.markdown },
    idempotencyKey: createHash("sha256")
      .update(`${slug}\0${file.markdown}`)
      .digest("hex"),
  });
};

const updatePage = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const pageId = argv[2];
  const file = markdownFile(argv[3]);
  if (!pageId) return failure("page update requires a page id.");
  if ("exitCode" in file) return file;
  const expected = Number(option(argv, "--expected-updated-at"));
  if (!Number.isFinite(expected))
    return failure("page update requires --expected-updated-at <ms>.");
  return await request(dependencies, {
    operationId: "brain.pages.updateMarkdown",
    input: { pageId, markdown: file.markdown, expectedUpdatedAt: expected },
    idempotencyKey: createHash("sha256")
      .update(`${pageId}\0${expected}\0${file.markdown}`)
      .digest("hex"),
  });
};

const getPage = async (
  pageId: string,
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const result = await request(dependencies, {
    operationId: "brain.pages.get",
    input: { pageId },
  });
  return result.exitCode !== 0 && result.stderr.includes("(NotFound)")
    ? failure(`Brain page not found: ${pageId}`)
    : result;
};

const history = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const pageId = argv[2]?.trim();
  if (!pageId) return failure("page history requires a page id.");
  const limit = historyLimit(argv);
  if (typeof limit === "object") return limit;
  const result = await request(dependencies, {
    operationId: "brain.pages.history",
    input: { pageId, ...(limit === undefined ? {} : { limit }) },
  });
  return argv.includes("--full") ? result : compactMarkdownRows(result);
};

const historyLimit = (
  argv: readonly string[],
): number | undefined | CliResult => {
  if (!argv.includes("--limit")) return undefined;
  const value = option(argv, "--limit");
  if (value === undefined)
    return failure("--limit requires a value between 1 and 100.");
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100
    ? limit
    : failure("--limit must be an integer between 1 and 100.");
};

export const pageCommand = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const handlers: Record<string, (() => Promise<CliResult>) | undefined> = {
    list: async () => {
      const result = await request(dependencies, {
        operationId: "brain.pages.list",
        input: { includeArchived: argv.includes("--include-archived") },
      });
      return argv.includes("--full") ? result : compactMarkdownRows(result);
    },
    get: async () =>
      argv[2]
        ? await getPage(argv[2], dependencies)
        : failure("page get requires a page id."),
    history: async () => await history(argv, dependencies),
    create: async () => await createPage(argv, dependencies),
    update: async () => await updatePage(argv, dependencies),
  };
  const handler = handlers[argv[1] ?? ""];
  return handler
    ? await handler()
    : failure("Usage: maestro-brain page <list|get|history|create|update> ...");
};
