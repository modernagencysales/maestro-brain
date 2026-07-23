import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

import { authoritativeIntegrationResultBindsLane } from "./integration-authority.js";
import { record, type JsonRecord } from "./integration-check-support.js";

const SHA = /^[0-9a-f]{40}$/;
const admittedLaneStatuses = new Set(["lane_green", "integrated", "accepted"]);

export const resolveIntegratedPrerequisiteTaskIds = (input: {
  readonly controlHeadSha: string;
  readonly evidence: string;
  readonly isAncestor: (headSha: string, controlHeadSha: string) => boolean;
  readonly requiredTasks: readonly {
    readonly taskId: string;
    readonly tranche: string;
  }[];
}): readonly string[] => {
  const integrationRoot = resolve(input.evidence, "integration");
  if (!existsSync(integrationRoot)) return [];
  const results = readdirSync(integrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => resolve(integrationRoot, entry.name));
  const admitted: string[] = [];
  for (const required of input.requiredTasks) {
    const lanePath = resolve(
      input.evidence,
      "lane-results",
      required.taskId,
      "lane-result.json",
    );
    if (!existsSync(lanePath)) continue;
    let lane: JsonRecord;
    try {
      lane = record(JSON.parse(readFileSync(lanePath, "utf8")), "lane result");
    } catch {
      continue;
    }
    if (
      lane.schemaVersion !== "maestro-brain-lane-result/v1" ||
      lane.taskId !== required.taskId ||
      !admittedLaneStatuses.has(String(lane.status)) ||
      typeof lane.headSha !== "string" ||
      !SHA.test(lane.headSha) ||
      (typeof lane.tranche === "string" && lane.tranche !== required.tranche)
    )
      continue;
    const binds = results.some((resultDirectory) => {
      if (existsSync(resolve(resultDirectory, "supersession.json")))
        return false;
      const resultPath = resolve(resultDirectory, "integration-result.json");
      if (!existsSync(resultPath)) return false;
      let result: JsonRecord;
      let resultContent: Buffer;
      try {
        resultContent = readFileSync(resultPath);
        result = record(
          JSON.parse(resultContent.toString("utf8")),
          `${basename(resultDirectory)}: integration result`,
        );
      } catch {
        return false;
      }
      if (
        typeof result.headSha !== "string" ||
        !SHA.test(result.headSha) ||
        !input.isAncestor(result.headSha, input.controlHeadSha)
      )
        return false;
      if (!Array.isArray(result.includedTasks)) return false;
      let matchingTasks: JsonRecord[];
      try {
        matchingTasks = result.includedTasks
          .map((value, index) =>
            record(
              value,
              `${basename(resultDirectory)}: includedTasks[${index}]`,
            ),
          )
          .filter((included) => included.taskId === required.taskId);
      } catch {
        return false;
      }
      if (
        matchingTasks.length !== 1 ||
        matchingTasks[0]?.laneHeadSha !== lane.headSha
      )
        return false;
      if (matchingTasks[0]?.tranche !== required.tranche) {
        if (matchingTasks[0]?.tranche !== undefined) return false;
        try {
          const adoption = record(
            lane.evidenceAdoption,
            `${required.taskId}: evidence adoption`,
          );
          if (
            lane.status !== "integrated" ||
            lane.accepted !== false ||
            adoption.schemaVersion !==
              "maestro-brain-lane-evidence-adoption/v1" ||
            adoption.manifestTranche !== required.tranche ||
            adoption.integrationId !== basename(resultDirectory) ||
            adoption.integrationHeadSha !== result.headSha ||
            adoption.integrationResultPath !==
              `integration/${basename(resultDirectory)}/integration-result.json` ||
            adoption.integrationResultSha256 !==
              createHash("sha256").update(resultContent).digest("hex") ||
            adoption.laneHeadSha !== lane.headSha
          )
            return false;
        } catch {
          return false;
        }
      }
      const authoritative = authoritativeIntegrationResultBindsLane({
        integrationHeadSha: result.headSha,
        integrationId: basename(resultDirectory),
        laneHeadSha: lane.headSha as string,
        result,
        resultDirectory,
        taskId: required.taskId,
        taskTranche: required.tranche,
      });
      return (
        authoritative &&
        !existsSync(resolve(resultDirectory, "supersession.json")) &&
        readFileSync(resultPath).equals(resultContent)
      );
    });
    if (binds) admitted.push(required.taskId);
  }
  return admitted.sort();
};
