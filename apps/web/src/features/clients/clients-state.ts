import type { ClientsScreenState, ClientRow } from "./clients-screen";

export type ClientBrainSummary = {
  readonly brainKey: string;
  readonly name: string;
  readonly clientSlug: string;
  readonly status: "active" | "archived";
  readonly updatedAt: number;
  readonly connectionCount: number;
  readonly recentChangeCount: number;
  readonly connectionHealth: "connected" | "not_connected";
};

export type CreateClientInput = {
  readonly name: string;
  readonly clientSlug: string;
  readonly idempotencyKey: string;
};

export type ClientCapacityEnvelope = {
  readonly clientBrains: number;
  readonly clientBrainLimit: number;
  readonly remainingClientBrains: number;
};

export type ClientOnboardingState =
  | { readonly status: "idle" }
  | { readonly status: "creating"; readonly idempotencyKey: string }
  | { readonly status: "seeding"; readonly idempotencyKey: string }
  | {
      readonly status: "ready";
      readonly idempotencyKey: string;
      readonly brainKey: string;
      readonly initialPageKey: string;
      readonly capacity: ClientCapacityEnvelope;
    }
  | {
      readonly status: "failed";
      readonly idempotencyKey: string;
      readonly message: string;
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

export const buildCreateClientInput = (input: {
  readonly name: string;
  readonly clientSlug: string;
  readonly existingIdempotencyKey?: string | undefined;
}): CreateClientInput => ({
  name: input.name.trim(),
  clientSlug: input.clientSlug.trim().toLowerCase(),
  idempotencyKey:
    input.existingIdempotencyKey ??
    `client-${input.clientSlug.trim().toLowerCase()}-${Date.now().toString(36)}`,
});

export const transitionClientOnboarding = (
  state: ClientOnboardingState,
  event:
    | { readonly type: "submit"; readonly idempotencyKey: string }
    | { readonly type: "seeded" }
    | {
        readonly type: "created";
        readonly brainKey: string;
        readonly initialPageKey: string;
        readonly capacity: ClientCapacityEnvelope;
      }
    | { readonly type: "failed"; readonly message: string },
): ClientOnboardingState => {
  if (event.type === "submit") {
    return { status: "creating", idempotencyKey: event.idempotencyKey };
  }
  if (state.status !== "creating" && state.status !== "seeding") return state;
  if (event.type === "seeded") {
    return { status: "seeding", idempotencyKey: state.idempotencyKey };
  }
  if (event.type === "created") {
    return {
      status: "ready",
      idempotencyKey: state.idempotencyKey,
      brainKey: event.brainKey,
      initialPageKey: event.initialPageKey,
      capacity: event.capacity,
    };
  }
  return {
    status: "failed",
    idempotencyKey: state.idempotencyKey,
    message: event.message,
  };
};

const toClientRow = (client: ClientBrainSummary): ClientRow => ({
  key: client.brainKey,
  name: client.name,
  health:
    client.connectionHealth === "connected" ? "Connected" : "Not connected",
  freshness: `Updated ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(client.updatedAt))}`,
  connections: client.connectionCount,
  recentChanges: client.recentChangeCount,
});
