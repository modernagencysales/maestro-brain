import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { IntegrationFinding } from "./integration-finding.js";
import { readIntegrationWaveSelection } from "./integration-wave.js";

export const INTEGRATION_FINDING_ADOPTION_SCHEMA =
  "maestro-brain-integration-finding-adoption/v1" as const;

export interface LegacyIntegrationFindingIdentity {
  readonly details: string;
  readonly id: string;
  readonly severity: string;
  readonly summary: string;
  readonly taskId: string;
}

export interface IntegrationFindingAdoption {
  readonly adoptionSha256: string;
  readonly candidateHeadSha: string;
  readonly finding: IntegrationFinding;
  readonly integrationId: string;
  readonly legacyFinding: LegacyIntegrationFindingIdentity;
  readonly legacyFindingSha256: string;
  readonly resultSha256: string;
  readonly schemaVersion: typeof INTEGRATION_FINDING_ADOPTION_SCHEMA;
  readonly selectionFileSha256: string;
  readonly selectionPayloadSha256: string;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const string = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
};

const exactSha = (value: string, length: 40 | 64, label: string): string => {
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw new Error(`${label} must be an exact SHA`);
  }
  return value;
};

export const assertCleanFindingAdoptionWorktree = (status: string): void => {
  if (status.trim()) {
    throw new Error("finding adoption candidate worktree is not clean");
  }
};

const legacyIdentity = (value: unknown): LegacyIntegrationFindingIdentity => {
  const finding = record(value, "legacy finding");
  const keys = ["details", "id", "severity", "summary", "taskId"];
  if (
    Reflect.ownKeys(finding).some(
      (key) => typeof key !== "string" || !keys.includes(key),
    )
  ) {
    throw new Error("modern finding cannot be adopted");
  }
  return {
    details: string(finding.details, "legacy finding details"),
    id: string(finding.id, "legacy finding ID"),
    severity: string(finding.severity, "legacy finding severity"),
    summary: string(finding.summary, "legacy finding summary"),
    taskId: string(finding.taskId, "legacy finding taskId"),
  };
};

type AdoptionInput = {
  readonly affectedPaths: readonly string[];
  readonly candidateHeadSha: string;
  readonly changeExpectation: "source_or_test_delta" | "evidence_only";
  readonly evidenceOnlyRationale?: string;
  readonly expectedBehavior: string;
  readonly findingId: string;
  readonly integrationId: string;
  readonly ownerKind: "task";
  readonly requiredRegressionProof: string;
  readonly resultContent: string;
  readonly selectionContent: string;
  readonly taskId: string;
  readonly worktreeHeadSha: string;
};

export const buildIntegrationFindingAdoption = (
  input: AdoptionInput,
): IntegrationFindingAdoption => {
  const selection = readIntegrationWaveSelection(input.selectionContent);
  const result = record(
    JSON.parse(input.resultContent) as unknown,
    "integration result",
  );
  const candidateHeadSha = exactSha(
    string(result.headSha, "integration result head"),
    40,
    "candidate head",
  );
  if (
    candidateHeadSha !==
      exactSha(input.candidateHeadSha, 40, "candidate head") ||
    candidateHeadSha !== exactSha(input.worktreeHeadSha, 40, "worktree head")
  ) {
    throw new Error("finding adoption candidate head mismatch");
  }
  if (
    result.integrationId !== input.integrationId ||
    selection.selection.integrationId !== input.integrationId ||
    result.baseSha !== selection.selection.baseSha ||
    result.selectionFileSha256 !== selection.selectionFileSha256 ||
    result.selectionPayloadSha256 !== selection.selectionPayloadSha256
  ) {
    throw new Error("finding adoption integration or selection mismatch");
  }
  if (
    result.schemaVersion !== "maestro-brain-integration-result/v3" ||
    result.status !== "ready_for_review" ||
    result.reviewVerdict !== "rework" ||
    !Array.isArray(result.remainingFindings)
  ) {
    throw new Error("finding adoption result is not authoritative rework");
  }
  const remaining = result.remainingFindings;
  const matching = remaining.filter(
    (finding) =>
      typeof finding === "object" &&
      finding !== null &&
      !Array.isArray(finding) &&
      (finding as Record<string, unknown>).id === input.findingId,
  );
  if (remaining.length !== 1 || matching.length !== 1) {
    throw new Error("finding adoption requires one exact legacy finding");
  }
  const legacyFinding = legacyIdentity(matching[0]);
  if (legacyFinding.taskId !== input.taskId) {
    throw new Error("finding adoption task mismatch");
  }
  const selected = selection.selection.selectedTasks.find(
    ({ taskId }) => taskId === input.taskId,
  );
  if (!selected) throw new Error("finding adoption task is not selected");
  if (!Array.isArray(input.affectedPaths) || input.affectedPaths.length === 0) {
    throw new Error("finding adoption affected paths are required");
  }
  const locks = new Set(selected.fileLocks);
  const affectedPaths = [...new Set(input.affectedPaths)].sort();
  if (affectedPaths.length !== input.affectedPaths.length) {
    throw new Error("finding adoption affected paths contain duplicates");
  }
  for (const path of affectedPaths) {
    if (!locks.has(path))
      throw new Error("finding adoption path is outside selected locks");
  }
  if (input.ownerKind !== "task") {
    throw new Error("legacy adoption supports task ownership only");
  }
  if (
    input.changeExpectation !== "source_or_test_delta" &&
    input.changeExpectation !== "evidence_only"
  ) {
    throw new Error("finding adoption change expectation is invalid");
  }
  const resultSha256 = sha256(input.resultContent);
  const priorEvidenceSha256 = [
    resultSha256,
    selection.selectionFileSha256,
    selection.selectionPayloadSha256,
  ].sort();
  const finding: IntegrationFinding = {
    ...legacyFinding,
    affectedPaths,
    candidateHeadSha,
    changeExpectation: input.changeExpectation,
    expectedBehavior: string(input.expectedBehavior, "expectedBehavior"),
    ownerKind: "task",
    priorEvidenceSha256,
    requiredRegressionProof: string(
      input.requiredRegressionProof,
      "requiredRegressionProof",
    ),
    ...(input.changeExpectation === "evidence_only"
      ? {
          evidenceOnlyRationale: string(
            input.evidenceOnlyRationale,
            "evidenceOnlyRationale",
          ),
        }
      : {}),
  };
  const payload = {
    schemaVersion: INTEGRATION_FINDING_ADOPTION_SCHEMA,
    integrationId: input.integrationId,
    candidateHeadSha,
    resultSha256,
    selectionFileSha256: selection.selectionFileSha256,
    selectionPayloadSha256: selection.selectionPayloadSha256,
    legacyFinding,
    legacyFindingSha256: sha256(JSON.stringify(legacyFinding)),
    finding,
  };
  return {
    ...payload,
    adoptionSha256: sha256(JSON.stringify(payload)),
  };
};

