import { callMcpTool, failure, type CliResult } from "./api.js";
import {
  configFor,
  isCliResult,
  option,
  type CliDependencies,
} from "./runtime.js";

const search = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const limitOption = option(argv, "--limit");
  const limit = limitOption === undefined ? undefined : Number(limitOption);
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > 10)
  )
    return failure("evidence search --limit must be an integer from 1 to 10.");
  const optionIndex = argv.indexOf("--limit");
  if (optionIndex >= 0 && optionIndex !== argv.length - 2)
    return failure("--limit must be the final evidence search option.");
  const query = argv
    .slice(2, optionIndex === -1 ? undefined : optionIndex)
    .join(" ")
    .trim();
  if (!query) return failure("evidence search requires a query.");
  const config = configFor(dependencies);
  return isCliResult(config)
    ? config
    : await callMcpTool(
        config,
        dependencies.fetch,
        "template.brain.evidence.search",
        { query, ...(limit === undefined ? {} : { limit }) },
      );
};

const sourceGet = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const sourceKey = argv[2]?.trim();
  const revisionKey = argv[3]?.trim();
  if (!sourceKey || !revisionKey || argv.length !== 4)
    return failure("evidence source-get requires <source-key> <revision-key>.");
  const config = configFor(dependencies);
  return isCliResult(config)
    ? config
    : await callMcpTool(
        config,
        dependencies.fetch,
        "template.brain.evidence.sourceGet",
        { sourceKey, revisionKey },
      );
};

const open = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const sourceKey = argv[2]?.trim();
  const revisionKey = option(argv, "--revision")?.trim();
  if (!sourceKey || !revisionKey || argv.length !== 5)
    return failure(
      "evidence open requires <source-key> --revision <revision-key>.",
    );
  return await sourceGet(
    [argv[0] ?? "evidence", "source-get", sourceKey, revisionKey],
    dependencies,
  );
};

const health = async (dependencies: CliDependencies): Promise<CliResult> => {
  const config = configFor(dependencies);
  return isCliResult(config)
    ? config
    : await callMcpTool(
        config,
        dependencies.fetch,
        "template.brain.evidence.health",
        {},
      );
};

export const evidenceCommand = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const normalizedArgv = argv.filter((argument) => argument !== "--json");
  if (normalizedArgv[1] === "search")
    return await search(normalizedArgv, dependencies);
  if (normalizedArgv[1] === "open")
    return await open(normalizedArgv, dependencies);
  if (normalizedArgv[1] === "source-get")
    return await sourceGet(normalizedArgv, dependencies);
  if (normalizedArgv[1] === "health" && normalizedArgv.length === 2)
    return await health(dependencies);
  return failure(
    "Usage: maestro-brain evidence search <query> [--limit <1-10>] | evidence open <source-key> --revision <revision-key> | evidence source-get <source-key> <revision-key> | evidence health",
  );
};
