import { readFileSync } from "node:fs";

import { atomicWrite } from "./evidence-write.js";

export const materializePlanOnlyAuthorityWorkflow = (input: {
  readonly path: string;
  readonly sourcePath: string;
  readonly workflowName: string;
}): string => {
  if (!/^BrainBuildTaskS\d{2}T\d{2}Plan[0-9a-f]{12}$/.test(input.workflowName))
    throw new Error("plan-only authority workflow name is invalid");
  const source = readFileSync(input.sourcePath, "utf8");
  const marker = "digraph BrainBuildTask {";
  if (!source.startsWith(marker))
    throw new Error("canonical BrainBuildTask workflow marker is missing");
  atomicWrite(
    input.path,
    source.replace(marker, `digraph ${input.workflowName} {`),
  );
  return input.path;
};