export const validateIntegrationFindingAdoption = (input: {
  readonly adoptionContent: string;
  readonly resultContent: string;
  readonly selectionContent: string;
  readonly worktreeHeadSha: string;
}): IntegrationFindingAdoption => {
  const value = record(
    JSON.parse(input.adoptionContent) as unknown,
    "finding adoption",
  ) as unknown as IntegrationFindingAdoption;
  const rebuilt = buildIntegrationFindingAdoption({
    affectedPaths: value.finding?.affectedPaths ?? [],
    candidateHeadSha: String(value.candidateHeadSha ?? ""),
    changeExpectation: value.finding?.changeExpectation,
    ...(value.finding?.evidenceOnlyRationale
      ? { evidenceOnlyRationale: value.finding.evidenceOnlyRationale }
      : {}),
    expectedBehavior: String(value.finding?.expectedBehavior ?? ""),
    findingId: String(value.legacyFinding?.id ?? ""),
    integrationId: String(value.integrationId ?? ""),
    ownerKind: "task",
    requiredRegressionProof: String(
      value.finding?.requiredRegressionProof ?? "",
    ),
    resultContent: input.resultContent,
    selectionContent: input.selectionContent,
    taskId: String(value.legacyFinding?.taskId ?? ""),
    worktreeHeadSha: input.worktreeHeadSha,
  });
  if (
    JSON.stringify(value) !== JSON.stringify(rebuilt) ||
    input.adoptionContent !== `${JSON.stringify(rebuilt, null, 2)}\n`
  ) {
    throw new Error("finding adoption identity or hash mismatch");
  }
  return rebuilt;
};

export const validateResolvedIntegrationFindingAdoption = (input: {
  readonly adoptionContent?: string;
  readonly evidence: readonly string[];
  readonly resultContent?: string;
  readonly selectionContent: string;
  readonly worktreeHeadSha: string;
}): IntegrationFindingAdoption | undefined => {
  const evidence = input.evidence.filter((item) =>
    item.startsWith("finding-adoption-sha256:"),
  );
  if (evidence.length === 0 && input.adoptionContent === undefined) return;
  if (evidence.length !== 1 || !input.adoptionContent || !input.resultContent) {
    throw new Error("resolved finding adoption is missing or ambiguous");
  }
  const adoption = validateIntegrationFindingAdoption({
    adoptionContent: input.adoptionContent,
    resultContent: input.resultContent,
    selectionContent: input.selectionContent,
    worktreeHeadSha: input.worktreeHeadSha,
  });
  if (evidence[0] !== `finding-adoption-sha256:${adoption.adoptionSha256}`) {
    throw new Error("resolved finding adoption evidence drift");
  }
  return adoption;
};

export const materializeIntegrationFindingAdoption = (
  path: string,
  adoption: IntegrationFindingAdoption,
): void => {
  const content = `${JSON.stringify(adoption, null, 2)}\n`;
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content) {
      throw new Error("immutable finding adoption byte drift");
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { flag: "wx" });
};
