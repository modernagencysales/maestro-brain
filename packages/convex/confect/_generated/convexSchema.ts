import { defineSchema as $defineSchema } from "convex/server";

import accessAuditEvents from "./tables/accessAuditEvents";
import actionApprovals from "./tables/actionApprovals";
import actionDigests from "./tables/actionDigests";
import actionJobs from "./tables/actionJobs";
import actionTriggers from "./tables/actionTriggers";
import apiKeys from "./tables/apiKeys";
import billingPlans from "./tables/billingPlans";
import brainMaintenanceProposals from "./tables/brainMaintenanceProposals";
import brainPageAuditEvents from "./tables/brainPageAuditEvents";
import brainPages from "./tables/brainPages";
import brainSources from "./tables/brainSources";
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

export default $defineSchema({
  accessAuditEvents: accessAuditEvents.tableDefinition,
  actionApprovals: actionApprovals.tableDefinition,
  actionDigests: actionDigests.tableDefinition,
  actionJobs: actionJobs.tableDefinition,
  actionTriggers: actionTriggers.tableDefinition,
  apiKeys: apiKeys.tableDefinition,
  billingPlans: billingPlans.tableDefinition,
  brainMaintenanceProposals: brainMaintenanceProposals.tableDefinition,
  brainPageAuditEvents: brainPageAuditEvents.tableDefinition,
  brainPages: brainPages.tableDefinition,
  brainSources: brainSources.tableDefinition,
  channelDeliveryPolicies: channelDeliveryPolicies.tableDefinition,
  channelRoutingPolicies: channelRoutingPolicies.tableDefinition,
  channelSyncStates: channelSyncStates.tableDefinition,
  citations: citations.tableDefinition,
  claims: claims.tableDefinition,
  classificationDecisions: classificationDecisions.tableDefinition,
  concepts: concepts.tableDefinition,
  contextPacks: contextPacks.tableDefinition,
  creditLedger: creditLedger.tableDefinition,
  documentAnnotations: documentAnnotations.tableDefinition,
  documentVersions: documentVersions.tableDefinition,
  documents: documents.tableDefinition,
  dsarRequests: dsarRequests.tableDefinition,
  entitlements: entitlements.tableDefinition,
  featureFlagPolicies: featureFlagPolicies.tableDefinition,
  invitations: invitations.tableDefinition,
  migrationReceipts: migrationReceipts.tableDefinition,
  migrationRuns: migrationRuns.tableDefinition,
  modelCallReceipts: modelCallReceipts.tableDefinition,
  notificationPreferences: notificationPreferences.tableDefinition,
  notificationRecords: notificationRecords.tableDefinition,
  organizationMembers: organizationMembers.tableDefinition,
  organizations: organizations.tableDefinition,
  outboundDeliveryOutbox: outboundDeliveryOutbox.tableDefinition,
  pageRevisions: pageRevisions.tableDefinition,
  policies: policies.tableDefinition,
  promptRegistry: promptRegistry.tableDefinition,
  providerConnections: providerConnections.tableDefinition,
  providerEventReceipts: providerEventReceipts.tableDefinition,
  servicePrincipals: servicePrincipals.tableDefinition,
  slackIdentityBindings: slackIdentityBindings.tableDefinition,
  slackQuestionReceipts: slackQuestionReceipts.tableDefinition,
  sourceArtifacts: sourceArtifacts.tableDefinition,
  sourceChannels: sourceChannels.tableDefinition,
  sourceProcessingJobs: sourceProcessingJobs.tableDefinition,
  sourceRevisions: sourceRevisions.tableDefinition,
  transformBlocks: transformBlocks.tableDefinition,
  transformDefinitions: transformDefinitions.tableDefinition,
  transformRuns: transformRuns.tableDefinition,
  usageEvents: usageEvents.tableDefinition,
  users: users.tableDefinition,
  versionFreshness: versionFreshness.tableDefinition,
  versionedEntries: versionedEntries.tableDefinition,
  webhookEvents: webhookEvents.tableDefinition,
  workflowRunContextManifests: workflowRunContextManifests.tableDefinition,
  workflowRunEvents: workflowRunEvents.tableDefinition,
  workflowRunEvidenceSnapshots: workflowRunEvidenceSnapshots.tableDefinition,
  workflowRunLinks: workflowRunLinks.tableDefinition,
  workflowRuns: workflowRuns.tableDefinition,
  workflowStageRuns: workflowStageRuns.tableDefinition,
  workspaceMembers: workspaceMembers.tableDefinition,
  workspaces: workspaces.tableDefinition,
});
