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

const encoder = new TextEncoder();
const sha256 = (text: string): string =>
  `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const sortBy = <T>(items: T[], select: (item: T) => string): T[] =>
  [...items].sort((left, right) => select(left).localeCompare(select(right)));
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
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
  const files = [
    makeFile("sources/index.jsonl", ""),
    makeFile("citations/index.jsonl", ""),
    makeFile("revisions/pages.jsonl", ""),
    makeFile("revisions/sources.jsonl", ""),
  ];
  const manifest: BrainExportManifest = {
    formatVersion: "maestro-brain-export/v1",
    agencyKey: input.agencyKey,
    brainKey: input.brainKey,
    brainRevision: input.brainRevision,
    lifecycleGeneration: input.lifecycleGeneration,
    policyGeneration: input.policyGeneration,
    createdAt: input.createdAt,
    files: Object.fromEntries(files.map((file) => [file.path, file.hash])),
  };
  return {
    manifest,
    files: [
      makeFile("manifest.json", `${canonicalJson(manifest)}\n`),
      ...files,
    ],
  };
};
