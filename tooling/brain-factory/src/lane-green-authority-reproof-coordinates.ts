import { createHash } from "node:crypto";
import { resolve } from "node:path";

import type { LaneGreenAuthorityReproofCoordinates } from "./lane-green-authority-reproof-spec.js";

export const laneGreenAuthorityReproofCoordinates = (input: {
  readonly controlHeadSha: string;
  readonly planSha256: string;
  readonly root: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
}): LaneGreenAuthorityReproofCoordinates => {
  for (const [label, value, length] of [
    ["control HEAD", input.controlHeadSha, 40],
    ["plan SHA", input.planSha256, 64],
    ["task hash", input.taskBlockHash, 64],
  ] as const) {
    if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value))
      throw new Error(`lane-green authority reproof ${label} is invalid`);
  }
  const authorityId = createHash("sha256")
    .update(
      `${input.controlHeadSha}:${input.planSha256}:${input.taskBlockHash}:lane-green-authority-reproof`,
    )
    .digest("hex")
    .slice(0, 12);
  const slug = input.taskId.toLowerCase();
  return {
    authorityId,
    branch: `fabro/reproof-${slug}-green-${authorityId}`,
    workdir: resolve(
      input.root,
      "..",
      ".maestro-brain-fabro-workdirs",
      `reproof-${slug}-green-${authorityId}`,
    ),
    workflowName: `BrainBuildTask${input.taskId.replace("-", "")}Green${authorityId}`,
  };
};

export const terminalLaneGreenRetryCoordinates = (input: {
  readonly archiveActionId: string;
  readonly candidateHeadSha: string;
  readonly coordinates: LaneGreenAuthorityReproofCoordinates;
}): LaneGreenAuthorityReproofCoordinates => {
  if (
    !/^[0-9a-zA-Z._-]+$/.test(input.archiveActionId) ||
    !/^[0-9a-f]{40}$/.test(input.candidateHeadSha)
  )
    throw new Error("terminal lane-green retry identity is invalid");
  const authorityId = createHash("sha256")
    .update(`${input.archiveActionId}:${input.candidateHeadSha}:terminal-retry`)
    .digest("hex")
    .slice(0, 12);
  return {
    ...input.coordinates,
    authorityId,
    workflowName: input.coordinates.workflowName.replace(
      /[0-9a-f]{12}$/,
      authorityId,
    ),
  };
};
