type JsonRecord = Record<string, unknown>;

/**
 * Integration and acceptance are deliberately separate. Old or mixed lane
 * records must be re-proved into one of these explicit states before a tranche
 * can pass its deterministic record gate.
 */
export const validateLaneAcceptance = (
  lane: JsonRecord,
  taskId: string,
): void => {
  if (lane.status === "integrated") {
    if (
      lane.accepted !== false ||
      typeof lane.acceptanceBlocker !== "string" ||
      lane.acceptanceBlocker.trim() === ""
    ) {
      throw new Error(
        `${taskId}: integrated task must remain accepted:false with acceptanceBlocker; migrate and re-prove legacy records`,
      );
    }
    return;
  }
  if (lane.status === "accepted") {
    if (lane.accepted !== true) {
      throw new Error(`${taskId}: accepted status requires accepted:true`);
    }
    if (
      typeof lane.acceptanceBlocker === "string" &&
      lane.acceptanceBlocker.trim() !== ""
    ) {
      throw new Error(`${taskId}: accepted task retains an acceptanceBlocker`);
    }
    return;
  }
  throw new Error(`${taskId}: lane result not integrated`);
};
