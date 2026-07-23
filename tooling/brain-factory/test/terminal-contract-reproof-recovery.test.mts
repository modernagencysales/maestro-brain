import { describe, expect, it, vi } from "vitest";

import { reconcileTerminalContractReproofCreating } from "../src/terminal-contract-reproof-recovery.js";

const runId = "01KY7000000000000000000000";
const owner = {
  expectedRunInputs: { reproof_request: "/evidence/request.json" },
  mode: "contract-reproof",
  phase: "creating",
  runId,
  status: "preparing",
};

describe("terminal contract-reproof crash reconciliation", () => {
  it.each([
    "created",
    "running",
    "succeeded",
    "failed",
    "canceled",
    "cancelled",
  ])("reconciles a durably recorded %s run", (status) => {
    const order: string[] = [];
    expect(
      reconcileTerminalContractReproofCreating({
        inspect: () => ({
          inputs: { reproof_request: "/evidence/request.json" },
          runId,
          status,
        }),
        owner,
        promote: () => order.push("promote"),
        start: () => order.push("start"),
        taskId: "S04-T04",
      }),
    ).toBe(runId);
    expect(order).toEqual(
      status === "created" ? ["start", "promote"] : ["promote"],
    );
  });

  it("rejects a run whose compiled inputs drift", () => {
    expect(() =>
      reconcileTerminalContractReproofCreating({
        inspect: () => ({ inputs: {}, runId, status: "created" }),
        owner,
        promote: vi.fn(),
        start: vi.fn(),
        taskId: "S04-T04",
      }),
    ).toThrow("creating run identity drift");
  });
});
