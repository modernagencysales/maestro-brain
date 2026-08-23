import { formatJsonOutput } from "./result";
import type { CliResult } from "./types";

export type SetupArtifact = {
  readonly id: string;
  readonly path: string;
  readonly status: "created" | "updated" | "unchanged" | "conflict";
};

const successNextSteps = (
  artifacts: readonly SetupArtifact[],
): readonly string[] => {
  const ids = new Set(artifacts.map(({ id }) => id));
  const steps = ["Export MAESTRO_BRAIN_API_KEY in this terminal."];
  if (ids.has("codex.config"))
    steps.push(
      "Open Codex in this target and trust the project so it loads .codex/config.toml.",
      "Run codex mcp list and confirm maestro_brain appears before testing Ask Apero.",
    );
  if (ids.has("claude-code.config"))
    steps.push(
      "Restart Claude Code in this target and confirm maestro-brain appears in its MCP servers.",
    );
  if (ids.has("cowork.descriptor"))
    steps.push(
      "In Cowork add an MCP connector named maestro-brain using the descriptor transport URL, streamable HTTP, bearer authentication, and the MAESTRO_BRAIN_API_KEY value as its token.",
    );
  steps.push(
    "Run doctor with the same CLI invocation and environment used for setup.",
  );
  return steps;
};

export const setupOutput = (
  ok: boolean,
  target: string,
  artifacts: readonly SetupArtifact[],
): CliResult => ({
  exitCode: ok ? 0 : 1,
  stdout: formatJsonOutput({
    ok,
    target,
    artifacts,
    next: ok
      ? successNextSteps(artifacts)
      : [
          "Resolve each conflict without overwriting teammate-owned config.",
          "Rerun the same setup command.",
        ],
  }),
  stderr: "",
});
