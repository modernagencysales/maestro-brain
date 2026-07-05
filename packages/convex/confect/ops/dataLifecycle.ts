import * as Schema from "effect/Schema";

export const currentLifecycleResourceIds = [
  "workspaces",
  "workspaceMembers",
  "brainPages",
  "workflowRuns",
  "workflowStageRuns",
  "workflowRunEvents",
  "workflowRunEvidenceSnapshots",
  "workflowRunContextManifests",
  "usageEvents",
  "creditLedger",
  "entitlements",
  "webhookEvents",
  "dsarRequests",
  "featureFlagPolicies",
  "notificationRecords",
  "notificationPreferences",
  "apiKeys",
  "invitations",
  "documents",
  "documentVersions",
  "documentAnnotations",
  "concepts",
  "claims",
  "citations",
  "contextPacks",
  "transformDefinitions",
  "transformRuns",
  "transformBlocks",
  "actionJobs",
  "actionApprovals",
  "actionTriggers",
  "actionDigests",
  "versionedEntries",
  "versionFreshness",
] as const;

export type LifecycleResourceId = (typeof currentLifecycleResourceIds)[number];

export const LifecycleResourceIdSchema = Schema.Literal(
  ...currentLifecycleResourceIds,
);

export type LifecycleResourcePlan = {
  readonly id: LifecycleResourceId;
  readonly owner: "workspace";
  readonly exportMode: "markdown" | "json" | "redacted-json";
  readonly deleteMode: "delete" | "redact" | "retain-audit";
  readonly detail: string;
};

export type RetentionRule = {
  readonly resourceId: LifecycleResourceId;
  readonly action:
    | "retain-until-workspace-delete"
    | "retain-audit-window"
    | "hash-or-redact-on-export";
  readonly detail: string;
};

export type WorkspaceDataLifecyclePlan = {
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly plannedAt: number;
  readonly export: {
    readonly resources: readonly LifecycleResourcePlan[];
  };
  readonly delete: {
    readonly confirmation: {
      readonly required: true;
      readonly phrase: string;
      readonly reason: string;
    };
    readonly resources: readonly LifecycleResourcePlan[];
  };
  readonly retention: {
    readonly rules: readonly RetentionRule[];
  };
};

export type DsarRequestKind = "export" | "delete";

export const DsarRequestKindSchema = Schema.Literal("export", "delete");

export type DsarRequestStatus =
  "ready-for-review" | "needs-confirmation" | "blocked-by-legal-hold";

export const DsarRequestStatusSchema = Schema.Literal(
  "ready-for-review",
  "needs-confirmation",
  "blocked-by-legal-hold",
);

export type LegalHold = {
  readonly enabled: boolean;
  readonly reason: string;
  readonly expiresAt?: number | undefined;
};

export const LegalHoldSchema = Schema.Struct({
  enabled: Schema.Boolean,
  reason: Schema.String,
  expiresAt: Schema.optional(Schema.Number),
});

export type DsarExportManifestEntry = {
  readonly resourceId: LifecycleResourceId;
  readonly exportMode: LifecycleResourcePlan["exportMode"];
  readonly detail: string;
};

export const DsarExportManifestEntrySchema = Schema.Struct({
  resourceId: LifecycleResourceIdSchema,
  exportMode: Schema.Literal("markdown", "json", "redacted-json"),
  detail: Schema.String,
});

export type DsarDeletePlanEntry = {
  readonly resourceId: LifecycleResourceId;
  readonly deleteMode: LifecycleResourcePlan["deleteMode"];
  readonly executable: false;
  readonly reason: string;
};

export const DsarDeletePlanEntrySchema = Schema.Struct({
  resourceId: LifecycleResourceIdSchema,
  deleteMode: Schema.Literal("delete", "redact", "retain-audit"),
  executable: Schema.Literal(false),
  reason: Schema.String,
});

export type WorkspaceDsarPlan = {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly subjectId?: string;
  readonly kind: DsarRequestKind;
  readonly plannedAt: number;
  readonly status: DsarRequestStatus;
  readonly dryRunOnly: true;
  readonly legalHold?: LegalHold;
  readonly confirmation: WorkspaceDataLifecyclePlan["delete"]["confirmation"];
  readonly exportManifest: readonly DsarExportManifestEntry[];
  readonly deletePlan: readonly DsarDeletePlanEntry[];
};

