import { formatJsonOutput } from "./result";
import type { CliResult } from "./types";

export type SetupArtifact = {
  readonly id: string;
  readonly path: string;
  readonly status: "created" | "updated" | "unchanged" | "conflict";
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
      ? [
          "Export MAESTRO_BRAIN_API_KEY in this terminal.",
          "Run the doctor command with the same CLI invocation.",
        ]
      : [
          "Resolve each conflict without overwriting teammate-owned config.",
          "Rerun the same setup command.",
        ],
  }),
  stderr: "",
});
