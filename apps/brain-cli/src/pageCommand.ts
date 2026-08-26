import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { failure, success, type CliResult } from "./api.js";
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

const compactPageList = (result: CliResult): CliResult => {
  if (result.exitCode !== 0) return result;
  try {
    const body = JSON.parse(result.stdout) as { result?: unknown };
    if (!Array.isArray(body.result)) return result;
    const pages = body.result.map((page) => {
      if (page === null || typeof page !== "object") return page;
      const { markdown, ...metadata } = page as Record<string, unknown>;
      return {
        ...metadata,
        ...(typeof markdown === "string"
          ? { markdownBytes: Buffer.byteLength(markdown, "utf8") }
          : {}),
      };
    });
    return success({ ...body, result: pages });
  } catch {
    return result;
  }
};

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
      return argv.includes("--full") ? result : compactPageList(result);
    },
    get: async () =>
      argv[2]
        ? await getPage(argv[2], dependencies)
        : failure("page get requires a page id."),
    create: async () => await createPage(argv, dependencies),
    update: async () => await updatePage(argv, dependencies),
  };
  const handler = handlers[argv[1] ?? ""];
  return handler
    ? await handler()
    : failure("Usage: maestro-brain page <list|get|create|update> ...");
};
