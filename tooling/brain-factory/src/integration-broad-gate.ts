import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { runRtk } from "./process.js";

export const BROAD_GATE_COMMAND = "rtk host-test-slot --class full pnpm verify";
export const TRANSIENT_VITEST_RPC_TIMEOUT = 'Timeout calling "onTaskUpdate"';

export interface BroadGateAttempt {
  readonly attempt: number;
  readonly command: typeof BROAD_GATE_COMMAND;
  readonly headSha: string;
  readonly outputSha256: string;
  readonly status: "failed" | "passed";
  readonly transientVitestWorkerRpcTimeout: boolean;
}

export interface BroadGateReceipt {
  readonly attempts: readonly BroadGateAttempt[];
  readonly command: typeof BROAD_GATE_COMMAND;
  readonly headSha: string;
  readonly schemaVersion: "maestro-brain-broad-gate-receipt/v1";
  readonly status: "failed" | "passed";
}

interface CommandResult {
  readonly error?: Error;
  readonly output: string;
  readonly signal?: NodeJS.Signals | null;
  readonly status: number | null;
}

interface BroadGateSpawnResult {
  readonly error?: Error;
  readonly signal: NodeJS.Signals | null;
  readonly status: number | null;
}

type BroadGateSpawn = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly stdio: readonly ["ignore", number, number];
  },
) => BroadGateSpawnResult;

export interface BroadGateRunner {
  readonly head: () => string;
  readonly runVerify: () => CommandResult;
  readonly status: () => string;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const isTransientVitestWorkerRpcTimeout = (output: string): boolean =>
  output.includes(TRANSIENT_VITEST_RPC_TIMEOUT);

export const runBroadGateCommand = (
  workdir: string,
  spawn: BroadGateSpawn = spawnSync,
): CommandResult => {
  const captureDirectory = mkdtempSync(
    join(tmpdir(), "maestro-brain-broad-gate-"),
  );
  const stdoutPath = join(captureDirectory, "stdout.log");
  const stderrPath = join(captureDirectory, "stderr.log");
  let stdoutFd: number | undefined;
  let stderrFd: number | undefined;
  try {
    stdoutFd = openSync(stdoutPath, "w");
    stderrFd = openSync(stderrPath, "w");
    const result = spawn(
      "rtk",
      ["host-test-slot", "--class", "full", "pnpm", "verify"],
      { cwd: workdir, stdio: ["ignore", stdoutFd, stderrFd] },
    );
    closeSync(stdoutFd);
    stdoutFd = undefined;
    closeSync(stderrFd);
    stderrFd = undefined;
    const stdout = readFileSync(stdoutPath, "utf8");
    const stderr = readFileSync(stderrPath, "utf8");
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    return {
      ...(result.error === undefined ? {} : { error: result.error }),
      output: `${stdout}${stderr}`,
      signal: result.signal,
      status: result.status,
    };
  } finally {
    if (stdoutFd !== undefined) closeSync(stdoutFd);
    if (stderrFd !== undefined) closeSync(stderrFd);
    rmSync(captureDirectory, { force: true, recursive: true });
  }
};

export const runBroadGateAttempts = (
  expectedHead: string,
  runner: BroadGateRunner,
  priorAttempts: readonly BroadGateAttempt[] = [],
): BroadGateReceipt => {
  const attempts: BroadGateAttempt[] = [...priorAttempts];
  for (
    let invocationAttempt = 1;
    invocationAttempt <= 2;
    invocationAttempt += 1
  ) {
    const attempt = attempts.length + 1;
    if (runner.head() !== expectedHead) {
      throw new Error("integration broad gate HEAD changed before an attempt");
    }
    if (runner.status() !== "") {
      throw new Error("integration broad gate worktree is not clean");
    }
    const result = runner.runVerify();
    if (result.error !== undefined) {
      throw new Error(
        `integration broad gate command failed to spawn: ${result.error.message}`,
        { cause: result.error },
      );
    }
    if (result.signal !== undefined && result.signal !== null) {
      throw new Error(
        `integration broad gate command terminated by signal ${result.signal}`,
      );
    }
    if (result.status === null) {
      throw new Error(
        "integration broad gate command terminated without an exit status",
      );
    }
    if (runner.head() !== expectedHead || runner.status() !== "") {
      throw new Error("integration broad gate mutated its immutable head");
    }
    const transient =
      result.status !== 0 && isTransientVitestWorkerRpcTimeout(result.output);
    attempts.push({
      attempt,
      command: BROAD_GATE_COMMAND,
      headSha: expectedHead,
      outputSha256: sha256(result.output),
      status: result.status === 0 ? "passed" : "failed",
      transientVitestWorkerRpcTimeout: transient,
    });
    if (result.status === 0) break;
    if (!transient || invocationAttempt === 2) break;
  }
  return {
    attempts,
    command: BROAD_GATE_COMMAND,
    headSha: expectedHead,
    schemaVersion: "maestro-brain-broad-gate-receipt/v1",
    status: attempts.at(-1)?.status ?? "failed",
  };
};

const safeSegment = (value: string, label: string): string => {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`${label} is not a safe path segment`);
  }
  return value;
};

