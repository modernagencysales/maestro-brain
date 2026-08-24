import { execFileSync } from "node:child_process";
import process from "node:process";
import { resolve } from "node:path";

import { customerCoverageArgv } from "./customer-coverage-contract.mts";
import { isDirectRun } from "./src/direct-run.mts";

export const runCustomerCoverage = (root = process.cwd()): void => {
  execFileSync(
    resolve(root, "node_modules/.bin/vitest"),
    customerCoverageArgv(),
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  execFileSync(
    resolve(root, "node_modules/.bin/tsx"),
    [
      resolve(root, "tooling/quality/check-coverage-ratchet.mts"),
      ...(process.argv.includes("--update") ? ["--update"] : []),
    ],
    { cwd: root, stdio: "inherit" },
  );
};

if (isDirectRun(import.meta.url)) runCustomerCoverage();
