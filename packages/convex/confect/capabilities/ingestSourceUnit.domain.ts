export type IngestPlan =
  | { readonly outcome: "duplicate" }
  | { readonly outcome: "inserted"; readonly replaceCurrent: boolean }
  | { readonly outcome: "tombstone"; readonly replaceCurrent: true };

export const planSourceUnitIngestion = (input: {
  readonly currentUnitRevisionKey: string | null;
  readonly incomingUnitRevisionKey: string;
  readonly incomingDeleted: boolean;
  readonly revisionAlreadyExists: boolean;
}): IngestPlan => {
  if (
    input.revisionAlreadyExists ||
    input.currentUnitRevisionKey === input.incomingUnitRevisionKey
  )
    return { outcome: "duplicate" };
  if (input.incomingDeleted)
    return { outcome: "tombstone", replaceCurrent: true };
  return {
    outcome: "inserted",
    replaceCurrent: input.currentUnitRevisionKey !== null,
  };
};

export const requireSourceIngestionCaller = (caller: {
  readonly kind: string;
  readonly name?: string;
  readonly surface: string;
}): boolean => {
  return !(
    caller.kind !== "system" ||
    (caller.surface !== "workflow" && caller.surface !== "internal")
  );
};
