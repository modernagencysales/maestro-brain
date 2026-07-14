import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildManifest,
  MANIFEST_RELATIVE,
  REPO_ROOT,
  validateManifest,
} from "./manifest.js";

const manifest = buildManifest();
const errors = validateManifest(manifest);
if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
const output = resolve(REPO_ROOT, MANIFEST_RELATIVE);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
execFileSync("rtk", ["pnpm", "exec", "prettier", "--write", output], {
  stdio: "ignore",
});
console.log(
  `brain factory manifest: ${manifest.tasks.length} tasks -> ${output}`,
);
