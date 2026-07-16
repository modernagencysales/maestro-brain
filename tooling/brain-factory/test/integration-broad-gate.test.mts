import { describe, expect, it, vi } from "vitest";

import {
  BROAD_GATE_COMMAND,
  runBroadGateAttempts,
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

describe("integration broad gate transient retry", () => {
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