export type RetentionJobPlan = {
  readonly workspaceId: string;
  readonly plannedAt: number;
  readonly dryRunOnly: true;
  readonly auditWindowDays: number;
  readonly legalHold?: LegalHold;
  readonly nextReviewAt: number;
  readonly actions: readonly {
    readonly resourceId: LifecycleResourceId;
    readonly action: RetentionRule["action"];
    readonly executable: false;
    readonly reason: string;
  }[];
};

const resourcePlans: readonly LifecycleResourcePlan[] = [
  {
    id: "workspaces",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail:
      "Workspace shell metadata is exported and retained as audit anchor.",
  },
  {
    id: "workspaceMembers",
    owner: "workspace",
    exportMode: "redacted-json",
    deleteMode: "redact",
    detail:
      "Membership identities are redacted on export and deactivated on delete.",
  },
  {
    id: "brainPages",
    owner: "workspace",
    exportMode: "markdown",
    deleteMode: "delete",
    detail:
      "Source-backed Brain pages export as markdown and delete with workspace content.",
  },
  {
    id: "workflowRuns",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail: "Workflow run envelopes stay as audit records.",
  },
  {
    id: "workflowStageRuns",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail: "Stage run state stays linked to retained workflow audit records.",
  },
  {
    id: "workflowRunEvents",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail: "Workflow event trails remain as audit evidence.",
  },
  {
    id: "workflowRunEvidenceSnapshots",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail: "Evidence snapshot hashes remain available for Trust Receipts.",
  },
  {
    id: "workflowRunContextManifests",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail: "Context manifests retain provenance without raw provider secrets.",
  },
  {
    id: "usageEvents",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail: "Usage events remain for billing and compliance reconciliation.",
  },
  {
    id: "creditLedger",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail: "Credit ledger entries remain append-only financial records.",
  },
  {
    id: "entitlements",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail:
      "Entitlement limits, usage, and source state export as monetization policy records.",
  },
  {
    id: "webhookEvents",
    owner: "workspace",
    exportMode: "redacted-json",
    deleteMode: "retain-audit",
    detail:
      "Payment webhook events retain provider/event/timestamp dedupe keys without raw payloads.",
  },
  {
    id: "dsarRequests",
    owner: "workspace",
    exportMode: "redacted-json",
    deleteMode: "retain-audit",
    detail:
      "DSAR request audit rows export plan metadata and retain fulfillment review posture.",
  },
  {
    id: "featureFlagPolicies",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "delete",
    detail:
      "Workspace rollout and kill-switch policy exports as tenant configuration.",
  },
  {
    id: "notificationRecords",
    owner: "workspace",
    exportMode: "redacted-json",
    deleteMode: "retain-audit",
    detail:
      "In-app notification records export with redacted recipient/action metadata and retain delivery audit state.",
  },
  {
    id: "notificationPreferences",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "delete",
    detail:
      "Notification channel preferences export as workspace-member configuration and delete with the workspace.",
  },
  {
    id: "apiKeys",
    owner: "workspace",
    exportMode: "redacted-json",
    deleteMode: "redact",
    detail: "API keys export only metadata and revoke/hash secrets on delete.",
  },
  {
    id: "invitations",
    owner: "workspace",
    exportMode: "redacted-json",
    deleteMode: "redact",
    detail: "Invitation emails and tokens are redacted.",
  },
  {
    id: "documents",
    owner: "workspace",
    exportMode: "markdown",
    deleteMode: "delete",
    detail:
      "Co-editing documents export as markdown with metadata and delete with workspace content.",
  },
  {
    id: "documentVersions",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail:
      "Append-only document versions retain provenance for review and compliance windows.",
  },
  {
    id: "documentAnnotations",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "delete",
    detail:
      "Human and agent annotations export as collaboration records and delete with the document.",
  },
  {
    id: "concepts",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "delete",
    detail:
      "Knowledge concepts are structured Brain overlays and delete with workspace content.",
  },
  {
    id: "claims",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "delete",
    detail:
      "Claims export with citation status and delete with workspace content.",
  },
  {
    id: "citations",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "delete",
    detail:
      "Citations export source references and quoted ranges; source content remains governed by the source resource.",
  },
  {
    id: "contextPacks",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "delete",
    detail:
      "Context packs export source IDs, citation IDs, freshness, and Trust Receipt links.",
  },
  {
    id: "transformDefinitions",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "delete",
    detail:
      "Transform definitions export schema refs, policy kind, and evidence requirements.",
  },
  {
    id: "transformRuns",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail:
      "Transform runs retain input/output hashes, policy snapshots, model receipts, and source provenance.",
  },
  {
    id: "transformBlocks",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail:
      "Transform blocks retain traced block-level evidence for Trust Receipt projection.",
  },
  {
    id: "actionJobs",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail:
      "Action jobs retain audited external-side-effect intent, payload hashes, and approval posture.",
  },
  {
    id: "actionApprovals",
    owner: "workspace",
    exportMode: "redacted-json",
    deleteMode: "retain-audit",
    detail:
      "Approval records export token hashes only and retain reviewer/audit status.",
  },
  {
    id: "actionTriggers",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "delete",
    detail:
      "Refresh and publish trigger config exports as workspace-owned automation settings.",
  },
  {
    id: "actionDigests",
    owner: "workspace",
    exportMode: "redacted-json",
    deleteMode: "retain-audit",
    detail:
      "Digest records export redacted customer/provider metadata and retain delivery audit state.",
  },
  {
    id: "versionedEntries",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "retain-audit",
    detail:
      "Generic append-only version history exports as JSON and is retained for provenance.",
  },
  {
    id: "versionFreshness",
    owner: "workspace",
    exportMode: "json",
    deleteMode: "delete",
    detail:
      "Mutable freshness markers export as JSON and delete with the workspace entity.",
  },
];

