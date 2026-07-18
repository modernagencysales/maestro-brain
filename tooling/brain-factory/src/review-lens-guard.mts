import { REVIEW_LENS_NAMES } from "./review-lens.js";
import { stageReviewLens } from "./review-lens-guard.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const lens = valueAfter("--lens");
if (!REVIEW_LENS_NAMES.includes(lens as (typeof REVIEW_LENS_NAMES)[number]))
  throw new Error("--lens must be contract, safety, or quality");
const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
stageReviewLens({
  attempt: requiredEnv("BRAIN_REVIEW_ATTEMPT"),
  controlWorktree: process.cwd(),
  evidence: requiredEnv("BRAIN_EVIDENCE_DIR"),
  lens: lens as (typeof REVIEW_LENS_NAMES)[number],
  taskId: requiredEnv("BRAIN_TASK_ID"),
  workdir: requiredEnv("BRAIN_WORKDIR"),
});
