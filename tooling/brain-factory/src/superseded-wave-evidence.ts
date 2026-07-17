import { gitSha } from "./integration-recovery.js";
import {
  record,
  string,
  type JsonRecord,
} from "./integration-check-support.js";
import {
  type IntegrationWaveSelection,
  validateIntegrationWaveSelection,
} from "./integration-wave.js";
import {
  type IntegrationWaveSupersessionReceipt,
  validateIntegrationWaveSupersessionReceipt,
} from "./integration-wave-supersession.js";

export interface SupersededWaveEvidence {
  readonly integrationId: string;
  readonly integrationResult: unknown;
  readonly promotionExists: boolean;
  readonly runRecordContent: string;
  readonly selectionContent: string;
  readonly selectionPath: string;
  readonly supersessionReceipt: unknown;
}

export interface ValidatedSupersededWave {
  readonly headSha: string;
  readonly resultTasks: ReadonlyMap<string, JsonRecord>;
  readonly selection: IntegrationWaveSelection;
  readonly supersession: IntegrationWaveSupersessionReceipt;
}

export const validateSupersededWaveEvidence = (input: {
  readonly currentControlHead: string;
  readonly isAncestor: (ancestor: string, descendant: string) => boolean;
  readonly wave: SupersededWaveEvidence;
}): ValidatedSupersededWave => {
  if (input.wave.promotionExists) {
    throw new Error(
      `${input.wave.integrationId}: promoted waves cannot restore lanes`,
    );
  }
  const supersession = validateIntegrationWaveSupersessionReceipt({
    currentControlHead: input.currentControlHead,
    expectedIntegrationId: input.wave.integrationId,
    isAncestor: input.isAncestor,
    receipt: input.wave.supersessionReceipt,
    runRecordContent: input.wave.runRecordContent,
    selectionContent: input.wave.selectionContent,
    selectionPath: input.wave.selectionPath,
  });
  const selection = JSON.parse(
    input.wave.selectionContent,
  ) as IntegrationWaveSelection;
  validateIntegrationWaveSelection(selection);
  const result = record(
    input.wave.integrationResult,
    `${input.wave.integrationId}: integration result`,
  );
  const headSha = gitSha(result.headSha, "integration result head");
  if (
    result.schemaVersion !== "maestro-brain-integration-result/v2" ||
    result.integrationId !== input.wave.integrationId ||
    result.status !== "passed" ||
    result.reviewVerdict !== "pass" ||
    result.integrationHeadSha !== headSha ||
    result.selectionSha256 !== selection.selectionSha256 ||
    !Array.isArray(result.remainingFindings) ||
    result.remainingFindings.length !== 0 ||
    !Array.isArray(result.includedTasks)
  ) {
    throw new Error(
      `${input.wave.integrationId}: integration result binding mismatch`,
    );
  }
  const resultTasks = new Map<string, JsonRecord>();
  for (const [index, value] of result.includedTasks.entries()) {
    const included = record(value, `includedTasks[${index}]`);
    const taskId = string(included.taskId, `includedTasks[${index}].taskId`);
    if (resultTasks.has(taskId)) {
      throw new Error(
        `${input.wave.integrationId}: duplicate result task binding`,
      );
    }
    resultTasks.set(taskId, included);
  }
  const selectedIds = selection.selectedTasks.map((task) => task.taskId);
  if (
    JSON.stringify([...resultTasks.keys()]) !== JSON.stringify(selectedIds) ||
    JSON.stringify(supersession.selectedTaskIds) !== JSON.stringify(selectedIds)
  ) {
    throw new Error(`${input.wave.integrationId}: task binding mismatch`);
  }
  for (const selected of selection.selectedTasks) {
    const included = resultTasks.get(selected.taskId);
    if (
      !included ||
      included.laneHeadSha !== selected.headSha ||
      included.laneResultSha256 !== selected.laneResultSha256 ||
      included.tranche !== selected.tranche
    ) {
      throw new Error(
        `${selected.taskId}: integration result task binding mismatch`,
      );
    }
  }
  return { headSha, resultTasks, selection, supersession };
};
