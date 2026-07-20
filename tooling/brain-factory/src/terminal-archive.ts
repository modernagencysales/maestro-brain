import { resolve } from "node:path";

import {
  acquireDispatcherLock,
  archiveTerminalTaskRecord,
} from "./dispatch-ownership.js";

const terminalStatuses = new Set([
  "canceled",
  "cancelled",
  "failed",
  "succeeded",
]);

export const archiveTerminalRun = (input: {
  readonly actionId: string;
  readonly inspect: (runId: string) => string | undefined;
  readonly now: string;
  readonly runId: string;
  readonly state: string;
  readonly taskId: string;
}): string => {
  let status: string | undefined;
  try {
    status = input.inspect(input.runId);
  } catch (error) {
    throw new Error(`${input.taskId}: terminal run inspection failed`, {
      cause: error,
    });
  }
  if (status === undefined) {
    throw new Error(`${input.taskId}: terminal run status is unknown`);
  }
  if (!terminalStatuses.has(status)) {
    throw new Error(
      `${input.taskId}: run ${input.runId} is not terminal (${status})`,
    );
  }

  const auditPath = resolve(input.state, "recovery-audit.jsonl");
  const release = acquireDispatcherLock({
    auditPath,
    lockPath: resolve(input.state, "dispatch.lock"),
    now: input.now,
    owner: {
      actionId: input.actionId,
      mode: "archive-terminal",
      pid: process.pid,
      runId: input.runId,
      startedAt: input.now,
      taskId: input.taskId,
    },
  });
  try {
    return archiveTerminalTaskRecord({
      actionId: input.actionId,
      auditPath,
      now: input.now,
      recordPath: resolve(input.state, "runs", `${input.taskId}.json`),
      runId: input.runId,
      status,
      taskId: input.taskId,
    });
  } finally {
    release();
  }
};
