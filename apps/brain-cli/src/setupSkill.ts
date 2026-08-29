import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  type Dirent,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { SetupArtifact } from "./setupGeneratedFile.js";

const MANAGED_ASK_APERO_SKILL_MANIFESTS = new Set([
  [
    "SKILL.md:10e9cfc71c467728f5970744b5d13556fbef8bc06663f091fd3c83d53e03ba2b",
    "references/agent-guidance.md:d6ef63473cf462d10a39e044e25a4e639464feb11248f1db7b89c6f43aa13af6",
    "references/context-pack-v3.md:6a40fbd41df87a47af252fd6de607466473a7f2e0345d50060a8c8fb6fb7cf46",
    "references/glossary.md:d0be9d876579ca1ab16b5e21567cbcd634e5c3394419bbe05fb2039f1dc7c8cc",
    "references/source-map.v1.json:c1f063a31521355343ce7d762cc2cde336a3b57698b7a6476e6ffb3fbff82f0c",
  ].join("\n"),
  "SKILL.md:f1fa5886d77ab97f70b5827ebe19a3c7f3a44bfc390ed2b29093b97e59cdef18",
  [
    "SKILL.md:37b4607a826d61de1c2f0bf84aa7e43ff67a23861406e2d773557abfcb96aa62",
    "references/evidence-reading.md:aa0260241a97103a7f826a98f96a5f4344cb7dfd512d5bb981f7df7747bb8663",
  ].join("\n"),
]);

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const byName = (left: Dirent, right: Dirent): number => {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
};

const manifestEntry = (
  root: string,
  prefix: string,
  entry: Dirent,
): string | undefined => {
  const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
  const absolute = join(root, entry.name);
  if (entry.isDirectory()) return directoryManifest(absolute, path);
  if (entry.isFile())
    return `${path}:${sha256(readFileSync(absolute, "utf8"))}`;
  return undefined;
};

const directoryManifest = (root: string, prefix = ""): string | undefined => {
  const records: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true }).sort(byName);
  for (const entry of entries) {
    const record = manifestEntry(root, prefix, entry);
    if (record === undefined) return undefined;
    if (record.length > 0) records.push(record);
  }
  return records.join("\n");
};

const replaceManagedSkill = (
  destination: string,
  path: string,
  source: string,
  commit: boolean,
): SetupArtifact => {
  try {
    const installed = readFileSync(join(destination, "SKILL.md"), "utf8");
    const packaged = readFileSync(join(source, "SKILL.md"), "utf8");
    if (installed === packaged) return { path, status: "unchanged" };
    const manifest = directoryManifest(destination) ?? "";
    if (!MANAGED_ASK_APERO_SKILL_MANIFESTS.has(manifest))
      return { path, status: "conflict" };
    if (commit) cpSync(source, destination, { recursive: true, force: true });
    return { path, status: "updated" };
  } catch {
    return { path, status: "conflict" };
  }
};

export const installSkill = (
  root: string,
  path: string,
  source: string,
  commit = true,
): SetupArtifact => {
  const destination = join(root, path);
  const stat = lstatSync(destination, { throwIfNoEntry: false });
  if (stat !== undefined)
    return stat.isDirectory()
      ? replaceManagedSkill(destination, path, source, commit)
      : { path, status: "conflict" };
  if (commit) {
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, errorOnExist: true });
  }
  return { path, status: "created" };
};
