import { DatabaseSchema as $DatabaseSchema } from "@confect/server";

import accessAuditEvents from "./tables/accessAuditEvents";
import actionApprovals from "./tables/actionApprovals";
import actionDigests from "./tables/actionDigests";
import actionJobs from "./tables/actionJobs";
import actionTriggers from "./tables/actionTriggers";
import apiKeys from "./tables/apiKeys";
import billingPlans from "./tables/billingPlans";
import brainCorpusHealth from "./tables/brainCorpusHealth";
import brainExportJobs from "./tables/brainExportJobs";
import brainFeedbackReports from "./tables/brainFeedbackReports";
import brainMaintenanceProposalItems from "./tables/brainMaintenanceProposalItems";
import brainMaintenanceProposals from "./tables/brainMaintenanceProposals";
import brainOperationReceipts from "./tables/brainOperationReceipts";
import brainPageAuditEvents from "./tables/brainPageAuditEvents";
import brainPages from "./tables/brainPages";
import brainProjectionPopulation from "./tables/brainProjectionPopulation";
import brainProjectionValidationReceipts from "./tables/brainProjectionValidationReceipts";
import brainPublicationPauses from "./tables/brainPublicationPauses";
import brainPublicationWorkerLeases from "./tables/brainPublicationWorkerLeases";
import brainReadModes from "./tables/brainReadModes";
import brainRequiredScopeIntents from "./tables/brainRequiredScopeIntents";
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
import connectorAllowlistGenerations from "./tables/connectorAllowlistGenerations";
import connectorIncrementalCursors from "./tables/connectorIncrementalCursors";
import connectorPageChunks from "./tables/connectorPageChunks";
import connectorPageEnvelopes from "./tables/connectorPageEnvelopes";
import connectorReconciliationRuns from "./tables/connectorReconciliationRuns";
import connectorReconciliationSeen from "./tables/connectorReconciliationSeen";
import connectorScopes from "./tables/connectorScopes";
import connectorSyncStates from "./tables/connectorSyncStates";
import contextPacks from "./tables/contextPacks";
import creditLedger from "./tables/creditLedger";
import documentAnnotations from "./tables/documentAnnotations";
import documentSourceMembershipEdges from "./tables/documentSourceMembershipEdges";
import documentSourceObjects from "./tables/documentSourceObjects";
import documentSourceObservations from "./tables/documentSourceObservations";
import documentSourceOutcomes from "./tables/documentSourceOutcomes";
import documentSourcePassages from "./tables/documentSourcePassages";
import documentSourceRevisions from "./tables/documentSourceRevisions";
import documentSourceScopePointers from "./tables/documentSourceScopePointers";
import documentVersions from "./tables/documentVersions";
import documents from "./tables/documents";
import driveScopeConfigurations from "./tables/driveScopeConfigurations";
import dsarRequests from "./tables/dsarRequests";
import entitlements from "./tables/entitlements";
import featureFlagPolicies from "./tables/featureFlagPolicies";
import ingestionObligationRepairEffects from "./tables/ingestionObligationRepairEffects";
import ingestionObligations from "./tables/ingestionObligations";
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
import providerTargetResolutionIntents from "./tables/providerTargetResolutionIntents";
import retrievalEligibilityFences from "./tables/retrievalEligibilityFences";
import retrievalEntries from "./tables/retrievalEntries";
import retrievalPublicationJobs from "./tables/retrievalPublicationJobs";
import retrievalPublicationSets from "./tables/retrievalPublicationSets";
import retrievalPublicationSubjects from "./tables/retrievalPublicationSubjects";
import retrievalRebuildChildren from "./tables/retrievalRebuildChildren";
import retrievalRebuildRuns from "./tables/retrievalRebuildRuns";
import retrievalTokenCatalog from "./tables/retrievalTokenCatalog";
import retrievalTokens from "./tables/retrievalTokens";
import servicePrincipals from "./tables/servicePrincipals";
import slackIdentityBindings from "./tables/slackIdentityBindings";
import slackPublicationTargetIntents from "./tables/slackPublicationTargetIntents";
import slackQuestionReceipts from "./tables/slackQuestionReceipts";
import sourceArtifacts from "./tables/sourceArtifacts";
import sourceChannels from "./tables/sourceChannels";
import sourceProcessingJobs from "./tables/sourceProcessingJobs";
import sourceRevisions from "./tables/sourceRevisions";
import sourceSegments from "./tables/sourceSegments";
import sourceUnitRevisions from "./tables/sourceUnitRevisions";
import sourceUnits from "./tables/sourceUnits";
import structuredQueryFieldRegistrations from "./tables/structuredQueryFieldRegistrations";
import structuredSourceEntities from "./tables/structuredSourceEntities";
import structuredSourceFields from "./tables/structuredSourceFields";
import structuredSourceObservations from "./tables/structuredSourceObservations";
import structuredSourceRevisions from "./tables/structuredSourceRevisions";
import structuredSourceRoutes from "./tables/structuredSourceRoutes";
import transcriptRevisionOrderMigrationItems from "./tables/transcriptRevisionOrderMigrationItems";
import transcriptRevisionOrderMigrations from "./tables/transcriptRevisionOrderMigrations";
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
  typeof brainCorpusHealth |
  typeof brainExportJobs |
  typeof brainFeedbackReports |
  typeof brainMaintenanceProposalItems |
  typeof brainMaintenanceProposals |
  typeof brainOperationReceipts |
  typeof brainPageAuditEvents |
  typeof brainPages |
  typeof brainProjectionPopulation |
  typeof brainProjectionValidationReceipts |
  typeof brainPublicationPauses |
  typeof brainPublicationWorkerLeases |
  typeof brainReadModes |
  typeof brainRequiredScopeIntents |
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
  typeof connectorAllowlistGenerations |
  typeof connectorIncrementalCursors |
  typeof connectorPageChunks |
  typeof connectorPageEnvelopes |
  typeof connectorReconciliationRuns |
  typeof connectorReconciliationSeen |
  typeof connectorScopes |
  typeof connectorSyncStates |
  typeof contextPacks |
  typeof creditLedger |
  typeof documentAnnotations |
  typeof documentSourceMembershipEdges |
  typeof documentSourceObjects |
  typeof documentSourceObservations |
  typeof documentSourceOutcomes |
  typeof documentSourcePassages |
  typeof documentSourceRevisions |
  typeof documentSourceScopePointers |
  typeof documentVersions |
  typeof documents |
  typeof driveScopeConfigurations |
  typeof dsarRequests |
  typeof entitlements |
  typeof featureFlagPolicies |
  typeof ingestionObligationRepairEffects |
  typeof ingestionObligations |
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
  typeof providerTargetResolutionIntents |
  typeof retrievalEligibilityFences |
  typeof retrievalEntries |
  typeof retrievalPublicationJobs |
  typeof retrievalPublicationSets |
  typeof retrievalPublicationSubjects |
  typeof retrievalRebuildChildren |
  typeof retrievalRebuildRuns |
  typeof retrievalTokenCatalog |
  typeof retrievalTokens |
  typeof servicePrincipals |
  typeof slackIdentityBindings |
  typeof slackPublicationTargetIntents |
  typeof slackQuestionReceipts |
  typeof sourceArtifacts |
  typeof sourceChannels |
  typeof sourceProcessingJobs |
  typeof sourceRevisions |
  typeof sourceSegments |
  typeof sourceUnitRevisions |
  typeof sourceUnits |
  typeof structuredQueryFieldRegistrations |
  typeof structuredSourceEntities |
  typeof structuredSourceFields |
  typeof structuredSourceObservations |
  typeof structuredSourceRevisions |
  typeof structuredSourceRoutes |
  typeof transcriptRevisionOrderMigrationItems |
  typeof transcriptRevisionOrderMigrations |
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
  brainCorpusHealth,
  brainExportJobs,
  brainFeedbackReports,
  brainMaintenanceProposalItems,
  brainMaintenanceProposals,
  brainOperationReceipts,
  brainPageAuditEvents,
  brainPages,
  brainProjectionPopulation,
  brainProjectionValidationReceipts,
  brainPublicationPauses,
  brainPublicationWorkerLeases,
  brainReadModes,
  brainRequiredScopeIntents,
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
  connectorAllowlistGenerations,
  connectorIncrementalCursors,
  connectorPageChunks,
  connectorPageEnvelopes,
  connectorReconciliationRuns,
  connectorReconciliationSeen,
  connectorScopes,
  connectorSyncStates,
  contextPacks,
  creditLedger,
  documentAnnotations,
  documentSourceMembershipEdges,
  documentSourceObjects,
  documentSourceObservations,
  documentSourceOutcomes,
  documentSourcePassages,
  documentSourceRevisions,
  documentSourceScopePointers,
  documentVersions,
  documents,
  driveScopeConfigurations,
  dsarRequests,
  entitlements,
  featureFlagPolicies,
  ingestionObligationRepairEffects,
  ingestionObligations,
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
  providerTargetResolutionIntents,
  retrievalEligibilityFences,
  retrievalEntries,
  retrievalPublicationJobs,
  retrievalPublicationSets,
  retrievalPublicationSubjects,
  retrievalRebuildChildren,
  retrievalRebuildRuns,
  retrievalTokenCatalog,
  retrievalTokens,
  servicePrincipals,
  slackIdentityBindings,
  slackPublicationTargetIntents,
  slackQuestionReceipts,
  sourceArtifacts,
  sourceChannels,
  sourceProcessingJobs,
  sourceRevisions,
  sourceSegments,
  sourceUnitRevisions,
  sourceUnits,
  structuredQueryFieldRegistrations,
  structuredSourceEntities,
  structuredSourceFields,
  structuredSourceObservations,
  structuredSourceRevisions,
  structuredSourceRoutes,
  transcriptRevisionOrderMigrationItems,
  transcriptRevisionOrderMigrations,
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
