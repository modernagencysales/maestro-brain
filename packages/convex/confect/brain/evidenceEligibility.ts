import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import { DatabaseReader } from "../_generated/services";

export type BrainEvidenceProvider =
  "brain_page" | "slack" | "google_drive" | "hubspot" | "transcript";

type ProviderScopeState = Readonly<{
  status: string;
  generation: number;
  connectionRef?: string | undefined;
  evidenceScopeKey?: string | undefined;
  pendingEvidenceScopeKey?: string | undefined;
}>;

export type EvidenceScopePolicy = ReadonlyMap<string, ProviderScopeState>;

const connectionProvider = (provider: BrainEvidenceProvider): string =>
  provider === "google_drive" ? "google-drive" : provider;

export const loadEvidenceScopePolicy = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const rows = yield* (yield* DatabaseReader)
      .table("providerConnections")
      .index("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(6)
      .pipe(Effect.orDie);
    return new Map(
      rows.flatMap((row) =>
        "workspaceId" in row
          ? [
              [
                row.provider,
                {
                  status: row.status,
                  generation: row.generation,
                  connectionRef: row.connectionRef,
                  evidenceScopeKey: row.evidenceScopeKey,
                  pendingEvidenceScopeKey: row.pendingEvidenceScopeKey,
                },
              ] as const,
            ]
          : [],
      ),
    ) as EvidenceScopePolicy;
  });

export const providerScopeIsReadable = (
  policy: EvidenceScopePolicy,
  provider: BrainEvidenceProvider,
  scopeKey: string,
): boolean => {
  if (provider === "brain_page" || provider === "transcript") return true;
  const state = policy.get(connectionProvider(provider));
  if (state === undefined || state.status !== "active") return false;
  if (state.evidenceScopeKey !== undefined)
    return state.evidenceScopeKey === scopeKey;
  return (
    provider === "slack" && scopeKey === `slack:${state.connectionRef ?? ""}`
  );
};

export const readableProviderScopeKey = (
  policy: EvidenceScopePolicy,
  provider: BrainEvidenceProvider,
): string | null | undefined => {
  if (provider === "brain_page") return "brain-pages";
  if (provider === "transcript") return undefined;
  const state = policy.get(connectionProvider(provider));
  if (state === undefined || state.status !== "active") return null;
  if (state.evidenceScopeKey !== undefined) return state.evidenceScopeKey;
  return provider === "slack" ? `slack:${state.connectionRef ?? ""}` : null;
};

export const connectorScopeIsWritable = (
  policy: EvidenceScopePolicy,
  input: {
    readonly provider: BrainEvidenceProvider;
    readonly scopeKey: string;
    readonly connectionGeneration?: number | undefined;
  },
): boolean => {
  if (input.provider === "brain_page" || input.provider === "transcript")
    return true;
  const state = policy.get(connectionProvider(input.provider));
  if (state === undefined || state.status !== "active") return false;
  if (
    input.connectionGeneration !== undefined &&
    state.generation !== input.connectionGeneration
  )
    return false;
  return state.pendingEvidenceScopeKey !== undefined
    ? state.pendingEvidenceScopeKey === input.scopeKey
    : providerScopeIsReadable(policy, input.provider, input.scopeKey);
};
