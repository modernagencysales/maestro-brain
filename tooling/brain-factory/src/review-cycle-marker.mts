import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { reviewCycleMarker } from "./lane-gate-cache.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const taskId = valueAfter("--task");
const evidence = valueAfter("--evidence");
if (!taskId || !evidence) {
  console.error(
    "usage: review-cycle-marker --task <id> --evidence <absolute-dir>",
  );
  process.exit(2);
}

const proofPath = resolve(
  evidence,
  "lane-results",
  taskId,
  "ci-proof-packet.json",
);
if (!existsSync(proofPath)) throw new Error(`${taskId}: missing ${proofPath}`);

const proof = JSON.parse(readFileSync(proofPath, "utf8")) as unknown;
console.log(reviewCycleMarker(proof));
