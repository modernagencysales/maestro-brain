import { resolve } from "node:path";

import type { GateCommand } from "./gates.js";

const CURRENT_CONTROL_GATE = "brain:factory:check-confect-codegen";

export const currentControlGateCommand = (
  command: GateCommand,
  controlRoot: string,
): GateCommand => {
  if (command.program !== "pnpm" || command.args[0] !== CURRENT_CONTROL_GATE) {
    return command;
  }
  return {
    program: "proxy",
    args: [
      "node",
      "--import",
      resolve(controlRoot, "node_modules/tsx/dist/loader.mjs"),
      resolve(
        controlRoot,
        "tooling/brain-factory/src/check-confect-codegen.mts",
      ),
      ...command.args.slice(1),
    ],
  };
};