const retentionRules: readonly RetentionRule[] = [
  {
    resourceId: "brainPages",
    action: "retain-until-workspace-delete",
    detail: "Brain pages are customer content and follow workspace lifecycle.",
  },
  {
    resourceId: "documents",
    action: "retain-until-workspace-delete",
    detail: "Co-editing documents are customer content.",
  },
  {
    resourceId: "documentVersions",
    action: "retain-audit-window",
    detail: "Append-only versions may be retained for audit provenance.",
  },
  {
    resourceId: "documentAnnotations",
    action: "retain-until-workspace-delete",
    detail: "Annotations follow the target document lifecycle.",
  },
  {
    resourceId: "concepts",
    action: "retain-until-workspace-delete",
    detail: "Concept overlays follow workspace Brain content lifecycle.",
  },
  {
    resourceId: "claims",
    action: "retain-until-workspace-delete",
    detail: "Claims follow workspace Brain content lifecycle.",
  },
  {
    resourceId: "citations",
    action: "retain-until-workspace-delete",
    detail: "Citations follow the cited claim and source lifecycle.",
  },
  {
    resourceId: "contextPacks",
    action: "retain-until-workspace-delete",
    detail: "Context packs are regenerated from source-backed knowledge.",
  },
  {
    resourceId: "transformDefinitions",
    action: "retain-until-workspace-delete",
    detail: "Transform definitions are workspace-owned configuration.",
  },
  {
    resourceId: "transformRuns",
    action: "retain-audit-window",
    detail:
      "Transform runs are retained for workflow replay, audits, and Trust Receipts.",
  },
  {
    resourceId: "transformBlocks",
    action: "retain-audit-window",
    detail:
      "Transform block traces are retained as source-backed output evidence.",
  },
  {
    resourceId: "actionJobs",
    action: "retain-audit-window",
    detail:
      "Published action intent and payload hashes are retained for approval and external-write audits.",
  },
  {
    resourceId: "actionApprovals",
    action: "hash-or-redact-on-export",
    detail:
      "Approval review links export only hashes and never raw token material.",
  },
  {
    resourceId: "actionDigests",
    action: "hash-or-redact-on-export",
    detail:
      "Digest customer and provider metadata is redacted at notification and export boundaries.",
  },
  {
    resourceId: "versionedEntries",
    action: "retain-audit-window",
    detail:
      "Historical version rows are append-only provenance and must not be mutated.",
  },
  {
    resourceId: "versionFreshness",
    action: "retain-until-workspace-delete",
    detail:
      "Freshness state is mutable operational metadata separate from immutable history.",
  },
  {
    resourceId: "apiKeys",
    action: "hash-or-redact-on-export",
    detail: "API key secret material is never exported.",
  },
  {
    resourceId: "entitlements",
    action: "retain-audit-window",
    detail:
      "Entitlements are retained for billing, seat, and support reconciliation.",
  },
  {
    resourceId: "webhookEvents",
    action: "hash-or-redact-on-export",
    detail:
      "Webhook payloads are redacted; provider, event ID, and signature timestamp form the dedupe key.",
  },
  {
    resourceId: "dsarRequests",
    action: "retain-audit-window",
    detail:
      "DSAR request records are retained as compliance review and fulfillment audit anchors.",
  },
  {
    resourceId: "featureFlagPolicies",
    action: "retain-until-workspace-delete",
    detail:
      "Workspace rollout policies are tenant configuration and follow workspace lifecycle.",
  },
  {
    resourceId: "notificationRecords",
    action: "hash-or-redact-on-export",
    detail:
      "Notification exports redact recipient/action metadata while retaining delivery audit state.",
  },
  {
    resourceId: "notificationPreferences",
    action: "retain-until-workspace-delete",
    detail:
      "Notification channel preferences are workspace-member settings and follow workspace lifecycle.",
  },
  {
    resourceId: "workflowRuns",
    action: "retain-audit-window",
    detail: "Workflow run audit records remain available for Trust Receipts.",
  },
  {
    resourceId: "creditLedger",
    action: "retain-audit-window",
    detail: "Financial ledger entries are retained for reconciliation.",
  },
];

