import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

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
  readonly output: string;
  readonly status: number | null;
}

export interface BroadGateRunner {
  readonly head: () => string;
  readonly runVerify: () => CommandResult;
  readonly status: () => string;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const isTransientVitestWorkerRpcTimeout = (output: string): boolean =>
  output.includes(TRANSIENT_VITEST_RPC_TIMEOUT);

export const runBroadGateAttempts = (
  expectedHead: string,
  runner: BroadGateRunner,
): BroadGateReceipt => {
  const attempts: BroadGateAttempt[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (runner.head() !== expectedHead) {
      throw new Error("integration broad gate HEAD changed before an attempt");
    }
    if (runner.status() !== "") {
      throw new Error("integration broad gate worktree is not clean");
    }
    const result = runner.runVerify();
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
    if (!transient || attempt === 2) break;
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
    value.attempts.length < 1 ||
    value.attempts.length > 2
  ) {
    throw new Error("invalid broad gate receipt envelope");
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
  if (value.attempts.length === 2) {
    const first = value.attempts[0];
    if (
      first?.status !== "failed" ||
      first.transientVitestWorkerRpcTimeout !== true
    ) {
      throw new Error("broad gate retry lacks the known transient signature");
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
    throw new Error("existing broad gate receipt is not reusable");
  }
  const receipt = runBroadGateAttempts(headSha, {
    head: () =>
      runRtk(["proxy", "git", "rev-parse", "HEAD"], {
        cwd: workdir,
        quiet: true,
      }),
    runVerify: () => {
      const result = spawnSync(
        "rtk",
        ["host-test-slot", "--class", "full", "pnpm", "verify"],
        { cwd: workdir, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
      );
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      return { output, status: result.status };
    },
    status: () =>
      runRtk(["proxy", "git", "status", "--porcelain"], {
        cwd: workdir,
        quiet: true,
      }),
  });
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
  });
  if (receipt.status !== "passed") {
    throw new Error("integration broad gate failed");
  }
  return receipt;
};
