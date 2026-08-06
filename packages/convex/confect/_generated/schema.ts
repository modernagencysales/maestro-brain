import { DatabaseSchema as $DatabaseSchema } from "@confect/server";

import accessAuditEvents from "./tables/accessAuditEvents";
import actionApprovals from "./tables/actionApprovals";
import actionDigests from "./tables/actionDigests";
import actionJobs from "./tables/actionJobs";
import actionTriggers from "./tables/actionTriggers";
import apiKeys from "./tables/apiKeys";
import billingPlans from "./tables/billingPlans";
import brainExportJobs from "./tables/brainExportJobs";
import brainMaintenanceProposalItems from "./tables/brainMaintenanceProposalItems";
import brainMaintenanceProposals from "./tables/brainMaintenanceProposals";
import brainPageAuditEvents from "./tables/brainPageAuditEvents";
import brainPages from "./tables/brainPages";
import brainSources from "./tables/brainSources";
import callRouteMappings from "./tables/callRouteMappings";
import callRoutingProposals from "./tables/callRoutingProposals";
import channelDeliveryPolicies from "./tables/channelDeliveryPolicies";
import channelRoutingPolicies from "./tables/channelRoutingPolicies";
import channelSyncStates from "./tables/channelSyncStates";
import citations from "./tables/citations";
import claims from "./tables/claims";
import classificationDecisions from "./tables/classificationDecisions";
import concepts from "./tables/concepts";
import contextPacks from "./tables/contextPacks";
import creditLedger from "./tables/creditLedger";
import documentAnnotations from "./tables/documentAnnotations";
import documentVersions from "./tables/documentVersions";
import documents from "./tables/documents";
import dsarRequests from "./tables/dsarRequests";
import entitlements from "./tables/entitlements";
import featureFlagPolicies from "./tables/featureFlagPolicies";
import invitations from "./tables/invitations";
import migrationReceipts from "./tables/migrationReceipts";
import migrationRuns from "./tables/migrationRuns";
import modelCallReceipts from "./tables/modelCallReceipts";
import notificationPreferences from "./tables/notificationPreferences";
import notificationRecords from "./tables/notificationRecords";
import organizationMembers from "./tables/organizationMembers";
import organizations from "./tables/organizations";
import outboundDeliveryOutbox from "./tables/outboundDeliveryOutbox";
import pageRevisions from "./tables/pageRevisions";
import policies from "./tables/policies";
import promptRegistry from "./tables/promptRegistry";
import providerConnections from "./tables/providerConnections";
import providerEventReceipts from "./tables/providerEventReceipts";
import servicePrincipals from "./tables/servicePrincipals";
import slackIdentityBindings from "./tables/slackIdentityBindings";
import slackQuestionReceipts from "./tables/slackQuestionReceipts";
import sourceArtifacts from "./tables/sourceArtifacts";
import sourceChannels from "./tables/sourceChannels";
import sourceProcessingJobs from "./tables/sourceProcessingJobs";
import sourceRevisions from "./tables/sourceRevisions";
import sourceSegments from "./tables/sourceSegments";
import sourceUnitRevisions from "./tables/sourceUnitRevisions";
import sourceUnits from "./tables/sourceUnits";
import transformBlocks from "./tables/transformBlocks";
import transformDefinitions from "./tables/transformDefinitions";
import transformRuns from "./tables/transformRuns";
import usageEvents from "./tables/usageEvents";
import users from "./tables/users";
import versionFreshness from "./tables/versionFreshness";
import versionedEntries from "./tables/versionedEntries";
import webhookEvents from "./tables/webhookEvents";
import workflowRunContextManifests from "./tables/workflowRunContextManifests";
import workflowRunEvents from "./tables/workflowRunEvents";
import workflowRunEvidenceSnapshots from "./tables/workflowRunEvidenceSnapshots";
import workflowRunLinks from "./tables/workflowRunLinks";
import workflowRuns from "./tables/workflowRuns";
import workflowStageRuns from "./tables/workflowStageRuns";
import workspaceMembers from "./tables/workspaceMembers";
import workspaces from "./tables/workspaces";