export const buildWorkspaceDataLifecyclePlan = (input: {
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly now: number;
}): WorkspaceDataLifecyclePlan => ({
  workspaceId: input.workspaceId,
  requestedBy: input.requestedBy,
  plannedAt: input.now,
  export: {
    resources: resourcePlans,
  },
  delete: {
    confirmation: {
      required: true,
      phrase: `delete ${input.workspaceId}`,
      reason: "workspace data deletion is destructive and audited",
    },
    resources: resourcePlans,
  },
  retention: {
    rules: retentionRules,
  },
});

const deleteReasonFor = ({
  confirmed,
  legalHold,
  resource,
}: {
  readonly confirmed: boolean;
  readonly legalHold?: LegalHold;
  readonly resource: LifecycleResourcePlan;
}): string => {
  if (legalHold?.enabled) {
    return `Blocked by legal hold: ${legalHold.reason}`;
  }

  if (!confirmed) {
    return "Awaiting exact workspace delete confirmation.";
  }

  return `Plan-only ${resource.deleteMode} action; forks must wire audited mutations before execution.`;
};

export const buildWorkspaceDsarPlan = (input: {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly subjectId?: string;
  readonly kind: DsarRequestKind;
  readonly now: number;
  readonly confirmationPhrase?: string;
  readonly legalHold?: LegalHold;
}): WorkspaceDsarPlan => {
  const lifecycle = buildWorkspaceDataLifecyclePlan({
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
    now: input.now,
  });
  const confirmed =
    input.confirmationPhrase === lifecycle.delete.confirmation.phrase;
  const status: DsarRequestStatus = input.legalHold?.enabled
    ? "blocked-by-legal-hold"
    : input.kind === "delete" && !confirmed
      ? "needs-confirmation"
      : "ready-for-review";
  const exportManifest = lifecycle.export.resources.map((resource) => ({
    resourceId: resource.id,
    exportMode: resource.exportMode,
    detail: resource.detail,
  }));
  const deletePlan = lifecycle.delete.resources.map((resource) => ({
    resourceId: resource.id,
    deleteMode: resource.deleteMode,
    executable: false as const,
    reason: deleteReasonFor({
      confirmed,
      ...(input.legalHold === undefined ? {} : { legalHold: input.legalHold }),
      resource,
    }),
  }));

  return {
    requestId: input.requestId,
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
    ...(input.subjectId === undefined ? {} : { subjectId: input.subjectId }),
    kind: input.kind,
    plannedAt: input.now,
    status,
    dryRunOnly: true,
    ...(input.legalHold === undefined ? {} : { legalHold: input.legalHold }),
    confirmation: lifecycle.delete.confirmation,
    exportManifest,
    deletePlan,
  };
};

export const buildRetentionJobPlan = (input: {
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly now: number;
  readonly auditWindowDays: number;
  readonly legalHold?: LegalHold;
}): RetentionJobPlan => {
  const lifecycle = buildWorkspaceDataLifecyclePlan({
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
    now: input.now,
  });
  const dayMs = 24 * 60 * 60 * 1_000;

  return {
    workspaceId: input.workspaceId,
    plannedAt: input.now,
    dryRunOnly: true,
    auditWindowDays: input.auditWindowDays,
    ...(input.legalHold === undefined ? {} : { legalHold: input.legalHold }),
    nextReviewAt: input.now + dayMs,
    actions: lifecycle.retention.rules.map((rule) => ({
      resourceId: rule.resourceId,
      action: rule.action,
      executable: false as const,
      reason: input.legalHold?.enabled
        ? `Blocked by legal hold: ${input.legalHold.reason}`
        : `${rule.detail} Retention job is plan-only until a fork wires audited cron execution.`,
    })),
  };
};
