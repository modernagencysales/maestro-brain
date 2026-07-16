import type { ClientsScreenState, ClientRow } from "./clients-screen";

export type ClientBrainSummary = {
  readonly brainKey: string;
  readonly name: string;
  readonly clientSlug: string;
  readonly status: "active" | "archived";
  readonly updatedAt: number;
  readonly connectionCount: number;
  readonly recentChangeCount: number;
};

export type ClientsDataState =
  | { readonly status: "loading" }
  | { readonly status: "typed_failure" }
  | { readonly status: "transport_failure" }
  | {
      readonly status: "ready";
      readonly clients: readonly ClientBrainSummary[];
    };

export const buildClientsState = (
  state: ClientsDataState,
): ClientsScreenState => {
  if (state.status !== "ready") return { status: state.status };

  const clients = state.clients
    .filter((client) => client.status === "active")
    .map(toClientRow);

  return clients.length === 0
    ? { status: "empty" }
    : { status: "ready", clients };
};

const toClientRow = (client: ClientBrainSummary): ClientRow => ({
  key: client.brainKey,
  name: client.name,
  health: "Ready",
  freshness: `Updated ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(client.updatedAt))}`,
  connections: client.connectionCount,
});
