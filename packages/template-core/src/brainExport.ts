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
  lifecycleState: BrainExportLifecycleState;
  lifecycleGeneration: number;
  revisionKey: string;
  updatedAt: string;
  citationKeys: string[];
};
export type BrainExportSource = {
  sourceKey: string;
  title: string;
  kind: string;
  lifecycleState: BrainExportLifecycleState;
  lifecycleGeneration: number;
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
  lifecycleState: BrainExportLifecycleState;
  lifecycleGeneration: number;
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
const safeHashPattern = /^sha256:[a-f0-9]{64}$/i;
const encoder = new TextEncoder();
const getAt = <T>(items: ArrayLike<T>, index: number): T => {
  const item = items[index];
  if (item === undefined) {
    throw new ExportReferenceMissing(`missing export value at index ${index}`);
  }
  return item;
};
const getMapValue = <K, V>(items: Map<K, V>, key: K, label: string): V => {
  const item = items.get(key);
  if (item === undefined) {
    throw new ExportReferenceMissing(`missing ${label}: ${String(key)}`);
  }
  return item;
};
const sha256RoundConstants = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;
const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));
const sha256 = (text: string): string => {
  const bytes = encoder.encode(text);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  new DataView(padded.buffer).setUint32(paddedLength - 4, bytes.length * 8);
  const view = new DataView(padded.buffer);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = getAt(words, index - 15);
      const right = getAt(words, index - 2);
      const s0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const s1 =
        rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] =
        (getAt(words, index - 16) + s0 + getAt(words, index - 7) + s1) >>> 0;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 =
        (h +
          s1 +
          ch +
          getAt(sha256RoundConstants, index) +
          getAt(words, index)) >>>
        0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return `sha256:${[h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("")}`;
};
const sortBy = <T>(items: T[], select: (item: T) => string): T[] =>
  [...items].sort((left, right) => select(left).localeCompare(select(right)));

const assertSafeText = (field: string, value: string): void => {
  if (
    value.includes("\0") ||
    (!safeHashPattern.test(value) && unsafeValuePattern.test(value))
  ) {
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
  const assertExportableLifecycle = (item: {
    readonly kind: "page" | "source" | "citation";
    readonly key: string;
    readonly lifecycleState: BrainExportLifecycleState;
    readonly lifecycleGeneration: number;
  }): void => {
    if (item.lifecycleState !== "active") {
      throw new ExportLifecycleDenied(
        `${item.kind} is not exportable: ${item.key}`,
      );
    }
    if (item.lifecycleGeneration !== input.lifecycleGeneration) {
      throw new ExportLifecycleDenied(
        `${item.kind} lifecycle generation is stale: ${item.key}`,
      );
    }
  };
  for (const page of input.pages) {
    assertExportableLifecycle({
      kind: "page",
      key: page.pageKey,
      lifecycleState: page.lifecycleState,
      lifecycleGeneration: page.lifecycleGeneration,
    });
  }
  for (const source of input.sources) {
    assertExportableLifecycle({
      kind: "source",
      key: source.sourceKey,
      lifecycleState: source.lifecycleState,
      lifecycleGeneration: source.lifecycleGeneration,
    });
  }
  for (const citation of input.citations) {
    assertExportableLifecycle({
      kind: "citation",
      key: citation.citationKey,
      lifecycleState: citation.lifecycleState,
      lifecycleGeneration: citation.lifecycleGeneration,
    });
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
    getMapValue(pathByPageKey, page.pageKey, "page path"),
  );
  const pageFiles = sortedPages.map((page) => {
    const path = getMapValue(pathByPageKey, page.pageKey, "page path");
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
          lifecycleGeneration: page.lifecycleGeneration,
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
          lifecycleGeneration: source.lifecycleGeneration,
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
    ...sortedPages.map((page) =>
      getMapValue(pathByPageKey, page.pageKey, "page path"),
    ),
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
    files: orderedPaths.map((path) =>
      getMapValue(filesByPath, path, "export file"),
    ),
  };
};
