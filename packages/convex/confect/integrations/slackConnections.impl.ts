import { Ref } from "@confect/core";
import {
  ConnectSessionInvalid as NangoConnectSessionInvalid,
  ProviderUnavailable as NangoProviderUnavailable,
  createFakeNangoClient,
} from "@maestro-template/integrations/nango/client";
import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import {
  Auth,
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
} from "../_generated/services";
import { asGenericId } from "../access/handlerContext";
import { roleAtLeast, type Role } from "../access/roles";
import { Forbidden, Unauthorized } from "../errors";
import slackConnections, {
  ConnectSessionInvalid,
  ConnectionAlreadyExists,
  ProviderUnavailable,
  TenantMismatch,
} from "./slackConnections.spec";

export type SlackConnectionStatus =
  | "not_connected"
  | "authorizing"
  | "verifying"
  | "active"
  | "error"
  | "reauthorizing";

export type SlackPrincipal = {
  readonly organizationKey: string;
  readonly role: Role;
};

export type SlackConnectionState = {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly status: SlackConnectionStatus;
  readonly nangoConnectionId?: string;
};

export type PendingSlackConnect = {
  readonly organizationKey: string;
  readonly connectSessionId: string;
  readonly connectSessionToken: string;
  readonly expiresAt: number;
  readonly providerConfigKey: "slack";
  readonly nangoEndUserId: string;
  readonly nangoOrganizationId: string;
  readonly correlationTag: string;
  readonly attemptId: string;
};

type SlackConnectionError =
  | Unauthorized
  | Forbidden
  | ConnectionAlreadyExists
  | ConnectSessionInvalid
  | ProviderUnavailable
  | TenantMismatch;

type ProviderConnectionRow = {
  readonly _id: GenericId<"providerConnections">;
  readonly provider: "nango";
  readonly providerConfigKey: "slack";
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly status:
    | "authorizing"
    | "verifying"
    | "active"
    | "error"
    | "reauthorizing"
    | "revoked";
  readonly connectSessionId: string;
  readonly nangoConnectionId?: string | null | undefined;
  readonly nangoEndUserId: string;
  readonly nangoOrganizationId: string;
  readonly correlationTag: string;
  readonly attemptId: string;
  readonly attemptExpiresAt: number;
  readonly completedAt?: number | null | undefined;
};
