import { reconcilePreparingTaskReservation } from "./dispatch-ownership.js";

type JsonRecord = Record<string, unknown>;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
};

const canonical = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

export const resolveLaneGreenAuthorityReproofReservation = (input: {
  readonly candidates?: readonly {
    readonly branch?: unknown;
    readonly inspection?: unknown;
  }[];
  readonly expectedConfigInputs: JsonRecord;
  readonly expectedReservation: JsonRecord;
  readonly reservation: unknown;
}):
  | { readonly kind: "recover-launched"; readonly runId: string }
  | { readonly kind: "retry-launch" } => {
  if (
    typeof input.reservation !== "object" ||
    input.reservation === null ||
    Array.isArray(input.reservation) ||
    canonical(input.reservation) !== canonical(input.expectedReservation)
  ) {
    throw new Error("lane-green authority reproof reservation mismatch");
  }
  const reconciliation = reconcilePreparingTaskReservation({
    ...(input.candidates === undefined ? {} : { candidates: input.candidates }),
    expectedConfigInputs: input.expectedConfigInputs,
    reservation: input.reservation,
  });
  if (reconciliation.kind === "launched") {
    return { kind: "recover-launched", runId: reconciliation.runId };
  }
  if (reconciliation.kind === "not-launched") {
    return { kind: "retry-launch" };
  }
  throw new Error(
    `preparing reservation launch state is ${reconciliation.kind}`,
  );
};
