import { GenericId } from "@confect/core";

export type TableNames = "accessAuditEvents" | "actionApprovals" | "actionDigests" | "actionJobs" | "actionTriggers" | "apiKeys" | "billingPlans" | "brainPages" | "citations" | "claims" | "concepts" | "contextPacks" | "creditLedger" | "deployActionConsumptions" | "deployApprovals" | "deployAuthorityAuditEvents" | "deployAuthorityIssuers" | "deployCensusSnapshots" | "deployVerdicts" | "documentAnnotations" | "documentVersions" | "documents" | "dsarRequests" | "emailCampaigns" | "emailDeliveries" | "emailEvents" | "emailSubscribers" | "emailSuppressions" | "entitlements" | "featureFlagPolicies" | "invitations" | "notificationPreferences" | "notificationRecords" | "organizationMembers" | "organizations" | "pageRevisions" | "policies" | "promptRegistry" | "providerConnections" | "records" | "transformBlocks" | "transformDefinitions" | "transformRuns" | "usageEvents" | "users" | "versionFreshness" | "versionedEntries" | "webhookEvents" | "workflowArtifacts" | "workflowEffectReservations" | "workflowEventInstances" | "workflowRunContextManifests" | "workflowRunEvents" | "workflowRunEvidenceSnapshots" | "workflowRunLinks" | "workflowRuns" | "workflowStageRuns" | "workspaceMembers" | "workspaces";

export const Id = <const TableName extends TableNames>(
  tableName: TableName,
) => GenericId.GenericId(tableName);
