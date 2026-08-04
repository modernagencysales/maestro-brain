/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access_invitations from "../access/invitations.js";
import type * as access_members from "../access/members.js";
import type * as access_provisioning from "../access/provisioning.js";
import type * as agents_assistant from "../agents/assistant.js";
import type * as auth_workspaces from "../auth/workspaces.js";
import type * as brain_exports from "../brain/exports.js";
import type * as brain_pages from "../brain/pages.js";
import type * as brain_pilot from "../brain/pilot.js";
import type * as brain_readApi from "../brain/readApi.js";
import type * as capabilities_catalog from "../capabilities/catalog.js";
import type * as capabilities_classifySourceUnit from "../capabilities/classifySourceUnit.js";
import type * as capabilities_maintainBrainPage from "../capabilities/maintainBrainPage.js";
import type * as capabilities_sourceGroundedBrief from "../capabilities/sourceGroundedBrief.js";
import type * as demo_showcase from "../demo/showcase.js";
import type * as editorSync from "../editorSync.js";
import type * as headless_apiKeys from "../headless/apiKeys.js";
import type * as http from "../http.js";
import type * as identity_stableKeys from "../identity/stableKeys.js";
import type * as integrations_slackConnections from "../integrations/slackConnections.js";
import type * as integrations_slackDirectory from "../integrations/slackDirectory.js";
import type * as internal_migrations from "../internal/migrations.js";
import type * as jobs_workpool from "../jobs/workpool.js";
import type * as ops_actions from "../ops/actions.js";
import type * as ops_billing from "../ops/billing.js";
import type * as ops_brainOperations from "../ops/brainOperations.js";
import type * as ops_coediting from "../ops/coediting.js";
import type * as ops_dataLifecycle from "../ops/dataLifecycle.js";
import type * as ops_flags from "../ops/flags.js";
import type * as ops_health from "../ops/health.js";
import type * as ops_knowledge from "../ops/knowledge.js";
import type * as ops_notifications from "../ops/notifications.js";
import type * as ops_transforms from "../ops/transforms.js";
import type * as ops_versioning from "../ops/versioning.js";
import type * as slack_channelPolicies from "../slack/channelPolicies.js";
import type * as slack_identityLinks from "../slack/identityLinks.js";
import type * as slack_ingress from "../slack/ingress.js";
import type * as slack_outbox from "../slack/outbox.js";
import type * as slack_outboxWorker from "../slack/outboxWorker.js";
import type * as slack_question from "../slack/question.js";
import type * as workflowContracts_sourceClassification from "../workflowContracts/sourceClassification.js";
import type * as workflowContracts_sourceToBrainMaintenance from "../workflowContracts/sourceToBrainMaintenance.js";
import type * as workflowRunners_sourceToBrainMaintenance from "../workflowRunners/sourceToBrainMaintenance.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "access/invitations": typeof access_invitations;
  "access/members": typeof access_members;
  "access/provisioning": typeof access_provisioning;
  "agents/assistant": typeof agents_assistant;
  "auth/workspaces": typeof auth_workspaces;
  "brain/exports": typeof brain_exports;
  "brain/pages": typeof brain_pages;
  "brain/pilot": typeof brain_pilot;
  "brain/readApi": typeof brain_readApi;
  "capabilities/catalog": typeof capabilities_catalog;
  "capabilities/classifySourceUnit": typeof capabilities_classifySourceUnit;
  "capabilities/maintainBrainPage": typeof capabilities_maintainBrainPage;
  "capabilities/sourceGroundedBrief": typeof capabilities_sourceGroundedBrief;
  "demo/showcase": typeof demo_showcase;
  editorSync: typeof editorSync;
  "headless/apiKeys": typeof headless_apiKeys;
  http: typeof http;
  "identity/stableKeys": typeof identity_stableKeys;
  "integrations/slackConnections": typeof integrations_slackConnections;
  "integrations/slackDirectory": typeof integrations_slackDirectory;
  "internal/migrations": typeof internal_migrations;
  "jobs/workpool": typeof jobs_workpool;
  "ops/actions": typeof ops_actions;
  "ops/billing": typeof ops_billing;
  "ops/brainOperations": typeof ops_brainOperations;
  "ops/coediting": typeof ops_coediting;
  "ops/dataLifecycle": typeof ops_dataLifecycle;
  "ops/flags": typeof ops_flags;
  "ops/health": typeof ops_health;
  "ops/knowledge": typeof ops_knowledge;
  "ops/notifications": typeof ops_notifications;
  "ops/transforms": typeof ops_transforms;
  "ops/versioning": typeof ops_versioning;
  "slack/channelPolicies": typeof slack_channelPolicies;
  "slack/identityLinks": typeof slack_identityLinks;
  "slack/ingress": typeof slack_ingress;
  "slack/outbox": typeof slack_outbox;
  "slack/outboxWorker": typeof slack_outboxWorker;
  "slack/question": typeof slack_question;
  "workflowContracts/sourceClassification": typeof workflowContracts_sourceClassification;
  "workflowContracts/sourceToBrainMaintenance": typeof workflowContracts_sourceToBrainMaintenance;
  "workflowRunners/sourceToBrainMaintenance": typeof workflowRunners_sourceToBrainMaintenance;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  posthog: import("@posthog/convex/_generated/component.js").ComponentApi<"posthog">;
  workpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"workpool">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  prosemirrorSync: import("@convex-dev/prosemirror-sync/_generated/component.js").ComponentApi<"prosemirrorSync">;
};
