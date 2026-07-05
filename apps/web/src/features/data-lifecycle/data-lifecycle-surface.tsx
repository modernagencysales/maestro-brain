import { useMemo, useState } from "react";
import type { Ref } from "@confect/core";
import {
  templateConfectRefs,
  type TemplateConfectRefs,
} from "@maestro-template/convex/refs";
import { useTemplateToast } from "@maestro-template/ui";
import * as Either from "effect/Either";
import {
  classifyConfectMutationResult,
  normalizeMutationError,
  notifyTemplateMutation,
  type TemplateDataState,
  useTemplateMutation,
  useTemplateQuery,
} from "../../adapters/confect-state";
import { isConvexConfigured } from "../../env";
import { useWorkspace } from "../../providers/workspace";

type ListDsarRequestsRef =
  TemplateConfectRefs["public"]["ops"]["dataLifecycle"]["listDsarRequests"];
type CreateDsarRequestRef =
  TemplateConfectRefs["public"]["ops"]["dataLifecycle"]["createDsarRequest"];
type DsarRequestListData = Ref.Returns<ListDsarRequestsRef>;
type DsarRequestListError = Ref.Error<ListDsarRequestsRef>;
type DsarRequestData = DsarRequestListData["requests"][number];
type WorkspaceId = Ref.Args<ListDsarRequestsRef>["workspaceId"];
type DsarRequestKind = Ref.Args<CreateDsarRequestRef>["kind"];

type DataLifecycleRequest = {
  readonly id: string;
  readonly kind: DsarRequestKind;
  readonly status: DsarRequestData["status"];
  readonly subject: string;
  readonly plannedAt: string;
  readonly exportResources: number;
  readonly deleteResources: number;
  readonly dryRunOnly: true;
};

type DataLifecycleSummary = {
  readonly total: number;
  readonly exportRequests: number;
  readonly deleteRequests: number;
  readonly blockedByLegalHold: number;
};

type DataLifecycleViewModel = {
  readonly requests: readonly DataLifecycleRequest[];
  readonly summary: DataLifecycleSummary;
  readonly live: boolean;
  readonly status:
    | "unconfigured"
    | "waiting_for_workspace"
    | "loading"
    | "ready"
    | "empty"
    | "unavailable";
  readonly detail?: string;
};

const fakeRequests: readonly DsarRequestData[] = [
  {
    workspaceId: "workspace_template" as DsarRequestData["workspaceId"],
    requestId: "dsar_template_export",
    requestedByUserId:
      "user_template_admin" as DsarRequestData["requestedByUserId"],
    subjectId: "customer_template",
    kind: "export",
    status: "ready-for-review",
    dryRunOnly: true,
    plannedAt: 1_783_200_000_000,
    confirmation: {
      required: true,
      phrase: "CONFIRM DSAR EXPORT",
      reason: "Operator review is required before fulfillment.",
    },
    exportManifest: [
      {
        resourceId: "brainPages",
        exportMode: "markdown",
        detail: "Brain pages export as markdown.",
      },
      {
        resourceId: "notificationRecords",
        exportMode: "redacted-json",
        detail: "Notification records export without provider payloads.",
      },
    ],
    deletePlan: [
      {
        resourceId: "brainPages",
        deleteMode: "redact",
        executable: false,
        reason: "Dry-run only.",
      },
    ],
  },
  {
    workspaceId: "workspace_template" as DsarRequestData["workspaceId"],
    requestId: "dsar_template_delete_hold",
    requestedByUserId:
      "user_template_admin" as DsarRequestData["requestedByUserId"],
    subjectId: "customer_legal_hold",
    kind: "delete",
    status: "blocked-by-legal-hold",
    dryRunOnly: true,
    plannedAt: 1_783_203_600_000,
    legalHold: {
      enabled: true,
      reason: "Legal hold blocks destructive fulfillment.",
    },
    confirmation: {
      required: true,
      phrase: "CONFIRM DSAR DELETE",
      reason: "Exact confirmation and legal review are required.",
    },
    exportManifest: [
      {
        resourceId: "dsarRequests",
        exportMode: "json",
        detail: "DSAR audit rows remain exportable.",
      },
    ],
    deletePlan: [
      {
        resourceId: "dsarRequests",
        deleteMode: "retain-audit",
        executable: false,
        reason: "Audit anchor retained.",
      },
      {
        resourceId: "documents",
        deleteMode: "redact",
        executable: false,
        reason: "Blocked while legal hold is active.",
      },
    ],
  },
];

