import { useState } from "react";
import type { Ref } from "@confect/core";
import type * as Either from "effect/Either";

import {
  templateConfectRefs,
  type TemplateConfectRefs,
} from "@maestro-template/convex/refs";
import {
  classifyConfectMutationResult,
  normalizeMutationError,
  type TemplateDataState,
  type TemplateMutationState,
  useTemplateMutation,
  useTemplateQuery,
} from "../../adapters/confect-state";
import { buildClientsState, transitionClientOnboarding } from "./clients-state";
import type {
  ClientBrainSummary,
  ClientOnboardingState,
  CreateClientInput,
} from "./clients-state";

type ListWorkspacesRef =
  TemplateConfectRefs["public"]["auth"]["workspaces"]["list"];
type GeneratedCreateClientBrainRef =
  TemplateConfectRefs["public"]["access"]["provisioning"]["createClientBrain"];

type ClientBrainAlreadyExists = {
  readonly _tag: "ClientBrainAlreadyExists";
  readonly clientSlug: string;
};
type CapacityExceeded = {
  readonly _tag: "CapacityExceeded";
  readonly limit: number;
};

type ClientBriefPage = {
  readonly pageKey: string;
  readonly slug: string;
  readonly title: string;
  readonly sortKey: string;
};

type ClientBrainCapacity = {
  readonly clientBrains: number;
  readonly clientBrainLimit: number;
  readonly remainingClientBrains: number;
};

export type CreateClientBrainResult = {
  readonly brainKey: string;
  readonly initialPageKey: string;
  readonly pages: readonly ClientBriefPage[];
  readonly capacity: ClientBrainCapacity;
};

type CreateClientBrainArgs = {
  readonly name: string;
  readonly clientSlug: string;
  readonly idempotencyKey: string;
};

export type CreateClientBrainError =
  | Ref.Error<GeneratedCreateClientBrainRef>
  | ClientBrainAlreadyExists
  | CapacityExceeded;

export type CreateClientBrainRef = Ref.Ref<
  { readonly runtime: "Convex"; readonly functionType: "mutation" },
  "public",
  CreateClientBrainArgs,
  CreateClientBrainResult,
  CreateClientBrainError
>;

type ClientsRefsWithCreateBridge = TemplateConfectRefs & {
  readonly public: TemplateConfectRefs["public"] & {
    readonly access: TemplateConfectRefs["public"]["access"] & {
      readonly provisioning: TemplateConfectRefs["public"]["access"]["provisioning"] & {
        readonly createClientBrain: CreateClientBrainRef;
      };
    };
  };
};

// Checked-in generated refs are integration-owned until centralized Confect
// codegen refreshes this amended spec; intersect only the amended ref shape.
const refsWithCreateBridge = templateConfectRefs as ClientsRefsWithCreateBridge;

export type ClientsListData = Ref.Returns<ListWorkspacesRef>;
export type ClientsListError = Ref.Error<ListWorkspacesRef>;
export type CreateClientBrainMutation = (
  args: CreateClientBrainArgs,
) => Promise<
  | CreateClientBrainResult
  | Either.Either<CreateClientBrainResult, CreateClientBrainError>
>;

export type BrainSearchTarget = {
  readonly to: "/brain";
  readonly search: { readonly brainKey: string; readonly pageKey: string };
};

export const clientsRefs: {
  readonly list: ListWorkspacesRef;
  readonly createClientBrain: CreateClientBrainRef;
} = {
  list: templateConfectRefs.public.auth.workspaces.list,
  createClientBrain:
    refsWithCreateBridge.public.access.provisioning.createClientBrain,
} as const;

export const buildBrainSearchTarget = (
  result: Pick<CreateClientBrainResult, "brainKey" | "initialPageKey">,
): BrainSearchTarget => ({
  to: "/brain",
  search: { brainKey: result.brainKey, pageKey: result.initialPageKey },
});

export const toClientBrainSummaries = (
  workspaces: ClientsListData,
): readonly ClientBrainSummary[] =>
  workspaces
    .filter((workspace) => workspace.kind === "client")
    .map((workspace) => ({
      brainKey: workspace.brainKey,
      name: workspace.name,
      clientSlug: workspace.clientSlug ?? workspace.brainKey,
      status: workspace.status,
      updatedAt: workspace.freshness.updatedAt,
      connectionCount: 0,
      recentChangeCount: 0,
      connectionHealth: "not_connected",
    }));

export const toClientsDataState = (
  state: TemplateDataState<ClientsListData, ClientsListError>,
) => {
  if (state.status === "ready" || state.status === "empty") {
    return {
      status: "ready" as const,
      clients: toClientBrainSummaries(state.data),
    };
  }
  if (state.status === "typed_failure")
    return { status: "typed_failure" as const };
  if (
    state.status === "parse_failure" ||
    state.status === "transport_failure" ||
    state.status === "defect"
  ) {
    return { status: "transport_failure" as const };
  }
  return { status: "loading" as const };
};

export const createClientBrain = async (
  mutation: CreateClientBrainMutation,
  input: CreateClientInput,
): Promise<
  TemplateMutationState<CreateClientBrainResult, CreateClientBrainError>
> => {
  try {
    return classifyConfectMutationResult(
      await mutation({
        name: input.name,
        clientSlug: input.clientSlug,
        idempotencyKey: input.idempotencyKey,
      }),
    );
  } catch (error) {
    return normalizeMutationError(error);
  }
};

export function useClientsController({
  onCreated,
}: {
  readonly onCreated: (target: BrainSearchTarget) => void | Promise<void>;
}) {
  const listState = useTemplateQuery(clientsRefs.list, {});
  const createMutation = useTemplateMutation(clientsRefs.createClientBrain);
  const [onboarding, setOnboarding] = useState<ClientOnboardingState>({
    status: "idle",
  });
  const onCreateClient = async (input: CreateClientInput) => {
    setOnboarding((current) =>
      transitionClientOnboarding(current, {
        type: "submit",
        idempotencyKey: input.idempotencyKey,
      }),
    );
    const result = await createClientBrain(createMutation, input);
    if (result.status === "ready") {
      setOnboarding((current) =>
        transitionClientOnboarding(
          transitionClientOnboarding(current, { type: "seeded" }),
          {
            type: "created",
            brainKey: result.data.brainKey,
            initialPageKey: result.data.initialPageKey,
            capacity: result.data.capacity,
          },
        ),
      );
      await onCreated(buildBrainSearchTarget(result.data));
      return;
    }
    setOnboarding((current) =>
      transitionClientOnboarding(current, {
        type: "failed",
        message:
          result.status === "typed_failure"
            ? "Client Brain creation was rejected by a typed contract."
            : "Client Brain creation failed. Retry with the same request.",
      }),
    );
  };
  return {
    state: buildClientsState(toClientsDataState(listState)),
    onboarding,
    onCreateClient,
  };
}
