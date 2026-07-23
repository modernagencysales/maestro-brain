import { describe, expect, it } from "vitest";

import { currentControlGateCommand } from "../src/control-gate-command.js";

describe("current control factory gate commands", () => {
  it("runs transient Confect validation from current control tooling", () => {
    expect(
      currentControlGateCommand(
        {
          program: "pnpm",
          args: [
            "brain:factory:check-confect-codegen",
            "--",
            "--test",
            "brain-maintenance",
          ],
        },
        "/control",
      ),
    ).toEqual({
      program: "proxy",
      args: [
        "node",
        "--import",
        "/control/node_modules/tsx/dist/loader.mjs",
        "/control/tooling/brain-factory/src/check-confect-codegen.mts",
        "--",
        "--test",
        "brain-maintenance",
      ],
    });
  });

  it("does not remap product commands or near-matching package scripts", () => {
    const commands = [
      { program: "pnpm", args: ["--dir", "packages/convex", "typecheck"] },
      { program: "pnpm", args: ["brain:factory:check"] },
      { program: "node", args: ["brain:factory:check-confect-codegen"] },
    ] as const;
    for (const command of commands) {
      expect(currentControlGateCommand(command, "/control")).toBe(command);
    }
  });
});
