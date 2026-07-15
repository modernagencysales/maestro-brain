import { createHash } from "node:crypto";

import type { GateCommand } from "./gates.js";

export interface LaneGateCacheIdentity {
  readonly commandSetHash: string;
  readonly currentHeadSha: string;
  readonly currentTreeSha: string;
  readonly planSha256: string;
  readonly reviewVerdict: "pass" | "pending" | "rework";
  readonly taskBlockHash: string;
}

export type LaneGateStage = "final" | "pre-review";
export type LaneReviewVerdict = "pass" | "pending" | "rework";

export const reviewVerdictMatchesGateStage = (
  stage: LaneGateStage,
  verdict: LaneReviewVerdict,
): boolean =>
  stage === "pre-review" ? verdict === "pending" : verdict === "pass";

const commandKey = (command: GateCommand): string =>
  `${command.program}\0${command.args.join("\0")}`;

export const deduplicateGateCommands = (
  commands: readonly GateCommand[],
): GateCommand[] => {
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = commandKey(command);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const gateCommandSetHash = (commands: readonly GateCommand[]): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        commands.map((command) => ({
          args: [...command.args],
          program: command.program,
        })),
      ),
    )
    .digest("hex");

export const canReusePreReviewGate = (
  report: unknown,
  identity: LaneGateCacheIdentity,
): boolean => {
  if (
    typeof report !== "object" ||
    report === null ||
    Array.isArray(report) ||
    identity.reviewVerdict !== "pass"
  )
    return false;
  const value = report as Record<string, unknown>;
  return (
    value.schemaVersion === "maestro-brain-lane-gate/v1" &&
    value.stage === "pre-review" &&
    value.status === "passed" &&
    value.currentHeadSha === identity.currentHeadSha &&
    value.currentTreeSha === identity.currentTreeSha &&
    value.planSha256 === identity.planSha256 &&
    value.taskBlockHash === identity.taskBlockHash &&
    value.commandSetHash === identity.commandSetHash
  );
};
