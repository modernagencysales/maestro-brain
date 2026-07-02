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
import type * as brain_pages from "../brain/pages.js";
import type * as capabilities_catalog from "../capabilities/catalog.js";
import type * as capabilities_sourceGroundedBrief from "../capabilities/sourceGroundedBrief.js";
import type * as demo_showcase from "../demo/showcase.js";
import type * as http from "../http.js";
import type * as jobs_workpool from "../jobs/workpool.js";
import type * as ops_actions from "../ops/actions.js";
import type * as ops_billing from "../ops/billing.js";
import type * as ops_coediting from "../ops/coediting.js";
import type * as ops_health from "../ops/health.js";
import type * as ops_knowledge from "../ops/knowledge.js";
import type * as ops_transforms from "../ops/transforms.js";
import type * as ops_versioning from "../ops/versioning.js";

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
  "brain/pages": typeof brain_pages;
  "capabilities/catalog": typeof capabilities_catalog;
  "capabilities/sourceGroundedBrief": typeof capabilities_sourceGroundedBrief;
  "demo/showcase": typeof demo_showcase;
  http: typeof http;
  "jobs/workpool": typeof jobs_workpool;
  "ops/actions": typeof ops_actions;
  "ops/billing": typeof ops_billing;
  "ops/coediting": typeof ops_coediting;
  "ops/health": typeof ops_health;
  "ops/knowledge": typeof ops_knowledge;
  "ops/transforms": typeof ops_transforms;
  "ops/versioning": typeof ops_versioning;
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
  workpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"workpool">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
