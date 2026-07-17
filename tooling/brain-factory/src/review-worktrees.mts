import { resolve } from "node:path";

import {
  cleanupReviewWorktrees,
  prepareReviewWorktrees,
  reviewWorktreePath,
  type ReviewWorktreeLens,
} from "./review-worktrees.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const operation = process.argv[2];
const workdir = valueAfter("--workdir");
const taskId = valueAfter("--task");
const headSha = valueAfter("--head");
const attemptId = valueAfter("--attempt");
const evidence = valueAfter("--evidence");
if (!operation || !workdir || !taskId || !headSha || !attemptId || !evidence) {
  console.error(
    "usage: review-worktrees <prepare|path|cleanup> --workdir <absolute-dir> --evidence <absolute-dir> --task <id> --head <sha> --attempt <id> [--lens <name>]",
  );
  process.exit(2);
}

const input = {
  workdir: resolve(workdir),
  evidence: resolve(evidence),
  taskId,
  headSha,
  attemptId,
};
if (operation === "prepare") {
  console.log(JSON.stringify(prepareReviewWorktrees(input)));
} else if (operation === "path") {
  const lens = valueAfter("--lens");
  if (!lens) throw new Error("path requires --lens");
  console.log(
    reviewWorktreePath({ ...input, lens: lens as ReviewWorktreeLens }),
  );
} else if (operation === "cleanup") {
  cleanupReviewWorktrees(input);
} else {
  throw new Error(`unknown review worktree operation: ${operation}`);
}