const toRequestView = (request: DsarRequestData): DataLifecycleRequest => ({
  id: request.requestId,
  kind: request.kind,
  status: request.status,
  subject: request.subjectId ?? "workspace",
  plannedAt: new Date(request.plannedAt).toISOString(),
  exportResources: request.exportManifest.length,
  deleteResources: request.deletePlan.length,
  dryRunOnly: true,
});

const summarizeRequests = (
  requests: readonly DataLifecycleRequest[],
): DataLifecycleSummary => ({
  total: requests.length,
  exportRequests: requests.filter((request) => request.kind === "export")
    .length,
  deleteRequests: requests.filter((request) => request.kind === "delete")
    .length,
  blockedByLegalHold: requests.filter(
    (request) => request.status === "blocked-by-legal-hold",
  ).length,
});

export const fakeDataLifecycleView = (): DataLifecycleViewModel => {
  const requests = fakeRequests.map(toRequestView);

  return {
    requests,
    summary: summarizeRequests(requests),
    live: false,
    status: "unconfigured",
  };
};

export const presentDataLifecycleRequests = (
  state: TemplateDataState<DsarRequestListData, DsarRequestListError>,
): DataLifecycleViewModel => {
  if (state.status === "skipped") return fakeDataLifecycleView();

  if (state.status === "loading") {
    return {
      ...fakeDataLifecycleView(),
      status: "loading",
    };
  }

  if (state.status === "empty") {
    return {
      requests: [],
      summary: summarizeRequests([]),
      live: true,
      status: "empty",
    };
  }

  if (state.status === "ready") {
    const requests = state.data.requests.map(toRequestView);

    return {
      requests,
      summary: summarizeRequests(requests),
      live: true,
      status: "ready",
    };
  }

  return {
    ...fakeDataLifecycleView(),
    status: "unavailable",
    detail:
      state.status === "typed_failure"
        ? dataLifecycleFailureMessage(state.error)
        : state.message,
  };
};

