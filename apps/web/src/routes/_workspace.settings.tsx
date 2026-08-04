import { templateConfectRefs } from "@maestro-template/convex/refs";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
  useTemplateAction,
  useTemplateMutation,
  useTemplateQuery,
  classifyConfectMutationResult,
  isTemplateFailureState,
  normalizeMutationError,
} from "../adapters/confect-state";
import { describeTypedFailure } from "../adapters/failure-message";
import {
  createMemberManagementAdapter,
  type WorkspaceId,
} from "../features/settings/member-management-adapter";
import { MemberManagement } from "../features/settings/member-management";
import { createApiKeySettingsAdapter } from "../features/settings/api-keys-adapter";
import { ApiKeysPanel } from "../features/settings/api-keys-panel";
import { useWorkspace } from "../providers/workspace";
import { BusinessSettingsRoute } from "../saas-ui/business-shell";
import { selectStableApiKeyBrainKey } from "../features/settings/settings-surface";
import { BrainExports } from "../features/settings/brain-exports";
import type {
  BrainExportJob,
  BrainExportViewState,
} from "../features/settings/export-history";
import { isConvexConfigured } from "../env";

const apiKeyRefs = templateConfectRefs.public.headless.apiKeys;
const exportRefs = templateConfectRefs.public.ops.dataLifecycle;

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
  const [requestedExport, setRequestedExport] = useState<BrainExportJob | null>(
    null,
  );
  const [exportRequest, setExportRequest] = useState<
    | { readonly status: "idle" | "loading" }
    | { readonly status: "error"; readonly message: string }
  >({ status: "idle" });
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
  const exportStatus = useTemplateQuery(
    exportRefs.getBrainExport,
    requestedExport === null
      ? "skip"
      : { brainKey: requestedExport.brainKey, jobId: requestedExport.jobId },
  );
  const exportDownload = useTemplateQuery(
    exportRefs.downloadBrainExport,
    exportStatus.status === "ready" && exportStatus.data.state === "ready"
      ? {
          brainKey: exportStatus.data.brainKey,
          jobId: exportStatus.data.jobId,
        }
      : "skip",
  );
  const requestBrainExport = useTemplateMutation(exportRefs.requestBrainExport);

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
      <BrainExports
        role={workspace.activeWorkspace.role}
        {...(!isConvexConfigured()
          ? {
              disabledReason:
                "Brain export backend unavailable. Configure Convex to request an export.",
            }
          : {})}
        exportState={brainExportView(
          exportRequest,
          requestedExport,
          exportStatus,
          exportDownload,
        )}
        requestPending={exportRequest.status === "loading"}
        onRequest={async (idempotencyKey) => {
          setExportRequest({ status: "loading" });
          try {
            const result = classifyConfectMutationResult(
              await requestBrainExport({
                brainKey: activeBrainKey,
                idempotencyKey,
              }),
            );
            if (result.status === "ready") {
              setRequestedExport(result.data);
              setExportRequest({ status: "idle" });
            } else if (isTemplateFailureState(result)) {
              setExportRequest({
                status: "error",
                message: describeTypedFailure(
                  result.error,
                  "Unable to request export. Try again.",
                ),
              });
            } else {
              setExportRequest({
                status: "error",
                message: "Unable to request export. Try again.",
              });
            }
          } catch (error) {
            const failure = normalizeMutationError(error);
            setExportRequest({ status: "error", message: failure.message });
          }
        }}
      />
    </>
  );
}

const brainExportView = (
  request:
    | { readonly status: "idle" | "loading" }
    | { readonly status: "error"; readonly message: string },
  requested: BrainExportJob | null,
  status: ReturnType<typeof useTemplateQuery<typeof exportRefs.getBrainExport>>,
  download: ReturnType<
    typeof useTemplateQuery<typeof exportRefs.downloadBrainExport>
  >,
): BrainExportViewState => {
  if (request.status === "error")
    return { status: "unavailable", message: request.message };
  if (requested === null)
    return request.status === "loading"
      ? { status: "loading" }
      : { status: "empty" };
  if (status.status === "loading" || status.status === "skipped")
    return { status: "ready", job: requested };
  if (status.status === "ready") {
    const { downloadUrl: _ignored, ...job } = status.data;
    return {
      status: "ready",
      job: {
        ...job,
        ...(download.status === "ready" && download.data.downloadUrl
          ? { downloadUrl: download.data.downloadUrl }
          : {}),
      },
    };
  }
  if (status.status === "empty") return { status: "ready", job: requested };
  return {
    status: "unavailable",
    message:
      status.status === "typed_failure"
        ? describeTypedFailure(status.error, "Unable to load export status.")
        : status.message,
  };
};

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
