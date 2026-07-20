import type { Ref } from "@confect/core";
import {
  templateConfectRefs,
  type TemplateConfectRefs,
} from "@maestro-template/convex/refs";
import { createFileRoute } from "@tanstack/react-router";

import {
  useTemplateAction,
  useTemplateMutation,
  useTemplateQuery,
} from "../adapters/confect-state";
import {
  createMemberManagementAdapter,
  type WorkspaceId,
} from "../features/settings/member-management-adapter";
import { MemberManagement } from "../features/settings/member-management";
import { createApiKeySettingsAdapter } from "../features/settings/api-keys-adapter";
import { ApiKeysPanel } from "../features/settings/api-keys-panel";
import type {
  ApiKeySettingsMetadata,
  PublicApiKeySettingsMetadata,
} from "../features/settings/api-keys";
import { useWorkspace } from "../providers/workspace";
import { BusinessSettingsRoute } from "../saas-ui/business-shell";
import { selectStableApiKeyBrainKey } from "../features/settings/settings-surface";

type ApiKeyScope = "brain:read" | "brain:ask";
type ApiKeyError =
  | { readonly _tag: "Unauthorized" }
  | { readonly _tag: "Forbidden" }
  | { readonly _tag: "ApiKeyNotFound" }
  | { readonly _tag: "ApiKeyRevoked" }
  | { readonly _tag: "ApiKeyConflict" }
  | { readonly _tag: "ApiKeyExpiryInvalid" }
  | { readonly _tag: "ApiKeyScopeInvalid" };
type PublicMutationRef<Args, Returns, Error> = Ref.Ref<
  { readonly runtime: "Convex"; readonly functionType: "mutation" },
  "public",
  Args,
  Returns,
  Error
>;
type PublicQueryRef<Args, Returns, Error> = Ref.Ref<
  { readonly runtime: "Convex"; readonly functionType: "query" },
  "public",
  Args,
  Returns,
  Error
>;
type ApiKeyRefs = {
  readonly public: TemplateConfectRefs["public"] & {
    readonly headless: {
      readonly apiKeys: {
        readonly create: PublicMutationRef<
          {
            readonly brainKey: string;
            readonly name: string;
            readonly scopes: readonly ApiKeyScope[];
            readonly expiresAt: number;
          },
          {
            readonly displayKey: string;
            readonly key: PublicApiKeySettingsMetadata;
          },
          ApiKeyError
        >;
        readonly list: PublicQueryRef<
          { readonly brainKey: string },
          readonly ApiKeySettingsMetadata[],
          ApiKeyError
        >;
        readonly rotate: PublicMutationRef<
          {
            readonly brainKey: string;
            readonly keyId: string;
            readonly expiresAt: number;
          },
          {
            readonly displayKey: string;
            readonly key: PublicApiKeySettingsMetadata;
          },
          ApiKeyError
        >;
        readonly revoke: PublicMutationRef<
          { readonly brainKey: string; readonly keyId: string },
          null,
          ApiKeyError
        >;
      };
    };
  };
};

// Checked-in generated refs are integration-owned until centralized Confect
// codegen refreshes templateConfectRefs.public.headless.apiKeys.
// Intersect only the amended ref shape until that integration refresh lands.
const apiKeyRefs = (templateConfectRefs as unknown as ApiKeyRefs).public
  .headless.apiKeys;

const accessRefs = {
  members: templateConfectRefs.public.access.members,
  invitations: {
    list: templateConfectRefs.public.access.invitations.list,
    create: templateConfectRefs.public.access.invitations.create,
    cancel: templateConfectRefs.public.access.invitations.cancel,
  },
} as const;

export const Route = createFileRoute("/_workspace/settings")({
  component: WorkspaceSettingsRoute,
});

function WorkspaceSettingsRoute() {
  const workspace = useWorkspace();
  const createInvitation = useTemplateAction(accessRefs.invitations.create);
  const createApiKey = useTemplateMutation(apiKeyRefs.create);
  const rotateApiKey = useTemplateMutation(apiKeyRefs.rotate);
  const revokeApiKey = useTemplateMutation(apiKeyRefs.revoke);
  const cancelInvitation = useTemplateAction(accessRefs.invitations.cancel);
  const changeRole = useTemplateAction(accessRefs.members.changeRole);
  const removeMember = useTemplateAction(accessRefs.members.remove);
  const transferOwnership = useTemplateAction(
    accessRefs.members.transferOwnership,
  );
  const workspaceId =
    workspace.status === "ready"
      ? (workspace.activeWorkspace.workspaceId as WorkspaceId)
      : null;
  const members = useTemplateQuery(
    accessRefs.members.list,
    workspaceId === null ? "skip" : { workspaceId },
  );
  const invitations = useTemplateQuery(
    accessRefs.invitations.list,
    workspaceId === null ? "skip" : { workspaceId },
  );
  const stableBrainKey =
    workspace.status === "ready"
      ? selectStableApiKeyBrainKey(workspace.activeWorkspace)
      : null;
  const apiKeys = useTemplateQuery(
    apiKeyRefs.list,
    stableBrainKey === null ? "skip" : { brainKey: stableBrainKey },
  );

  if (workspace.status !== "ready") {
    return <BusinessSettingsRoute />;
  }

  const activeBrainKey = selectStableApiKeyBrainKey(workspace.activeWorkspace);
  const apiKeyAdapter = createApiKeySettingsAdapter({
    role: workspace.activeWorkspace.role,
    brainKey: activeBrainKey,
    mutations: {
      create: createApiKey,
      rotate: rotateApiKey,
      revoke: revokeApiKey,
    },
  });
  const adapter = createMemberManagementAdapter({
    role: workspace.activeWorkspace.role,
    workspaceId: workspace.activeWorkspace.workspaceId as WorkspaceId,
    mutations: {
      createInvitation,
      cancelInvitation,
      changeRole,
      removeMember,
      transferOwnership,
    },
  });

  return (
    <>
      <BusinessSettingsRoute />
      <MemberManagement
        adapter={adapter}
        members={toRowsState(members, "Member list access denied.")}
        invitations={toRowsState(invitations, "Invitation list access denied.")}
      />
      <ApiKeysPanel
        adapter={apiKeyAdapter}
        keys={toRowsState(apiKeys, "API key list access denied.")}
      />
    </>
  );
}

const toRowsState = <T, E>(
  state:
    | { readonly status: "ready"; readonly data: readonly T[] }
    | { readonly status: "loading" }
    | { readonly status: "skipped" }
    | { readonly status: "empty"; readonly data: readonly T[] }
    | {
        readonly status: "parse_failure" | "transport_failure" | "defect";
        readonly message: string;
      }
    | { readonly status: "typed_failure"; readonly error: E },
  deniedMessage: string,
) => {
  switch (state.status) {
    case "ready":
    case "empty":
      return { status: "ready" as const, data: state.data };
    case "loading":
    case "skipped":
      return { status: "loading" as const };
    case "typed_failure":
      return { status: "denied" as const, message: deniedMessage };
    case "parse_failure":
    case "transport_failure":
    case "defect":
      return { status: "error" as const, message: state.message };
  }
};