export function DataLifecycleSurface() {
  const workspace = useWorkspace();
  const toast = useTemplateToast();
  const [fakeRequestRows, setFakeRequestRows] =
    useState<readonly DsarRequestData[]>(fakeRequests);
  const workspaceId =
    workspace.status === "ready"
      ? (workspace.activeWorkspaceId as WorkspaceId)
      : null;
  const liveQueryEnabled = isConvexConfigured() && workspaceId !== null;
  const createDsarRequest = useTemplateMutation(
    templateConfectRefs.public.ops.dataLifecycle.createDsarRequest,
  );
  const liveState = useTemplateQuery(
    templateConfectRefs.public.ops.dataLifecycle.listDsarRequests,
    liveQueryEnabled && workspaceId !== null ? { workspaceId } : "skip",
    {
      isEmpty: (data) => data.requests.length === 0,
    },
  );
  const fakeView = useMemo(() => {
    const requests = fakeRequestRows.map(toRequestView);

    return {
      requests,
      summary: summarizeRequests(requests),
      live: false,
      status:
        workspace.status === "ready" ? "unconfigured" : "waiting_for_workspace",
    } satisfies DataLifecycleViewModel;
  }, [fakeRequestRows, workspace.status]);
  const view = liveQueryEnabled
    ? presentDataLifecycleRequests(liveState)
    : fakeView;

  const requestDryRun = (kind: DsarRequestKind) => {
    const requestId = `dsar_${kind}_${Date.now()}`;
    if (view.live && workspaceId !== null) {
      void createDsarRequest({
        workspaceId,
        requestId,
        kind,
        subjectId: "customer-template",
        confirmationPhrase:
          kind === "delete" ? "CONFIRM DSAR DELETE" : "CONFIRM DSAR EXPORT",
      })
        .then((result) => {
          const state = classifyConfectMutationResult(result);
          notifyTemplateMutation({
            copy: dataLifecycleCreateToastCopy,
            state,
            toast,
          });
        })
        .catch((error: unknown) => {
          notifyTemplateMutation({
            copy: dataLifecycleCreateToastCopy,
            state: normalizeMutationError(error),
            toast,
          });
        });
      return;
    }

    const plannedAt = Date.now();
    setFakeRequestRows((current) => [
      {
        workspaceId: "workspace_template" as DsarRequestData["workspaceId"],
        requestId,
        requestedByUserId:
          "user_template_admin" as DsarRequestData["requestedByUserId"],
        subjectId: "customer-template",
        kind,
        status: kind === "delete" ? "needs-confirmation" : "ready-for-review",
        dryRunOnly: true,
        plannedAt,
        confirmationPhrase:
          kind === "delete" ? "CONFIRM DSAR DELETE" : "CONFIRM DSAR EXPORT",
        confirmation: {
          required: true,
          phrase:
            kind === "delete" ? "CONFIRM DSAR DELETE" : "CONFIRM DSAR EXPORT",
          reason: "Dry-run planning requires human review before fulfillment.",
        },
        exportManifest: fakeRequests[0]?.exportManifest ?? [],
        deletePlan: fakeRequests[0]?.deletePlan ?? [],
      },
      ...current,
    ]);
    toast.notify({
      title: "DSAR dry-run planned",
      description: "The fake-safe request was added to the local audit view.",
      tone: "success",
      announcement: "DSAR dry-run planned.",
    });
  };

  return (
    <section className="template-data-lifecycle" aria-label="DSAR requests">
      {view.status === "loading" ? (
        <p className="template-platform-empty">
          Loading data lifecycle requests...
        </p>
      ) : null}
      {view.status === "waiting_for_workspace" ? (
        <p className="template-platform-empty">
          Preparing workspace data lifecycle posture...
        </p>
      ) : null}
      {view.status === "unavailable" && view.detail ? (
        <p className="template-platform-empty">
          Data lifecycle backend unavailable: {view.detail}
        </p>
      ) : null}
      <header className="template-data-lifecycle-header">
        <div>
          <h2>DSAR request plans</h2>
          <p>
            Dry-run export and delete plans stay auditable before a client fork
            enables destructive fulfillment.
          </p>
        </div>
        <div className="template-data-lifecycle-actions">
          <button onClick={() => requestDryRun("export")} type="button">
            Plan export
          </button>
          <button onClick={() => requestDryRun("delete")} type="button">
            Plan delete
          </button>
        </div>
      </header>
      <dl className="template-data-lifecycle-summary">
        <div>
          <dt>Total</dt>
          <dd>{view.summary.total}</dd>
        </div>
        <div>
          <dt>Exports</dt>
          <dd>{view.summary.exportRequests}</dd>
        </div>
        <div>
          <dt>Deletes</dt>
          <dd>{view.summary.deleteRequests}</dd>
        </div>
        <div>
          <dt>Legal holds</dt>
          <dd>{view.summary.blockedByLegalHold}</dd>
        </div>
      </dl>
      {view.requests.length === 0 ? (
        <p className="template-platform-empty">
          No DSAR request plans have been recorded yet.
        </p>
      ) : (
        <div className="template-data-lifecycle-list">
          {view.requests.map((request) => (
            <article className="template-data-lifecycle-row" key={request.id}>
              <header>
                <div>
                  <h3>{request.id}</h3>
                  <p>{request.subject}</p>
                </div>
                <span>{request.kind}</span>
              </header>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{request.status}</dd>
                </div>
                <div>
                  <dt>Export resources</dt>
                  <dd>{request.exportResources}</dd>
                </div>
                <div>
                  <dt>Delete resources</dt>
                  <dd>{request.deleteResources}</dd>
                </div>
                <div>
                  <dt>Planned</dt>
                  <dd>{request.plannedAt}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const dataLifecycleCreateToastCopy = {
  successTitle: "DSAR dry-run planned",
  successDescription: (request: DsarRequestData) =>
    `${request.kind} request ${request.requestId} is ready for review.`,
  failureTitle: "DSAR planning failed",
  failureDescription: (failure: {
    readonly status: string;
    readonly error?: unknown;
    readonly message?: string;
  }) =>
    failure.status === "typed_failure"
      ? dataLifecycleFailureMessage(failure.error)
      : (failure.message ?? "DSAR planning failed."),
};

function dataLifecycleFailureMessage(error: unknown): string {
  if (Either.isEither(error)) {
    return Either.isLeft(error)
      ? dataLifecycleFailureMessage(error.left)
      : "DSAR planning failed.";
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string") return message;
  }

  if (typeof error === "object" && error !== null && "_tag" in error) {
    const tag = error._tag;
    if (typeof tag === "string") return tag;
  }

  return "DSAR planning failed.";
}
