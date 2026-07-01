import { pathToFileURL } from "node:url";

export function isDirectRun(
  importMetaUrl: string,
  argv = process.argv,
): boolean {
  const entry = argv[1];
  return entry !== undefined && pathToFileURL(entry).href === importMetaUrl;
}
