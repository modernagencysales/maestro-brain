import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { setupBrainEnvironment, type SetupRuntime } from "./environmentSetup";
import { cliFailure } from "./result";
import type { CliResult, CliRuntimeConfig } from "./types";

const bundledSkillSourceDirectory = fileURLToPath(
  new URL("../../../company-context/skills/ask-apero", import.meta.url),
);

const runtimeNames = new Set<SetupRuntime>(["codex", "claude-code", "cowork"]);

type RuntimeResult =
  | {
      readonly ok: true;
      readonly runtime: SetupRuntime;
      readonly optionIndex: number;
    }
  | { readonly ok: false };

const runtimeFrom = (token: string | undefined): RuntimeResult => {
  if (token === undefined || token.startsWith("--"))
    return { ok: true, runtime: "all", optionIndex: 1 };
  return runtimeNames.has(token as SetupRuntime)
    ? { ok: true, runtime: token as SetupRuntime, optionIndex: 2 }
    : { ok: false };
};

const inlineRepoValue = (token: string): string | undefined =>
  token.startsWith("--repo=") ? token.slice("--repo=".length) : undefined;

const repoFrom = (
  argv: readonly string[],
  optionIndex: number,
  currentDirectory: string,
): string | undefined => {
  const options = argv.slice(optionIndex);
  if (options.length === 0) return currentDirectory;
  const inline = inlineRepoValue(options[0] ?? "");
  if (options.length === 1 && inline) return resolve(currentDirectory, inline);
  return options.length === 2 && options[0] === "--repo" && options[1]
    ? resolve(currentDirectory, options[1])
    : undefined;
};

const usageFailure = (): CliResult =>
  cliFailure(
    "setup accepts an optional runtime followed by --repo <project-directory>.\n",
  );

export const runSetupCommand = (
  argv: readonly string[],
  config: CliRuntimeConfig,
  currentDirectory: string = process.cwd(),
  skillSourceDirectory: string = bundledSkillSourceDirectory,
): CliResult | undefined => {
  if (argv[0] !== "setup") return undefined;
  const runtime = runtimeFrom(argv[1]);
  if (!runtime.ok) return usageFailure();
  const repoRoot = repoFrom(argv, runtime.optionIndex, currentDirectory);
  return repoRoot === undefined
    ? usageFailure()
    : setupBrainEnvironment({
        repoRoot,
        siteUrl: config.brainSiteUrl,
        runtime: runtime.runtime,
        skillSourceDirectory,
      });
};
