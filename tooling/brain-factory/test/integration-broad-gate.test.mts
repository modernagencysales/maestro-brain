import { readdirSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import {
  BROAD_GATE_COMMAND,
  runBroadGateAttempts,
  runBroadGateCommand,
  validateBroadGateReceipt,
} from "../src/integration-broad-gate.js";

const cleanRunner = (
  results: readonly { output: string; status: number }[],
) => {
  const runVerify = vi.fn();
  for (const result of results) runVerify.mockReturnValueOnce(result);
  return {
    runner: {
      head: () => "a".repeat(40),
      runVerify,
      status: () => "",
    },
    runVerify,
  };
};

const broadGateCaptureDirectories = (): readonly string[] =>
  readdirSync(tmpdir())
    .filter((entry) => entry.startsWith("maestro-brain-broad-gate-"))
    .sort();

describe("integration broad gate", () => {
  it("captures noisy successful output through files without a maxBuffer", () => {
    const captureDirectoriesBefore = broadGateCaptureDirectories();
    const stdout = "x".repeat(4 * 1024 * 1024);
    const stderr = "noisy success stderr\n";
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = runBroadGateCommand(
      "/tmp/worktree",
      (command, args, options) => {
        expect(command).toBe("rtk");
        expect(args).toEqual([
          "host-test-slot",
          "--class",
          "full",
          "pnpm",
          "verify",
        ]);
        expect(options).not.toHaveProperty("maxBuffer");
        writeSync(options.stdio[1], stdout);
        writeSync(options.stdio[2], stderr);
        return { signal: null, status: 0 };
      },
    );

    expect(result).toMatchObject({ signal: null, status: 0 });
    expect(result.output).toBe(`${stdout}${stderr}`);
    expect(stdoutWrite).toHaveBeenCalledWith(stdout);
    expect(stderrWrite).toHaveBeenCalledWith(stderr);
    expect(broadGateCaptureDirectories()).toEqual(captureDirectoriesBefore);
  });

  it("removes temporary capture files when the injected spawn throws", () => {
    const captureDirectoriesBefore = broadGateCaptureDirectories();

    expect(() =>
      runBroadGateCommand("/tmp/worktree", () => {
        throw new Error("injected spawn throw");
      }),
    ).toThrow(/injected spawn throw/);
    expect(broadGateCaptureDirectories()).toEqual(captureDirectoriesBefore);
  });

  it("preserves ordinary nonzero gate output as a verification failure", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = runBroadGateCommand(
      "/tmp/worktree",
      (_command, _args, options) => {
        writeSync(options.stdio[2], "AssertionError: expected true\n");
        return { signal: null, status: 7 };
      },
    );

    expect(result).toMatchObject({
      output: "AssertionError: expected true\n",
      signal: null,
      status: 7,
    });
  });

  it("rejects a spawn error instead of recording a verification failure", () => {
    expect(() =>
      runBroadGateAttempts("a".repeat(40), {
        head: () => "a".repeat(40),
        runVerify: () => ({
          error: new Error("spawn ENOMEM"),
          output: "",
          signal: null,
          status: null,
        }),
        status: () => "",
      }),
    ).toThrow(/failed to spawn.*ENOMEM/);
  });

  it("rejects signal termination instead of recording a verification failure", () => {
    expect(() =>
      runBroadGateAttempts("a".repeat(40), {
        head: () => "a".repeat(40),
        runVerify: () => ({
          output: "partial output",
          signal: "SIGTERM",
          status: null,
        }),
        status: () => "",
      }),
    ).toThrow(/terminated by signal SIGTERM/);
  });

  it("rejects a null status without a spawn error or signal", () => {
    expect(() =>
      runBroadGateAttempts("a".repeat(40), {
        head: () => "a".repeat(40),
        runVerify: () => ({
          output: "partial output",
          signal: null,
          status: null,
        }),
        status: () => "",
      }),
    ).toThrow(/terminated without an exit status/);
  });

  it("reports immutable HEAD drift before a spawn error", () => {
    let headCalls = 0;

    expect(() =>
      runBroadGateAttempts("a".repeat(40), {
        head: () => (++headCalls === 1 ? "a" : "b").repeat(40),
        runVerify: () => ({
          error: new Error("spawn ENOMEM"),
          output: "",
          signal: null,
          status: null,
        }),
        status: () => "",
      }),
    ).toThrow(/mutated its immutable head/);
  });

  it("reports dirty worktree mutation before signal termination", () => {
    let statusCalls = 0;

    expect(() =>
      runBroadGateAttempts("a".repeat(40), {
        head: () => "a".repeat(40),
        runVerify: () => ({
          output: "partial output",
          signal: "SIGTERM",
          status: null,
        }),
        status: () => (++statusCalls === 1 ? "" : " M generated.txt"),
      }),
    ).toThrow(/mutated its immutable head/);
  });

  it("retries the exact Vitest worker RPC timeout once", () => {
    const { runner, runVerify } = cleanRunner([
      { output: 'Error: Timeout calling "onTaskUpdate"', status: 1 },
      { output: "verify passed", status: 0 },
    ]);

    const receipt = runBroadGateAttempts("a".repeat(40), runner);

    expect(runVerify).toHaveBeenCalledTimes(2);
    expect(receipt.status).toBe("passed");
    expect(receipt.command).toBe(BROAD_GATE_COMMAND);
    expect(receipt.attempts).toMatchObject([
      { attempt: 1, status: "failed", transientVitestWorkerRpcTimeout: true },
      { attempt: 2, status: "passed", transientVitestWorkerRpcTimeout: false },
    ]);
  });

  it("does not retry arbitrary verification failures", () => {
    const { runner, runVerify } = cleanRunner([
      { output: "AssertionError: expected true", status: 1 },
    ]);

    const receipt = runBroadGateAttempts("a".repeat(40), runner);

    expect(runVerify).toHaveBeenCalledTimes(1);
    expect(receipt.status).toBe("failed");
    expect(receipt.attempts[0]?.transientVitestWorkerRpcTimeout).toBe(false);
  });

  it("caps repeated matching timeouts at one retry", () => {
    const { runner, runVerify } = cleanRunner([
      { output: 'Timeout calling "onTaskUpdate"', status: 1 },
      { output: 'Timeout calling "onTaskUpdate"', status: 1 },
    ]);

    const receipt = runBroadGateAttempts("a".repeat(40), runner);

    expect(runVerify).toHaveBeenCalledTimes(2);
    expect(receipt.status).toBe("failed");
  });

  it("appends a bounded recovery invocation to failed exact-head history", () => {
    const first = runBroadGateAttempts(
      "a".repeat(40),
      cleanRunner([
        { output: 'Timeout calling "onTaskUpdate"', status: 1 },
        { output: 'Timeout calling "onTaskUpdate"', status: 1 },
      ]).runner,
    );
    const { runner, runVerify } = cleanRunner([
      { output: "verify passed", status: 0 },
    ]);

    const recovered = runBroadGateAttempts(
      "a".repeat(40),
      runner,
      first.attempts,
    );

    expect(runVerify).toHaveBeenCalledTimes(1);
    expect(recovered.attempts).toHaveLength(3);
    expect(recovered.attempts.map(({ attempt }) => attempt)).toEqual([1, 2, 3]);
    expect(recovered.status).toBe("passed");
  });

  it("refuses to retry after immutable HEAD drift", () => {
    let headCalls = 0;
    const runVerify = vi.fn().mockReturnValue({
      output: 'Timeout calling "onTaskUpdate"',
      status: 1,
    });

    expect(() =>
      runBroadGateAttempts("a".repeat(40), {
        head: () => (++headCalls < 2 ? "a" : "b").repeat(40),
        runVerify,
        status: () => "",
      }),
    ).toThrow(/mutated its immutable head/);
    expect(runVerify).toHaveBeenCalledTimes(1);
  });

  it("rejects a second attempt without the exact transient classification", () => {
    const { runner } = cleanRunner([
      { output: 'Timeout calling "onTaskUpdate"', status: 1 },
      { output: "verify passed", status: 0 },
    ]);
    const receipt = runBroadGateAttempts("a".repeat(40), runner);
    const forged = {
      ...receipt,
      attempts: receipt.attempts.map((attempt, index) =>
        index === 0
          ? { ...attempt, transientVitestWorkerRpcTimeout: false }
          : attempt,
      ),
    };

    expect(() => validateBroadGateReceipt(forged, "a".repeat(40))).toThrow(
      /known transient signature/,
    );
  });
});
