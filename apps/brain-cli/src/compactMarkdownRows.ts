import { success, type CliResult } from "./api.js";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

const parse = (value: string): Record<string, unknown> | undefined => {
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
};

const compactRow = (value: unknown): unknown => {
  const row = record(value);
  if (row === undefined) return value;
  const { markdown, ...metadata } = row;
  const markdownBytes =
    typeof markdown === "string"
      ? Buffer.byteLength(markdown, "utf8")
      : undefined;
  return markdownBytes === undefined
    ? metadata
    : { ...metadata, markdownBytes };
};

export const compactMarkdownRows = (result: CliResult): CliResult => {
  if (result.exitCode !== 0) return result;
  const body = parse(result.stdout);
  const rows = body?.result;
  return body === undefined || !Array.isArray(rows)
    ? result
    : success({ ...body, result: rows.map(compactRow) });
};
