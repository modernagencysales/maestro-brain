import { atomicWrite } from "./evidence-write.js";

export const materializeBuildTaskRunConfig = (input: {
  readonly env: NodeJS.ProcessEnv;
  readonly graph: string;
  readonly path: string;
}): string => {
  const entries = Object.entries(input.env)
    .filter(
      (entry): entry is [string, string] =>
        entry[0].startsWith("BRAIN_") && entry[1] !== undefined,
    )
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) throw new Error("build task environment is empty");
  for (const [key, value] of entries) {
    if (!/^BRAIN_[A-Z0-9_]+$/.test(key) || value.includes("\0"))
      throw new Error(`unsafe build task environment key ${key}`);
  }
  const content = [
    "_version = 1",
    "",
    "[workflow]",
    `graph = ${JSON.stringify(input.graph)}`,
    "",
    "[environments.local]",
    'provider = "local"',
    "",
    "[environments.local.env]",
    ...entries.map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
    "",
  ].join("\n");
  atomicWrite(input.path, content);
  return input.path;
};
