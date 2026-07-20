import { createHash } from "node:crypto";

export type CheckpointJson = Record<string, unknown>;
export type CheckpointGit = (args: readonly string[]) => string;

export const checkpointHash = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

export const checkpointJson = (
  value: string,
  label: string,
): CheckpointJson => {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`${label} must be an object`);
  return parsed as CheckpointJson;
};

export const checkpointLines = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const checkpointSame = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const assertCheckpointRefBlob = (
  git: CheckpointGit,
  readBlob: (objectSha: string) => string,
  ref: string,
  objectSha: string,
  contentSha256?: string,
): string => {
  let actual: string;
  let type: string;
  let content: string;
  try {
    actual = git(["rev-parse", ref]);
    type = git(["cat-file", "-t", objectSha]);
    content = readBlob(objectSha);
  } catch {
    throw new Error(`checkpoint immutable ref is missing: ${ref}`);
  }
  if (
    actual !== objectSha ||
    type !== "blob" ||
    (contentSha256 !== undefined && checkpointHash(content) !== contentSha256)
  )
    throw new Error(`checkpoint immutable ref drifted: ${ref}`);
  return content;
};
