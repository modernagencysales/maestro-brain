import { resolve } from "node:path";

import { hydrateChangedIntegrationDependencies } from "./dependencies.js";
import { gitSha, safeAbsolutePath } from "./integration-recovery.js";

const valueAfter = (flag: string): string => {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${flag} is required`);
  return value;
};

const workdir = safeAbsolutePath(
  resolve(valueAfter("--workdir")),
  "integration workdir",
);
const baseSha = gitSha(valueAfter("--base"), "integration base");
const result = hydrateChangedIntegrationDependencies({ baseSha, workdir });

console.log(JSON.stringify(result, null, 2));
