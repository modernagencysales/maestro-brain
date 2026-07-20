import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateContractReproofRequest } from "./contract-reproof.js";
import { validateContractReproofRefreshArtifacts } from "./contract-reproof-admission.js";
import { atomicWrite, jsonContent } from "./evidence-write.js";
import { validateFinalLaneResult } from "./lane-result.js";
import { buildManifest } from "./manifest.js";
import { runRtk } from "./process.js";
import { validateProofContract } from "./proof.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const taskId = valueAfter("--task");
const evidence = valueAfter("--evidence");
const reproofPath = valueAfter("--reproof-request");
if (!taskId || !evidence) {
  throw new Error(
    "usage: write-lane-result --task <id> --evidence <dir> [--reproof-request <path>]",
  );
}
const manifest = buildManifest();
const task = manifest.tasks.find((candidate) => candidate.taskId === taskId);
if (!task) throw new Error(`unknown task ${taskId}`);
const headSha = runRtk(["git", "rev-parse", "HEAD"], { quiet: true });
const treeSha = runRtk(["git", "rev-parse", "HEAD^{tree}"], { quiet: true });
const laneDirectory = resolve(evidence, "lane-results", taskId);
const proofPath = resolve(laneDirectory, "ci-proof-packet.json");
const finalGatePath = resolve(laneDirectory, "lane-gate-report.json");
if (!existsSync(proofPath))
  throw new Error(`${taskId}: final proof is missing`);
if (!existsSync(finalGatePath))
  throw new Error(`${taskId}: final lane gate receipt is missing`);
const proof = JSON.parse(readFileSync(proofPath, "utf8")) as Record<
  string,
  unknown
>;
validateProofContract(proof, {
  taskBlockHash: task.taskBlockHash,
  taskId,
});
const finalGateReport = JSON.parse(
  readFileSync(finalGatePath, "utf8"),
) as Record<string, unknown>;
if (reproofPath && reproofPath !== "none" && !existsSync(reproofPath)) {
  throw new Error(`${taskId}: reproof request does not exist`);
}
const rawReproof =
  reproofPath && reproofPath !== "none"
    ? JSON.parse(readFileSync(reproofPath, "utf8"))
    : undefined;
const reproof = rawReproof
  ? validateContractReproofRequest(rawReproof, {
      controlHeadSha: String(rawReproof.controlHeadSha),
      planSha256: manifest.planSha256,
      taskBlockHash: task.taskBlockHash,
      taskId,
    })
  : undefined;
if (reproof) {
  validateContractReproofRefreshArtifacts({
    evidenceDirectory: evidence,
    request: reproof,
    taskId,
  });
}
const result = {
  schemaVersion: "maestro-brain-lane-result/v1",
  taskId,
  headSha,
  treeSha,
  tranche: task.tranche,
  status: "lane_green",
  ...(reproof
    ? {
        reproof: {
          requestPath: reproofPath,
          requestSha256: reproof.requestSha256,
          priorIntegrationHeadSha: reproof.priorIntegrationHeadSha,
          priorIntegrationId: reproof.priorIntegrationId,
        },
      }
    : {}),
};
validateFinalLaneResult(result, {
  currentHeadSha: headSha,
  currentTreeSha: treeSha,
  finalGateReport,
  proof,
  taskId,
});
atomicWrite(resolve(laneDirectory, "lane-result.json"), jsonContent(result));
