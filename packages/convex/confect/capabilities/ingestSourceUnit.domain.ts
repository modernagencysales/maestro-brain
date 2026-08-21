import type { CanonicalTranscriptRevisionOrder } from "@maestro-template/integrations/transcripts/canonical";

export type IngestPlan =
  | { readonly outcome: "duplicate" }
  | { readonly outcome: "stale"; readonly replaceCurrent: false }
  | {
      readonly outcome: "conflict";
      readonly reason:
        "equal_order" | "incompatible_order" | "missing_current_order";
    }
  | { readonly outcome: "inserted"; readonly replaceCurrent: boolean }
  | { readonly outcome: "tombstone"; readonly replaceCurrent: true };

const compareRevisionOrder = (
  current: CanonicalTranscriptRevisionOrder,
  incoming: CanonicalTranscriptRevisionOrder,
): "older" | "equal" | "newer" | "incompatible" => {
  if (current.kind !== incoming.kind) return "incompatible";
  const currentValue =
    current.kind === "provider_timestamp"
      ? Date.parse(current.timestamp)
      : current.epoch;
  const incomingValue =
    incoming.kind === "provider_timestamp"
      ? Date.parse(incoming.timestamp)
      : incoming.epoch;
  return incomingValue < currentValue
    ? "older"
    : incomingValue > currentValue
      ? "newer"
      : "equal";
};

export const planSourceUnitIngestion = (input: {
  readonly currentUnitRevisionKey: string | null;
  readonly currentRevisionOrder: CanonicalTranscriptRevisionOrder | null;
  readonly incomingUnitRevisionKey: string;
  readonly incomingRevisionOrder: CanonicalTranscriptRevisionOrder;
  readonly incomingDeleted: boolean;
  readonly revisionAlreadyExists: boolean;
}): IngestPlan => {
  if (
    input.revisionAlreadyExists ||
    input.currentUnitRevisionKey === input.incomingUnitRevisionKey
  )
    return { outcome: "duplicate" };
  if (input.currentUnitRevisionKey !== null) {
    if (input.currentRevisionOrder === null)
      return { outcome: "conflict", reason: "missing_current_order" };
    const order = compareRevisionOrder(
      input.currentRevisionOrder,
      input.incomingRevisionOrder,
    );
    if (order === "incompatible")
      return { outcome: "conflict", reason: "incompatible_order" };
    if (order === "equal")
      return { outcome: "conflict", reason: "equal_order" };
    if (order === "older") return { outcome: "stale", replaceCurrent: false };
  }
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
