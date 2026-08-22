import { templateConfectRefs } from "@maestro-template/convex/refs";
import { useReducer } from "react";
import { Page, Text } from "@saas-ui/react";

import {
  useTemplateMutation,
  useTemplateQuery,
  classifyConfectMutationResult,
  isTemplateFailureState,
  normalizeMutationError,
  type TemplateMutationState,
} from "../../adapters/confect-state";
import { describeTypedFailure } from "../../adapters/failure-message";
import { createApiKeySettingsAdapter } from "./api-keys-adapter";
import { ApiKeysPanel } from "./api-keys-panel";
import { useWorkspace } from "../../providers/workspace";
import { selectStableApiKeyBrainKey } from "./settings-surface";
import { BrainExports } from "./brain-exports";
import type { BrainExportJob, BrainExportViewState } from "./export-history";
import { isConvexConfigured } from "../../env";

const apiKeyRefs = templateConfectRefs.public.headless.apiKeys;
const exportRefs = templateConfectRefs.public.ops.dataLifecycle;
type ExportRequestState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "error"; readonly message: string };

export function WorkspaceSettingsClient() {
  const workspace = useWorkspace();
  const [requestedExport, setRequestedExport] = useReducer(
    (_: BrainExportJob | null, next: BrainExportJob | null) => next,
    null,
  );
  const [exportRequest, setExportRequest] = useReducer(
    (_: ExportRequestState, next: ExportRequestState) => next,
    { status: "idle" } as const,
  );
  const createApiKey = useTemplateMutation(apiKeyRefs.create);
  const rotateApiKey = useTemplateMutation(apiKeyRefs.rotate);
  const revokeApiKey = useTemplateMutation(apiKeyRefs.revoke);
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
      ? { brainKey: exportStatus.data.brainKey, jobId: exportStatus.data.jobId }
      : "skip",
  );
  const requestBrainExport = useTemplateMutation(exportRefs.requestBrainExport);

  if (workspace.status !== "ready") {
    return (
      <Page.Root>
        <Page.Header
          title="Settings"
          description="Workspace access, integrations, and Brain data controls."
        />
        <Page.Body>
          <Text role="status">Loading workspace settings.</Text>
        </Page.Body>
      </Page.Root>
    );
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
  return (
    <Page.Root>
      <Page.Header
        title="Settings"
        description="Workspace access, integrations, and Brain data controls."
      />
      <Page.Body>
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
          onRequest={(idempotencyKey) =>
            requestExport({
              activeBrainKey,
              idempotencyKey,
              requestBrainExport,
              setExportRequest,
              setRequestedExport,
            })
          }
        />
      </Page.Body>
    </Page.Root>
  );
}

const brainExportView = (
  request: ExportRequestState,
  requested: BrainExportJob | null,
  status: ReturnType<typeof useTemplateQuery<typeof exportRefs.getBrainExport>>,
  download: ReturnType<
    typeof useTemplateQuery<typeof exportRefs.downloadBrainExport>
  >,
): BrainExportViewState => {
  if (request.status === "error")
    return { status: "unavailable", message: request.message };
  if (requested === null) return initialBrainExportView(request);
  return requestedBrainExportView(requested, status, download);
};

const initialBrainExportView = (
  request: Exclude<ExportRequestState, { readonly status: "error" }>,
): BrainExportViewState =>
  request.status === "loading" ? { status: "loading" } : { status: "empty" };

const requestedBrainExportView = (
  requested: BrainExportJob,
  status: ReturnType<typeof useTemplateQuery<typeof exportRefs.getBrainExport>>,
  download: ReturnType<
    typeof useTemplateQuery<typeof exportRefs.downloadBrainExport>
  >,
): BrainExportViewState => {
  if (status.status === "ready") {
    return {
      status: "ready",
      job: downloadableExportJob(status.data, download),
    };
  }
  if (
    status.status === "loading" ||
    status.status === "skipped" ||
    status.status === "empty"
  )
    return { status: "ready", job: requested };
  return {
    status: "unavailable",
    message:
      status.status === "typed_failure"
        ? describeTypedFailure(status.error, "Unable to load export status.")
        : status.message,
  };
};

const downloadableExportJob = (
  exportJob: BrainExportJob & { readonly downloadUrl?: string },
  download: ReturnType<
    typeof useTemplateQuery<typeof exportRefs.downloadBrainExport>
  >,
): BrainExportJob => {
  const job = { ...exportJob };
  delete job.downloadUrl;
  return {
    ...job,
    ...(download.status === "ready" && download.data.downloadUrl
      ? { downloadUrl: download.data.downloadUrl }
      : {}),
  };
};

const requestExport = async ({
  activeBrainKey,
  idempotencyKey,
  requestBrainExport,
  setExportRequest,
  setRequestedExport,
}: {
  readonly activeBrainKey: string;
  readonly idempotencyKey: string;
  readonly requestBrainExport: ReturnType<
    typeof useTemplateMutation<typeof exportRefs.requestBrainExport>
  >;
  readonly setExportRequest: (state: ExportRequestState) => void;
  readonly setRequestedExport: (job: BrainExportJob | null) => void;
}) => {
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
      return;
    }
    setExportRequest(exportRequestFailure(result));
  } catch (error) {
    const failure = normalizeMutationError(error);
    setExportRequest({ status: "error", message: failure.message });
  }
};

const exportRequestFailure = (
  result: TemplateMutationState<BrainExportJob, unknown>,
): Extract<ExportRequestState, { readonly status: "error" }> => ({
  status: "error",
  message: isTemplateFailureState(result)
    ? describeTypedFailure(result.error, "Unable to request export. Try again.")
    : "Unable to request export. Try again.",
});

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
