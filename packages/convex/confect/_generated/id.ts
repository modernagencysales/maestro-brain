import { GenericId } from "@confect/core";

export type TableNames = "actionApprovals" | "actionDigests" | "actionJobs" | "actionTriggers" | "apiKeys" | "billingPlans" | "brainPages" | "citations" | "claims" | "concepts" | "contextPacks" | "creditLedger" | "documentAnnotations" | "documentVersions" | "documents" | "entitlements" | "invitations" | "organizationMembers" | "organizations" | "policies" | "promptRegistry" | "transformBlocks" | "transformDefinitions" | "transformRuns" | "usageEvents" | "users" | "versionFreshness" | "versionedEntries" | "webhookEvents" | "workflowRunContextManifests" | "workflowRunEvents" | "workflowRunEvidenceSnapshots" | "workflowRuns" | "workflowStageRuns" | "workspaceMembers" | "workspaces";

export const Id = <const TableName extends TableNames>(
  tableName: TableName,
) => GenericId.GenericId(tableName);
