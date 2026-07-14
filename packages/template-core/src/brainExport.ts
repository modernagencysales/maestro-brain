import { createHash } from "node:crypto";

export class ExportPathConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportPathConflict";
  }
}
export class ExportReferenceMissing extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportReferenceMissing";
  }
}
export class ExportValueUnsafe extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportValueUnsafe";
  }
}
export class ExportLifecycleDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportLifecycleDenied";
  }
}

export type BrainExportLifecycleState =
  "active" | "archived" | "redacted" | "purged";
export type BrainExportPage = {
  pageKey: string;
  parentPageKey: string | null;
  path: string;
  title: string;
  body: string;
  revisionKey: string;
  updatedAt: string;
  citationKeys: string[];
};
export type BrainExportSource = {
  sourceKey: string;
  title: string;
  kind: string;
  lifecycleState: BrainExportLifecycleState;
  revisionKey: string;
  contentHash: string;
  updatedAt: string;
  readonly [key: string]: unknown;
};
export type BrainExportCitation = {
  citationKey: string;
  pageKey: string;
  sourceKey: string;
  quote: string;
  revisionKey: string;
};
export type BrainExportInput = {
  agencyKey: string;
  brainKey: string;
  brainRevision: string;
  createdAt: string;
  lifecycleGeneration: number;
  policyGeneration: number;
  pages: BrainExportPage[];
  sources: BrainExportSource[];
  citations: BrainExportCitation[];
};
export type BrainExportFile = {
  path: string;
  text: string;
  bytes: Uint8Array;
  hash: string;
};
export type BrainExportManifest = {
  formatVersion: "maestro-brain-export/v1";
  agencyKey: string;
  brainKey: string;
  brainRevision: string;
  lifecycleGeneration: number;
  policyGeneration: number;
  createdAt: string;
  files: Record<string, string>;
};
export type BrainExportBundle = {
  manifest: BrainExportManifest;
  files: BrainExportFile[];
};

