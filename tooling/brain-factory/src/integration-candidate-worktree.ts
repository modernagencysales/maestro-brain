import { existsSync } from "node:fs";

import { gitSha, safeAbsolutePath } from "./integration-recovery.js";
import { runRtk } from "./process.js";

interface JsonRecord {
  readonly [key: string]: unknown;
}

const record = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return value as JsonRecord;
};

export const durableTaskWorkdir = (
  reservation: unknown,
  taskId: string,
): string | undefined => {
  if (reservation === undefined) return undefined;
  const value = record(reservation, `${taskId}: task reservation`);
  if (value.taskId !== taskId) {
    throw new Error(`${taskId}: reservation task identity mismatch`);
  }
  return safeAbsolutePath(value.workdir, `${taskId}: reservation workdir`);
};

export interface DurableTaskWorktreeProbe {
  readonly exists: boolean;
  readonly headSha?: string;
  readonly porcelain?: string;
}

export const probeDurableTaskWorktree = (
  workdir: string,
): DurableTaskWorktreeProbe => {
  if (!existsSync(workdir)) return { exists: false };
  try {
    return {
      exists: true,
      headSha: gitSha(
        runRtk(["proxy", "git", "rev-parse", "HEAD"], {
          cwd: workdir,
          quiet: true,
        }),
        "durable task worktree HEAD",
      ),
      porcelain: runRtk(
        ["proxy", "git", "status", "--porcelain", "--untracked-files=all"],
        { cwd: workdir, quiet: true },
      ),
    };
  } catch {
    return { exists: true };
  }
};

export const durableTaskWorktreeMatchesEvidence = (input: {
  readonly evidenceHeadSha: string;
  readonly probe?: (workdir: string) => DurableTaskWorktreeProbe;
  readonly taskId: string;
  readonly workdir?: string | undefined;
}): boolean => {
  if (input.workdir === undefined) return true;
  const state = (input.probe ?? probeDurableTaskWorktree)(input.workdir);
  if (!state.exists) return true;
  return (
    state.porcelain === "" &&
    state.headSha ===
      gitSha(input.evidenceHeadSha, `${input.taskId}: evidence head`)
  );
};
