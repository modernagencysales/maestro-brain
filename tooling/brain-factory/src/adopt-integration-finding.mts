import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertCleanFindingAdoptionWorktree,
  buildIntegrationFindingAdoption,
  materializeIntegrationFindingAdoption,
} from "./integration-finding-adoption.js";
import { runRtk } from "./process.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const valuesAfter = (flag: string): readonly string[] =>
  process.argv.flatMap((value, index) => {
    const next = process.argv[index + 1];
    return value === flag && next ? [next] : [];
  });
const required = (flag: string): string => {
  const value = valueAfter(flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
};

const resultPath = resolve(required("--result"));
const selectionPath = resolve(required("--selection"));
const workdir = resolve(required("--workdir"));
const changeExpectation = required("--change-expectation");
const evidenceOnlyRationale = valueAfter("--evidence-only-rationale");
if (
  changeExpectation !== "source_or_test_delta" &&
  changeExpectation !== "evidence_only"
) {
  throw new Error("--change-expectation is invalid");
}
assertCleanFindingAdoptionWorktree(
  runRtk(["proxy", "git", "-C", workdir, "status", "--porcelain"], {
    quiet: true,
  }),
);
const adoption = buildIntegrationFindingAdoption({
  affectedPaths: valuesAfter("--affected-path"),
  candidateHeadSha: required("--candidate-head"),
  changeExpectation,
  ...(evidenceOnlyRationale ? { evidenceOnlyRationale } : {}),
  expectedBehavior: required("--expected-behavior"),
  findingId: required("--finding-id"),
  integrationId: required("--integration-id"),
  ownerKind: "task",
  requiredRegressionProof: required("--required-regression-proof"),
  resultContent: readFileSync(resultPath, "utf8"),
  selectionContent: readFileSync(selectionPath, "utf8"),
  taskId: required("--task"),
  worktreeHeadSha: runRtk(
    ["proxy", "git", "-C", workdir, "rev-parse", "HEAD"],
    {
      quiet: true,
    },
  ),
});
for (const [flag, actual] of [
  ["--result-sha256", adoption.resultSha256],
  ["--selection-file-sha256", adoption.selectionFileSha256],
  ["--selection-payload-sha256", adoption.selectionPayloadSha256],
] as const) {
  if (required(flag) !== actual) throw new Error(`${flag} mismatch`);
}
materializeIntegrationFindingAdoption(resolve(required("--output")), adoption);
process.stdout.write(`${JSON.stringify(adoption, null, 2)}\n`);
