import { REVIEW_LENS_NAMES } from "./review-lens.js";
import { stageReviewLens } from "./review-lens-guard.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const lens = valueAfter("--lens");
if (!REVIEW_LENS_NAMES.includes(lens as (typeof REVIEW_LENS_NAMES)[number]))
  throw new Error("--lens must be contract, safety, or quality");
for (const name of [
  "BRAIN_WORKDIR",
  "BRAIN_EVIDENCE_DIR",
  "BRAIN_TASK_ID",
  "BRAIN_REVIEW_ATTEMPT",
])
  if (!process.env[name]) throw new Error(`missing ${name}`);
stageReviewLens({
  attempt: process.env.BRAIN_REVIEW_ATTEMPT!,
  controlWorktree: process.cwd(),
  evidence: process.env.BRAIN_EVIDENCE_DIR!,
  lens: lens as (typeof REVIEW_LENS_NAMES)[number],
  taskId: process.env.BRAIN_TASK_ID!,
  workdir: process.env.BRAIN_WORKDIR!,
});
