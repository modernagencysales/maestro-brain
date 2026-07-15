import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { git } from "./integration-check-support.js";
import { adoptLegacyIntegratedLaneEvidence } from "./lane-evidence-adoption.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const root = realpathSync(process.cwd());
const state = realpathSync(
  resolve(valueAfter("--state") ?? ".fabro/state/maestro-brain"),
);
const apply = process.argv.includes("--apply");
const pending = adoptLegacyIntegratedLaneEvidence({
  apply,
  controlRoot: root,
  currentHeadSha: git(root, ["rev-parse", "HEAD"]),
  evidenceDirectory: resolve(state, "evidence"),
  workdir: root,
});

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "preview",
      pending,
      pendingCount: pending.length,
      schemaVersion: "maestro-brain-lane-evidence-adoption-run/v1",
    },
    null,
    2,
  ),
);
