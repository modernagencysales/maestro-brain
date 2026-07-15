import { resolve } from "node:path";

import {
  captureReviewWorktree,
  verifyReviewWorktree,
} from "./review-worktree-guard.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const operation = process.argv[2];
const workdir = valueAfter("--workdir");
const taskId = valueAfter("--task");
const evidence = valueAfter("--evidence");
if (!operation || !workdir || !taskId || !evidence) {
  console.error(
    "usage: review-worktree-guard <capture|verify> --workdir <absolute-dir> --task <id> --evidence <absolute-dir>",
  );
  process.exit(2);
}

const input = {
  workdir,
  taskId,
  proofPath: resolve(evidence, "lane-results", taskId, "ci-proof-packet.json"),
};

if (operation === "capture") captureReviewWorktree(input);
else if (operation === "verify") verifyReviewWorktree(input);
else throw new Error(`unknown review guard operation: ${operation}`);
