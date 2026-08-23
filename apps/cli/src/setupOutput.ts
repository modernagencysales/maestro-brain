import { formatJsonOutput } from "./result";
import type { CliResult } from "./types";

type SetupArtifact = {
  readonly id: string;
  readonly path: string;
  readonly status: "created" | "updated" | "unchanged" | "conflict";
};

export const setupOutput = (
  ok: boolean,
  artifacts: readonly SetupArtifact[],
): CliResult => ({
  exitCode: ok ? 0 : 1,
  stdout: formatJsonOutput({
    ok,
    artifacts,
    next: ok
      ? [
          "Export MAESTRO_BRAIN_API_KEY in this terminal.",
          "Run pnpm brain doctor.",
        ]
      : [
          "Resolve each conflict without overwriting teammate-owned config.",
          "Rerun the same setup command.",
        ],
  }),
  stderr: "",
});
