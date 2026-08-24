import { canonical, sha256 } from "./crypto";

type ParsedSnapshot = {
  readonly runs: readonly unknown[];
  readonly immutableBindings: readonly unknown[];
};
type ValidatedSnapshot = ParsedSnapshot & {
  readonly bindings: ReadonlyMap<string, Record<string, unknown>>;
};

export const validateAndHashSnapshot = async (
  snapshot: Record<string, unknown>,
): Promise<string | undefined> => {
  const validated = await validateSnapshot(snapshot);
  return validated === undefined
    ? undefined
    : sha256(
        canonical({
          environment: snapshot.environment,
          targetId: snapshot.targetId,
          commitSha: snapshot.commitSha,
          capturedAt: snapshot.capturedAt,
          expiresAt: snapshot.expiresAt,
          pageCount: snapshot.pageCount,
          totalCount: snapshot.totalCount,
          nextCursor: null,
          runs: validated.runs,
          immutableBindings: validated.immutableBindings,
        }),
      );
};
const validateSnapshot = async (
  snapshot: Record<string, unknown>,
): Promise<ValidatedSnapshot | undefined> => {
  const parsed = parseSnapshot(snapshot);
  if (parsed === undefined || !validHeader(snapshot, parsed)) return undefined;
  const bindings = bindingMap(parsed.immutableBindings, parsed.runs.length);
  if (bindings === undefined) return undefined;
  return (await runsAreValid(parsed.runs, bindings))
    ? { ...parsed, bindings }
    : undefined;
};
const parseSnapshot = (
  snapshot: Record<string, unknown>,
): ParsedSnapshot | undefined => {
  try {
    const runs: unknown = JSON.parse(String(snapshot.runsJson));
    const immutableBindings: unknown = JSON.parse(
      String(snapshot.immutableBindingsJson),
    );
    return Array.isArray(runs) && Array.isArray(immutableBindings)
      ? { runs, immutableBindings }
      : undefined;
  } catch {
    return undefined;
  }
};
const validHeader = (
  snapshot: Record<string, unknown>,
  parsed: ParsedSnapshot,
): boolean =>
  [
    validScope(snapshot),
    validCaptureWindow(snapshot),
    validCounts(snapshot, parsed),
  ].every(Boolean);

const validScope = (snapshot: Record<string, unknown>): boolean =>
  [
    snapshot.environment === "staging" || snapshot.environment === "production",
    typeof snapshot.targetId === "string" &&
      /^[a-z][a-z0-9-]{0,62}$/.test(snapshot.targetId),
    typeof snapshot.commitSha === "string" &&
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(snapshot.commitSha),
  ].every(Boolean);

const validCaptureWindow = (snapshot: Record<string, unknown>): boolean =>
  [
    Number.isSafeInteger(snapshot.capturedAt) &&
      Number(snapshot.capturedAt) >= 0,
    Number.isSafeInteger(snapshot.expiresAt) &&
      Number(snapshot.expiresAt) > Number(snapshot.capturedAt),
  ].every(Boolean);

const validCounts = (
  snapshot: Record<string, unknown>,
  parsed: ParsedSnapshot,
): boolean =>
  [
    snapshot.nextCursor === null,
    Number.isSafeInteger(snapshot.pageCount) && Number(snapshot.pageCount) >= 1,
    Number.isSafeInteger(snapshot.totalCount) &&
      Number(snapshot.totalCount) === parsed.runs.length,
    parsed.immutableBindings.length === parsed.runs.length,
  ].every(Boolean);
const bindingMap = (
  immutableBindings: readonly unknown[],
  expectedSize: number,
): ReadonlyMap<string, Record<string, unknown>> | undefined => {
  const entries = immutableBindings.flatMap((binding) =>
    isRecord(binding)
      ? [[`${binding.workflowId}@${binding.workflowVersion}`, binding] as const]
      : [],
  );
  const bindings = new Map(entries);
  return entries.length === expectedSize && bindings.size === expectedSize
    ? bindings
    : undefined;
};
const runsAreValid = async (
  runs: readonly unknown[],
  bindings: ReadonlyMap<string, Record<string, unknown>>,
): Promise<boolean> => {
  let previous = "";
  for (const run of runs) {
    const fingerprint = await validatedRunFingerprint(run, bindings, previous);
    if (fingerprint === undefined) return false;
    previous = fingerprint;
  }
  return true;
};

const validatedRunFingerprint = async (
  run: unknown,
  bindings: ReadonlyMap<string, Record<string, unknown>>,
  previous: string,
): Promise<string | undefined> => {
  if (!isRecord(run)) return undefined;
  const { runFingerprint, ...runPayload } = run;
  const validFingerprint = await validRunFingerprint(
    runFingerprint,
    runPayload,
    previous,
  );
  return validFingerprint && validBinding(run, bindings)
    ? String(runFingerprint)
    : undefined;
};
const validRunFingerprint = async (
  fingerprint: unknown,
  payload: Record<string, unknown>,
  previous: string,
): Promise<boolean> =>
  typeof fingerprint === "string" &&
  fingerprint === (await sha256(canonical(payload))) &&
  (previous === "" || previous < fingerprint);
const validBinding = (
  run: Record<string, unknown>,
  bindings: ReadonlyMap<string, Record<string, unknown>>,
): boolean => {
  const binding = bindings.get(`${run.workflowId}@${run.workflowVersion}`);
  return (
    binding !== undefined &&
    [
      "runnerHash",
      "runtimeHash",
      "capabilityBindingsHash",
      "completionBindingHash",
    ].every((field) => run[field] === binding[field])
  );
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