const databaseSchema: $DatabaseSchema.DatabaseSchema<
  typeof accessAuditEvents |
  typeof actionApprovals |
  typeof actionDigests |
  typeof actionJobs |
  typeof actionTriggers |
  typeof apiKeys |
  typeof billingPlans |
  typeof brainExportJobs |
  typeof brainMaintenanceProposalItems |
  typeof brainMaintenanceProposals |
  typeof brainPageAuditEvents |
  typeof brainPages |
  typeof brainSources |
  typeof callRouteMappings |
  typeof callRoutingProposals |
  typeof channelDeliveryPolicies |
  typeof channelRoutingPolicies |
  typeof channelSyncStates |
  typeof citations |
  typeof claims |
  typeof classificationDecisions |
  typeof concepts |
  typeof contextPacks |
  typeof creditLedger |
  typeof documentAnnotations |
  typeof documentVersions |
  typeof documents |
  typeof dsarRequests |
  typeof entitlements |
  typeof featureFlagPolicies |
  typeof invitations |
  typeof migrationReceipts |
  typeof migrationRuns |
  typeof modelCallReceipts |
  typeof notificationPreferences |
  typeof notificationRecords |
  typeof organizationMembers |
  typeof organizations |
  typeof outboundDeliveryOutbox |
  typeof pageRevisions |
  typeof policies |
  typeof promptRegistry |
  typeof providerConnections |
  typeof providerEventReceipts |
  typeof servicePrincipals |
  typeof slackIdentityBindings |
  typeof slackQuestionReceipts |
  typeof sourceArtifacts |
  typeof sourceChannels |
  typeof sourceProcessingJobs |
  typeof sourceRevisions |
  typeof sourceSegments |
  typeof sourceUnitRevisions |
  typeof sourceUnits |
  typeof transformBlocks |
  typeof transformDefinitions |
  typeof transformRuns |
  typeof usageEvents |
  typeof users |
  typeof versionFreshness |
  typeof versionedEntries |
  typeof webhookEvents |
  typeof workflowRunContextManifests |
  typeof workflowRunEvents |
  typeof workflowRunEvidenceSnapshots |
  typeof workflowRunLinks |
  typeof workflowRuns |
  typeof workflowStageRuns |
  typeof workspaceMembers |
  typeof workspaces
> = $DatabaseSchema.make({
  accessAuditEvents,
  actionApprovals,
  actionDigests,
  actionJobs,
  actionTriggers,
  apiKeys,
  billingPlans,
  brainExportJobs,
  brainMaintenanceProposalItems,
  brainMaintenanceProposals,
  brainPageAuditEvents,
  brainPages,
  brainSources,
  callRouteMappings,
  callRoutingProposals,
  channelDeliveryPolicies,
  channelRoutingPolicies,
  channelSyncStates,
  citations,
  claims,
  classificationDecisions,
  concepts,
  contextPacks,
  creditLedger,
  documentAnnotations,
  documentVersions,
  documents,
  dsarRequests,
  entitlements,
  featureFlagPolicies,
  invitations,
  migrationReceipts,
  migrationRuns,
  modelCallReceipts,
  notificationPreferences,
  notificationRecords,
  organizationMembers,
  organizations,
  outboundDeliveryOutbox,
  pageRevisions,
  policies,
  promptRegistry,
  providerConnections,
  providerEventReceipts,
  servicePrincipals,
  slackIdentityBindings,
  slackQuestionReceipts,
  sourceArtifacts,
  sourceChannels,
  sourceProcessingJobs,
  sourceRevisions,
  sourceSegments,
  sourceUnitRevisions,
  sourceUnits,
  transformBlocks,
  transformDefinitions,
  transformRuns,
  usageEvents,
  users,
  versionFreshness,
  versionedEntries,
  webhookEvents,
  workflowRunContextManifests,
  workflowRunEvents,
  workflowRunEvidenceSnapshots,
  workflowRunLinks,
  workflowRuns,
  workflowStageRuns,
  workspaceMembers,
  workspaces,
});

export default databaseSchema;
