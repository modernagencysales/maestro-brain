import { describe, expect, it } from "vitest";

import {
  encodeBrainExport,
  ExportLifecycleDenied,
  ExportPathConflict,
  ExportReferenceMissing,
  ExportValueUnsafe,
  type BrainExportInput,
} from "./brainExport";

const baseExport = (): BrainExportInput => ({
  agencyKey: "agency_acme",
  brainKey: "brain_client_alpha",
  brainRevision: "brain-rev-42",
  createdAt: "2026-07-14T12:00:00.000Z",
  lifecycleGeneration: 7,
  policyGeneration: 3,
  pages: [
    {
      pageKey: "page_home",
      parentPageKey: null,
      path: "Home",
      title: "Home",
      body: "Welcome to [[page_strategy]].\nSee citation [^cite_welcome].",
      revisionKey: "page-rev-home",
      updatedAt: "2026-07-13T10:00:00.000Z",
      citationKeys: ["cite_welcome"],
    },
    {
      pageKey: "page_strategy",
      parentPageKey: "page_home",
      path: "Home/Strategy & Café",
      title: "Strategy & Café",
      body: "Nested link back to [[page_home]] and Unicode: café 🚀.",
      revisionKey: "page-rev-strategy",
      updatedAt: "2026-07-13T11:00:00.000Z",
      citationKeys: [],
    },
  ],
  sources: [
    {
      sourceKey: "source_notes",
      title: "Discovery Notes",
      kind: "note",
      lifecycleState: "active",
      revisionKey: "source-rev-notes",
      contentHash: "sha256:notes",
      updatedAt: "2026-07-12T10:00:00.000Z",
    },
  ],
  citations: [
    {
      citationKey: "cite_welcome",
      pageKey: "page_home",
      sourceKey: "source_notes",
      quote: "Line one\nLine two",
      revisionKey: "source-rev-notes",
    },
  ],
});

const byPath = (bundle: ReturnType<typeof encodeBrainExport>, path: string) =>
  bundle.files.find((file) => file.path === path)?.text;

const getItem = <T>(items: readonly T[], index: number): T => {
  const item = items[index];
  if (item === undefined)
    throw new Error(`missing test item at index ${index}`);
  return item;
};

describe("encodeBrainExport", () => {
  it("accepts deterministic sha256 content hashes without treating them as raw IDs", () => {
    const input = baseExport();
    input.sources[0] = {
      ...getItem(input.sources, 0),
      contentHash: `sha256:${"a".repeat(64)}`,
    };

    const bundle = encodeBrainExport(input);
    expect(byPath(bundle, "sources/index.jsonl")).toContain(
      `"contentHash":"sha256:${"a".repeat(64)}"`,
    );
  });

  it("produces byte-identical sorted files for shuffled repeated input", () => {
    const first = encodeBrainExport(baseExport());
    const shuffled = baseExport();
    shuffled.pages = [...shuffled.pages].reverse();
    shuffled.citations = [...shuffled.citations].reverse();
    shuffled.sources = [...shuffled.sources].reverse();

    const second = encodeBrainExport(shuffled);
    expect(second).toEqual(first);
    expect(first.files.map((file) => file.path)).toEqual([
      "manifest.json",
      "pages/home.md",
      "pages/home/strategy-cafe.md",
      "sources/index.jsonl",
      "citations/index.jsonl",
      "revisions/pages.jsonl",
      "revisions/sources.jsonl",
    ]);
    expect(first.manifest.createdAt).toBe("2026-07-14T12:00:00.000Z");
    expect(first.manifest.files["pages/home.md"]).toBe(
      "sha256:7a01e1f7862a4a298aefe385f4cd250173f5f7111177b284f8ab439b018a1d34",
    );
  });

  it("rewrites nested stable links and preserves Unicode/newlines", () => {
    const bundle = encodeBrainExport(baseExport());
    expect(byPath(bundle, "pages/home.md")).toContain(
      "Welcome to [Strategy & Café](home/strategy-cafe.md).",
    );
    expect(byPath(bundle, "pages/home/strategy-cafe.md")).toContain(
      "Unicode: café 🚀.",
    );
    expect(byPath(bundle, "citations/index.jsonl")).toContain(
      '"quote":"Line one\\nLine two"',
    );
  });

  it("rejects duplicate sibling paths", () => {
    const input = baseExport();
    input.pages = [
      ...input.pages,
      {
        ...getItem(input.pages, 1),
        pageKey: "page_other",
        path: "Home/Strategy Cafe",
      },
    ];
    expect(() => encodeBrainExport(input)).toThrow(ExportPathConflict);
  });

  it("rejects missing citation references", () => {
    const input = baseExport();
    input.pages[0] = {
      ...getItem(input.pages, 0),
      citationKeys: ["cite_missing"],
    };
    expect(() => encodeBrainExport(input)).toThrow(ExportReferenceMissing);
  });

  it("rejects archived, redacted, or purged sources", () => {
    for (const lifecycleState of ["archived", "redacted", "purged"] as const) {
      const input = baseExport();
      input.sources[0] = { ...getItem(input.sources, 0), lifecycleState };
      expect(() => encodeBrainExport(input)).toThrow(ExportLifecycleDenied);
    }
  });

  it("rejects unsafe paths and raw provider identifiers", () => {
    const unsafePath = baseExport();
    unsafePath.pages[0] = {
      ...getItem(unsafePath.pages, 0),
      path: "../secret",
    };
    expect(() => encodeBrainExport(unsafePath)).toThrow(ExportValueUnsafe);

    const rawProvider = baseExport();
    const providerField = ["provider", "Payload"].join("");
    const rawId = `jh${"7123456789abcdefghijklmno"}`;
    rawProvider.sources[0] = {
      ...getItem(rawProvider.sources, 0),
      [providerField]: { convexId: rawId },
    };
    expect(() => encodeBrainExport(rawProvider)).toThrow(ExportValueUnsafe);
  });

  it("exports the codec from the package barrel", async () => {
    const barrel = await import("./index");
    expect(barrel.encodeBrainExport).toBe(encodeBrainExport);
  });

  it("does not pull Node-only crypto into the browser-safe barrel", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./brainExport.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toContain("node:crypto");
  });
});