const unsafeValuePattern =
  /\b(?:[a-z0-9]{20,}|(?:api|access|refresh|secret|token)[_-]?[a-z0-9]*[:=][^\s"']+)/i;
const encoder = new TextEncoder();
const sha256 = (text: string): string =>
  `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const sortBy = <T>(items: T[], select: (item: T) => string): T[] =>
  [...items].sort((left, right) => select(left).localeCompare(select(right)));

const assertSafeText = (field: string, value: string): void => {
  if (value.includes("\0") || unsafeValuePattern.test(value)) {
    throw new ExportValueUnsafe(`${field} contains unsafe export data`);
  }
};
const assertSafeObject = (field: string, value: unknown): void => {
  if (value === undefined) return;
  if (field.toLowerCase().includes("provider")) {
    throw new ExportValueUnsafe(`${field} is not exportable`);
  }
  if (typeof value === "string") assertSafeText(field, value);
  else if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeObject(`${field}.${index}`, item));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) =>
      assertSafeObject(`${field}.${key}`, entry),
    );
  }
};
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
};
const jsonLine = (value: unknown): string => `${canonicalJson(value)}\n`;
const slugSegment = (segment: string): string => {
  assertSafeText("path", segment);
  const slug = segment
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug || slug === "." || slug === "..") {
    throw new ExportValueUnsafe(`unsafe export path segment: ${segment}`);
  }
  return slug;
};
const pagePath = (path: string): string => {
  if (path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new ExportValueUnsafe(`unsafe export path: ${path}`);
  }
  return `pages/${path.split("/").map(slugSegment).join("/")}.md`;
};
const relativeMarkdownPath = (from: string, to: string): string => {
  const fromParts = from.replace(/^pages\//, "").split("/");
  fromParts.pop();
  const toParts = to.replace(/^pages\//, "").split("/");
  while (fromParts[0] && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return [...fromParts.map(() => ".."), ...toParts].join("/") || "./";
};
const makeFile = (path: string, text: string): BrainExportFile => ({
  path,
  text,
  bytes: encoder.encode(text),
  hash: sha256(text),
});

export const encodeBrainExport = (
  input: BrainExportInput,
): BrainExportBundle => {
  assertSafeObject("export", input);
  const sourcesByKey = new Map(
    input.sources.map((source) => [source.sourceKey, source]),
  );
  const citationsByKey = new Map(
    input.citations.map((citation) => [citation.citationKey, citation]),
  );
  const pagesByKey = new Map(input.pages.map((page) => [page.pageKey, page]));
  const pathByPageKey = new Map<string, string>();
  const seenPaths = new Map<string, string>();
  for (const page of input.pages) {
    const path = pagePath(page.path);
    const previous = seenPaths.get(path);
    if (previous && previous !== page.pageKey) {
      throw new ExportPathConflict(`duplicate export path: ${path}`);
    }
    seenPaths.set(path, page.pageKey);
    pathByPageKey.set(page.pageKey, path);
  }
  for (const source of input.sources) {
    if (source.lifecycleState !== "active") {
      throw new ExportLifecycleDenied(
        `source is not exportable: ${source.sourceKey}`,
      );
    }
  }
  for (const page of input.pages) {
    if (page.parentPageKey !== null && !pagesByKey.has(page.parentPageKey)) {
      throw new ExportReferenceMissing(
        `missing parent page: ${page.parentPageKey}`,
      );
    }
    for (const citationKey of page.citationKeys) {
      const citation = citationsByKey.get(citationKey);
      if (!citation || citation.pageKey !== page.pageKey) {
        throw new ExportReferenceMissing(
          `missing page citation: ${citationKey}`,
        );
      }
    }
  }
  for (const citation of input.citations) {
    if (!pagesByKey.has(citation.pageKey)) {
      throw new ExportReferenceMissing(
        `missing citation page: ${citation.pageKey}`,
      );
    }
    if (!sourcesByKey.has(citation.sourceKey)) {
      throw new ExportReferenceMissing(
        `missing citation source: ${citation.sourceKey}`,
      );
    }
  }
  const sortedPages = sortBy(input.pages, (page) =>
    pathByPageKey.get(page.pageKey)!,
  );
  const pageFiles = sortedPages.map((page) => {
    const path = pathByPageKey.get(page.pageKey)!;
    const body = page.body.replace(
      /\[\[([^\]]+)\]\]/g,
      (match, pageKey: string) => {
        const target = pagesByKey.get(pageKey);
        const targetPath = pathByPageKey.get(pageKey);
        return target && targetPath
          ? `[${target.title}](${relativeMarkdownPath(path, targetPath)})`
          : match;
      },
    );
    return makeFile(
      path,
      `---\npageKey: ${JSON.stringify(page.pageKey)}\nrevisionKey: ${JSON.stringify(
        page.revisionKey,
      )}\nupdatedAt: ${JSON.stringify(page.updatedAt)}\n---\n\n# ${page.title}\n\n${body}\n`,
    );
  });
  const sourcesFile = makeFile(
    "sources/index.jsonl",
    sortBy(input.sources, (source) => source.sourceKey)
      .map((source) =>
        jsonLine({
          contentHash: source.contentHash,
          kind: source.kind,
          revisionKey: source.revisionKey,
          sourceKey: source.sourceKey,
          title: source.title,
          updatedAt: source.updatedAt,
        }),
      )
      .join(""),
  );
  const citationsFile = makeFile(
    "citations/index.jsonl",
    sortBy(input.citations, (citation) => citation.citationKey)
      .map((citation) => jsonLine(citation))
      .join(""),
  );
  const pageRevisionsFile = makeFile(
    "revisions/pages.jsonl",
    sortBy(input.pages, (page) => page.revisionKey)
      .map((page) =>
        jsonLine({
          pageKey: page.pageKey,
          revisionKey: page.revisionKey,
          updatedAt: page.updatedAt,
        }),
      )
      .join(""),
  );
  const sourceRevisionsFile = makeFile(
    "revisions/sources.jsonl",
    sortBy(input.sources, (source) => source.revisionKey)
      .map((source) =>
        jsonLine({
          contentHash: source.contentHash,
          revisionKey: source.revisionKey,
          sourceKey: source.sourceKey,
          updatedAt: source.updatedAt,
        }),
      )
      .join(""),
  );
  const contentFiles = [
    pageFiles,
    sourcesFile,
    citationsFile,
    pageRevisionsFile,
    sourceRevisionsFile,
  ].flat();
  const manifest: BrainExportManifest = {
    formatVersion: "maestro-brain-export/v1",
    agencyKey: input.agencyKey,
    brainKey: input.brainKey,
    brainRevision: input.brainRevision,
    lifecycleGeneration: input.lifecycleGeneration,
    policyGeneration: input.policyGeneration,
    createdAt: input.createdAt,
    files: Object.fromEntries(
      contentFiles.map((file) => [file.path, file.hash]),
    ),
  };
  const manifestFile = makeFile(
    "manifest.json",
    `${canonicalJson(manifest)}\n`,
  );
  const orderedPaths = [
    "manifest.json",
    ...sortedPages.map((page) => pathByPageKey.get(page.pageKey)!),
    "sources/index.jsonl",
    "citations/index.jsonl",
    "revisions/pages.jsonl",
    "revisions/sources.jsonl",
  ];
  const filesByPath = new Map(
    [manifestFile, ...contentFiles].map((file) => [file.path, file]),
  );
  return {
    manifest,
    files: orderedPaths.map((path) => filesByPath.get(path)!),
  };
};
