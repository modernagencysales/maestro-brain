import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildManifest,
  type BrainTaskManifest,
  MANIFEST_RELATIVE,
  REPO_ROOT,
  readyWidth,
  validateManifest,
} from "./manifest.js";

const expected = buildManifest();
const checked = JSON.parse(
  readFileSync(resolve(REPO_ROOT, MANIFEST_RELATIVE), "utf8"),
) as BrainTaskManifest;
const errors = validateManifest(checked);
if (JSON.stringify(checked) !== JSON.stringify(expected))
  errors.push(
    "checked-in manifest is stale; run pnpm brain:factory:materialize",
  );
const width = readyWidth(checked);
if (width < 6)
  errors.push(`parallel code-start width regressed below 6 (got ${width})`);
if (errors.length > 0) {
  console.error(
    `brain factory check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
  );
  process.exit(1);
}
const classCount = (classification: string): number =>
  checked.tasks.filter((task) => task.classification === classification).length;
console.log(
  `brain factory check: ok (${checked.tasks.length} tasks, ready width ${width}, ` +
    `${classCount("template-gap")} gaps, ` +
    `${classCount("pattern-instance")} patterns, ` +
    `${classCount("fixture-to-real")} fixtures)`,
);
