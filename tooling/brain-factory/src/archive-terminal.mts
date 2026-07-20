import { resolve } from "node:path";

import { runRtk } from "./process.js";
import { archiveTerminalRun } from "./terminal-archive.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const taskId = valueAfter("--task");
const runId = valueAfter("--run");
const actionId = valueAfter("--action-id");
if (!taskId || !runId || !actionId) {
  throw new Error(
    "usage: brain:factory:archive-terminal -- --task <id> --run <id> --action-id <id> [--state <path>]",
  );
}
if (!/^S\d{2}-T\d{2}$/.test(taskId)) throw new Error("invalid task ID");
if (!/^[0-9a-f]{64}$/.test(actionId)) throw new Error("invalid action ID");

const state = resolve(valueAfter("--state") ?? ".fabro/state/maestro-brain");
const inspect = (candidateRunId: string): string | undefined => {
  const parsed = JSON.parse(
    runRtk(["fabro", "inspect", candidateRunId, "--json", "--quiet"], {
      quiet: true,
    }),
  ) as
    | { status?: { kind?: string } | string }
    | readonly { status?: { kind?: string } | string }[];
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  return typeof item?.status === "string" ? item.status : item?.status?.kind;
};

const archivedPath = archiveTerminalRun({
  actionId,
  inspect,
  now: new Date().toISOString(),
  runId,
  state,
  taskId,
});
console.log(JSON.stringify({ actionId, archivedPath, runId, taskId }));