export const broadGateReceiptPath = (
  evidenceDirectory: string,
  integrationId: string,
  headSha: string,
): string =>
  resolve(
    evidenceDirectory,
    "integration",
    safeSegment(integrationId, "integrationId"),
    `broad-gate-${safeSegment(headSha, "headSha")}.json`,
  );

export const readBroadGateReceipt = (path: string): BroadGateReceipt =>
  JSON.parse(readFileSync(path, "utf8")) as BroadGateReceipt;

export const validateBroadGateReceipt = (
  value: BroadGateReceipt,
  expectedHead: string,
): void => {
  if (
    value.schemaVersion !== "maestro-brain-broad-gate-receipt/v1" ||
    value.status !== "passed" ||
    value.command !== BROAD_GATE_COMMAND ||
    value.headSha !== expectedHead ||
    !Array.isArray(value.attempts) ||
    value.attempts.length < 1
  ) {
    throw new Error("invalid broad gate receipt envelope");
  }
  for (const attempt of value.attempts.slice(0, -1)) {
    if (
      attempt.status !== "failed" ||
      !attempt.transientVitestWorkerRpcTimeout
    ) {
      throw new Error("broad gate retry lacks the known transient signature");
    }
  }
  for (const [index, attempt] of value.attempts.entries()) {
    if (
      attempt.attempt !== index + 1 ||
      attempt.command !== BROAD_GATE_COMMAND ||
      attempt.headSha !== expectedHead ||
      !/^[a-f0-9]{64}$/.test(attempt.outputSha256) ||
      (attempt.status !== "failed" && attempt.status !== "passed") ||
      typeof attempt.transientVitestWorkerRpcTimeout !== "boolean"
    ) {
      throw new Error("invalid broad gate attempt receipt");
    }
  }
  if (value.attempts.at(-1)?.status !== "passed") {
    throw new Error("broad gate receipt does not end in a pass");
  }
};

export const runIntegrationBroadGate = (input: {
  readonly evidenceDirectory: string;
  readonly integrationId: string;
  readonly workdir: string;
}): BroadGateReceipt => {
  if (!isAbsolute(input.evidenceDirectory) || !isAbsolute(input.workdir)) {
    throw new Error("broad gate evidence and workdir paths must be absolute");
  }
  const workdir = realpathSync(input.workdir);
  const headSha = runRtk(["proxy", "git", "rev-parse", "HEAD"], {
    cwd: workdir,
    quiet: true,
  });
  const receiptPath = broadGateReceiptPath(
    input.evidenceDirectory,
    input.integrationId,
    headSha,
  );
  if (existsSync(receiptPath)) {
    const existing = readBroadGateReceipt(receiptPath);
    if (existing.headSha === headSha && existing.status === "passed") {
      return existing;
    }
    if (existing.headSha !== headSha) {
      throw new Error("existing broad gate receipt is not reusable");
    }
  }
  const existingAttempts = existsSync(receiptPath)
    ? readBroadGateReceipt(receiptPath).attempts
    : [];
  const receipt = runBroadGateAttempts(
    headSha,
    {
      head: () =>
        runRtk(["proxy", "git", "rev-parse", "HEAD"], {
          cwd: workdir,
          quiet: true,
        }),
      runVerify: () => runBroadGateCommand(workdir),
      status: () =>
        runRtk(["proxy", "git", "status", "--porcelain"], {
          cwd: workdir,
          quiet: true,
        }),
    },
    existingAttempts,
  );
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt.status !== "passed") {
    throw new Error("integration broad gate failed");
  }
  return receipt;
};
