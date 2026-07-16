import { describe, expect, it } from "vitest";
import * as Either from "effect/Either";
import type { TemplateDataState } from "../../adapters/confect-state";
import {
  buildBrainSearchTarget,
  createClientBrain,
  toClientBrainSummaries,
  toClientsDataState,
  type ClientsListData,
  type ClientsListError,
  type CreateClientBrainMutation,
} from "./clients-adapter";

const workspaceRows: ClientsListData = [
  {
    agencyKey: "ag_one",
    brainKey: "br_agency",
    name: "Agency",
    kind: "agency",
    effectiveRole: "owner",
    status: "active",
    freshness: {
      updatedAt: 1,
      lifecycleGeneration: 0,
      revocationGeneration: 0,
    },
  },
  {
    agencyKey: "ag_one",
    brainKey: "br_client",
    name: "Client",
    kind: "client",
    clientSlug: "client",
    effectiveRole: "owner",
    status: "active",
    freshness: {
      updatedAt: 2,
      lifecycleGeneration: 0,
      revocationGeneration: 0,
    },
  },
];

describe("clients adapter", () => {
  it("maps generated workspace list refs into client summaries with explicit zero future metrics", () => {
    expect(toClientBrainSummaries(workspaceRows)).toEqual([
      expect.objectContaining({
        brainKey: "br_client",
        connectionCount: 0,
        recentChangeCount: 0,
        connectionHealth: "not_connected",
      }),
    ]);
  });

  it("maps ready, typed, transport, and loading list states", () => {
    const ready: TemplateDataState<ClientsListData, ClientsListError> = {
      status: "ready",
      mode: "read",
      data: [],
    };
    const typedError = Object.assign(new Error("typed"), {
      _tag: "Unauthorized" as const,
    }) as ClientsListError;
    const typed: TemplateDataState<ClientsListData, ClientsListError> = {
      status: "typed_failure",
      error: typedError,
    };
    const transport: TemplateDataState<ClientsListData, ClientsListError> = {
      status: "transport_failure",
      error: new TypeError("net"),
      message: "net",
    };

    expect(toClientsDataState(ready)).toEqual({ status: "ready", clients: [] });
    expect(toClientsDataState(typed)).toEqual({ status: "typed_failure" });
    const parse: TemplateDataState<ClientsListData, ClientsListError> = {
      status: "parse_failure",
      error: new SyntaxError("bad"),
      message: "bad",
    };
    const defect: TemplateDataState<ClientsListData, ClientsListError> = {
      status: "defect",
      error: new Error("bug"),
      message: "bug",
    };

    expect(toClientsDataState(transport)).toEqual({
      status: "transport_failure",
    });
    expect(toClientsDataState(parse)).toEqual({ status: "transport_failure" });
    expect(toClientsDataState(defect)).toEqual({ status: "transport_failure" });
    expect(toClientsDataState({ status: "skipped" })).toEqual({
      status: "loading",
    });
    expect(toClientsDataState({ status: "loading" })).toEqual({
      status: "loading",
    });
  });

  it("wraps create mutation typed success and failure", async () => {
    const successMutation: CreateClientBrainMutation = async () =>
      Either.right({
        brainKey: "br_client",
        initialPageKey: "pag_br_client_overview",
        pages: [],
        capacity: {
          clientBrains: 1,
          clientBrainLimit: 25,
          remainingClientBrains: 24,
        },
      });
    const failureMutation: CreateClientBrainMutation = async () =>
      Either.left(
        Object.assign(new Error("duplicate"), {
          _tag: "ClientBrainAlreadyExists" as const,
          clientSlug: "client",
        }),
      );

    const success = await createClientBrain(successMutation, {
      name: "Client",
      clientSlug: "client",
      idempotencyKey: "idem-client",
    });
    const failure = await createClientBrain(failureMutation, {
      name: "Client",
      clientSlug: "client",
      idempotencyKey: "idem-client",
    });

    expect(success.status).toBe("ready");
    expect(failure.status).toBe("typed_failure");
  });

  it("builds registered Brain route search target after creation", () => {
    expect(
      buildBrainSearchTarget({
        brainKey: "br_client",
        initialPageKey: "pag_br_client_overview",
      }),
    ).toEqual({
      to: "/brain",
      search: {
        brainKey: "br_client",
        pageKey: "pag_br_client_overview",
      },
    });
  });
});
